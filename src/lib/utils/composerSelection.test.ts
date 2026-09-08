import { describe, expect, it } from 'vitest';
import {
	emptySelection,
	isEmptySelection,
	prune,
	readSelection,
	readUserDefault,
	resolveSelection,
	sameSelection,
	type ComposerSelection
} from './composerSelection';

const selection = (over: Partial<ComposerSelection> = {}): ComposerSelection => ({
	...emptySelection(),
	...over
});

describe('reading a stored selection', () => {
	it('reads the shape this app writes', () => {
		const read = readSelection({ toolIds: ['a', 'b'], webSearch: true });
		expect(read.toolIds).toEqual(['a', 'b']);
		expect(read.webSearch).toBe(true);
	});

	it('reads the shape the composer uses internally', () => {
		// Drafts were written with the component's own names; a selection saved
		// before this existed must still be readable.
		const read = readSelection({
			selectedToolIds: ['a'],
			selectedSkillIds: ['s'],
			selectedFilterIds: ['f'],
			webSearchEnabled: true,
			codeInterpreterEnabled: true
		});
		expect(read.toolIds).toEqual(['a']);
		expect(read.skillIds).toEqual(['s']);
		expect(read.filterIds).toEqual(['f']);
		expect(read.webSearch).toBe(true);
		expect(read.codeInterpreter).toBe(true);
		expect(read.imageGeneration).toBe(false);
	});

	it('drops duplicates', () => {
		expect(readSelection({ toolIds: ['a', 'a', 'b'] }).toolIds).toEqual(['a', 'b']);
	});

	it('ignores anything that is not an id', () => {
		expect(readSelection({ toolIds: ['a', 3, null, { id: 'b' }] }).toolIds).toEqual(['a']);
	});

	it('survives nonsense', () => {
		expect(readSelection(null)).toEqual(emptySelection());
		expect(readSelection('nope')).toEqual(emptySelection());
		expect(readSelection({ toolIds: 'a,b' }).toolIds).toEqual([]);
	});

	it('treats anything but true as off', () => {
		// A flag stored as "true" or 1 by an older version must not read as on,
		// or a mode nobody asked for turns itself back on.
		expect(readSelection({ webSearch: 'true' }).webSearch).toBe(false);
		expect(readSelection({ webSearch: 1 }).webSearch).toBe(false);
	});
});

describe('comparing selections', () => {
	it('ignores the order things were ticked in', () => {
		// Otherwise the chat would be saved again every time the order shifted.
		expect(
			sameSelection(selection({ toolIds: ['a', 'b'] }), selection({ toolIds: ['b', 'a'] }))
		).toBe(true);
	});

	it('notices an added tool', () => {
		expect(sameSelection(selection({ toolIds: ['a'] }), selection({ toolIds: ['a', 'b'] }))).toBe(
			false
		);
	});

	it('notices a mode being switched on', () => {
		expect(sameSelection(selection(), selection({ webSearch: true }))).toBe(false);
	});

	it('knows when nothing is selected', () => {
		expect(isEmptySelection(emptySelection())).toBe(true);
		expect(isEmptySelection(selection({ codeInterpreter: true }))).toBe(false);
		expect(isEmptySelection(selection({ filterIds: ['f'] }))).toBe(false);
	});
});

describe('dropping what is no longer there', () => {
	it('removes a tool that has been deleted', () => {
		// The failure this exists for: sending an id nothing answers to fails
		// somewhere the reader cannot see.
		const pruned = prune(selection({ toolIds: ['gone', 'kept'] }), { toolIds: ['kept'] });
		expect(pruned.toolIds).toEqual(['kept']);
	});

	it('leaves a kind alone when nothing was said about it', () => {
		const pruned = prune(selection({ skillIds: ['s'] }), { toolIds: [] });
		expect(pruned.skillIds).toEqual(['s']);
	});

	it('does not touch the modes', () => {
		expect(prune(selection({ webSearch: true }), { toolIds: [] }).webSearch).toBe(true);
	});
});

describe('deciding what a conversation opens with', () => {
	const available = { toolIds: ['a', 'b', 'model-tool'], skillIds: ['s1'], filterIds: ['f1'] };

	it('gives a saved conversation exactly what it was using', () => {
		// The whole point: a chat that ran with two tools comes back with those
		// two, not with whatever the model happens to list now.
		const resolved = resolveSelection(
			{ saved: { toolIds: ['a', 'b'] }, modelToolIds: ['model-tool'] },
			available
		);
		expect(resolved.toolIds).toEqual(['a', 'b']);
	});

	it('honours a saved conversation that chose nothing', () => {
		// Deliberately empty is a choice, and the model's list must not undo it.
		const resolved = resolveSelection(
			{ saved: emptySelection(), modelToolIds: ['model-tool'] },
			available
		);
		expect(resolved.toolIds).toEqual([]);
	});

	it('still drops a tool the saved conversation can no longer reach', () => {
		const resolved = resolveSelection({ saved: { toolIds: ['a', 'deleted'] } }, available);
		expect(resolved.toolIds).toEqual(['a']);
	});

	it('starts a new conversation from the model when nothing else is set', () => {
		// The mechanism the project documents; kept working.
		const resolved = resolveSelection({ modelToolIds: ['model-tool'] }, available);
		expect(resolved.toolIds).toEqual(['model-tool']);
	});

	it('prefers the reader default over the model list', () => {
		const resolved = resolveSelection(
			{ userDefault: { toolIds: ['a'] }, modelToolIds: ['model-tool'] },
			available
		);
		expect(resolved.toolIds).toEqual(['a']);
	});

	it('falls back to the model when the reader default is empty', () => {
		// An empty default is what someone has who never set one; it should not
		// silently switch the model's tools off.
		const resolved = resolveSelection(
			{ userDefault: emptySelection(), modelToolIds: ['model-tool'] },
			available
		);
		expect(resolved.toolIds).toEqual(['model-tool']);
	});

	it('carries the modes out of a reader default', () => {
		const resolved = resolveSelection({ userDefault: { webSearch: true } }, available);
		expect(resolved.webSearch).toBe(true);
	});

	it('carries the model skills as well as its tools', () => {
		const resolved = resolveSelection({ modelSkillIds: ['s1', 'gone'] }, available);
		expect(resolved.skillIds).toEqual(['s1']);
	});

	it('selects nothing when there is nothing to go on', () => {
		expect(resolveSelection({}, available)).toEqual(emptySelection());
	});

	it('takes the modes a model switches on by default', () => {
		const resolved = resolveSelection(
			{ modelFeatureIds: ['web_search', 'code_interpreter'] },
			available
		);
		expect(resolved.webSearch).toBe(true);
		expect(resolved.codeInterpreter).toBe(true);
		expect(resolved.imageGeneration).toBe(false);
	});

	it('takes the filters a model switches on by default', () => {
		expect(resolveSelection({ modelFilterIds: ['f1'] }, available).filterIds).toEqual(['f1']);
	});

	it('lets the reader default replace the model modes wholesale', () => {
		// Someone who set their own starting point gets exactly that; the model's
		// list is what people without one fall back to.
		const resolved = resolveSelection(
			{ userDefault: { toolIds: ['a'] }, modelFeatureIds: ['web_search'] },
			available
		);
		expect(resolved.toolIds).toEqual(['a']);
		expect(resolved.webSearch).toBe(false);
	});

	it('counts a model that only switches a mode on as something to fall back to', () => {
		const resolved = resolveSelection({ modelFeatureIds: ['web_search'] }, available);
		expect(resolved.webSearch).toBe(true);
	});
});

describe('the reader own starting point', () => {
	it('reads a saved default', () => {
		const read = readUserDefault({ defaultSelection: { toolIds: ['a'], webSearch: true } });
		expect(read?.toolIds).toEqual(['a']);
		expect(read?.webSearch).toBe(true);
	});

	it('reads the older bare list of tool ids', () => {
		// settings.tools was read by this app and written by nothing; whoever set
		// it by hand keeps it.
		expect(readUserDefault({ tools: ['a', 'b'] })?.toolIds).toEqual(['a', 'b']);
	});

	it('prefers the saved default over the older list', () => {
		expect(
			readUserDefault({ defaultSelection: { toolIds: ['new'] }, tools: ['old'] })?.toolIds
		).toEqual(['new']);
	});

	it('says nothing when nothing was set', () => {
		expect(readUserDefault({})).toBe(null);
		expect(readUserDefault(null)).toBe(null);
		expect(readUserDefault({ tools: 'a,b' })).toBe(null);
	});

	it('reads a deliberately empty default as empty rather than absent', () => {
		// Clearing the default writes an empty one; that must still read as "set",
		// so resolveSelection can decide what an empty default means.
		expect(readUserDefault({ defaultSelection: emptySelection() })).toEqual(emptySelection());
	});
});

describe('what has not loaded yet', () => {
	it('keeps a selection when nothing is known about what exists', () => {
		// Opening a chat before the tool list arrives must not read as "no tools
		// exist" and empty the conversation's selection.
		const resolved = resolveSelection({ saved: { toolIds: ['a', 'b'] } }, {});
		expect(resolved.toolIds).toEqual(['a', 'b']);
	});

	it('still prunes the kinds it does know about', () => {
		const resolved = resolveSelection(
			{ saved: { toolIds: ['gone'], skillIds: ['s'] } },
			{ toolIds: [] }
		);
		expect(resolved.toolIds).toEqual([]);
		expect(resolved.skillIds).toEqual(['s']);
	});
});
