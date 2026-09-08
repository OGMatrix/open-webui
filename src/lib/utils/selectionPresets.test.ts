import { describe, expect, it } from 'vitest';
import { emptySelection, type ComposerSelection } from './composerSelection';
import {
	MAX_PRESETS,
	MAX_PRESET_NAME,
	activePreset,
	addPreset,
	nameTaken,
	presetName,
	readPresets,
	removePreset,
	renamePreset,
	replacePreset,
	summarize,
	type SelectionPreset
} from './selectionPresets';

const selection = (over: Partial<ComposerSelection> = {}): ComposerSelection => ({
	...emptySelection(),
	...over
});

const withPresets = (...names: string[]): SelectionPreset[] =>
	names.reduce<SelectionPreset[]>(
		(acc, name) => addPreset(acc, name, selection({ toolIds: [name] })).presets,
		[]
	);

describe('naming a preset', () => {
	it('collapses whitespace and trims', () => {
		expect(presetName('  Suche   im    Netz ')).toBe('Suche im Netz');
	});

	it('caps the length, because the row it sits in has an end', () => {
		expect(presetName('x'.repeat(200))).toHaveLength(MAX_PRESET_NAME);
	});

	it('reads anything that is not a string as no name', () => {
		expect(presetName(null)).toBe('');
		expect(presetName(42)).toBe('');
	});
});

describe('reading stored presets', () => {
	it('reads what this app writes', () => {
		const read = readPresets({
			selectionPresets: [{ id: 'a', name: 'Recherche', selection: { toolIds: ['t'] } }]
		});
		expect(read).toHaveLength(1);
		expect(read[0].selection.toolIds).toEqual(['t']);
	});

	it('drops entries with no name or no id', () => {
		// Either one makes the entry impossible to show or to edit.
		const read = readPresets({
			selectionPresets: [
				{ id: 'a', name: '', selection: {} },
				{ name: 'kein id', selection: {} },
				{ id: 'b', name: 'gut', selection: {} }
			]
		});
		expect(read.map((preset) => preset.name)).toEqual(['gut']);
	});

	it('drops a repeated id, which would make every edit ambiguous', () => {
		const read = readPresets({
			selectionPresets: [
				{ id: 'a', name: 'erste', selection: {} },
				{ id: 'a', name: 'zweite', selection: {} }
			]
		});
		expect(read.map((preset) => preset.name)).toEqual(['erste']);
	});

	it('fills in a selection that was stored badly rather than dropping the preset', () => {
		const read = readPresets({
			selectionPresets: [{ id: 'a', name: 'kaputt', selection: 'nein' }]
		});
		expect(read[0].selection).toEqual(emptySelection());
	});

	it('survives nonsense', () => {
		expect(readPresets(null)).toEqual([]);
		expect(readPresets({})).toEqual([]);
		expect(readPresets({ selectionPresets: 'nein' })).toEqual([]);
	});

	it('stops at the limit rather than reading an unbounded list', () => {
		const stored = Array.from({ length: MAX_PRESETS + 10 }, (_, index) => ({
			id: `id-${index}`,
			name: `Nummer ${index}`,
			selection: {}
		}));
		expect(readPresets({ selectionPresets: stored })).toHaveLength(MAX_PRESETS);
	});
});

describe('adding one', () => {
	it('keeps the selection it was given', () => {
		const { presets } = addPreset([], 'Recherche', selection({ toolIds: ['a'], webSearch: true }));
		expect(presets[0].name).toBe('Recherche');
		expect(presets[0].selection.toolIds).toEqual(['a']);
		expect(presets[0].selection.webSearch).toBe(true);
	});

	it('gives every preset its own id', () => {
		const presets = withPresets('eins', 'zwei');
		expect(presets[0].id).not.toBe(presets[1].id);
	});

	it('stores an empty selection, because "everything off" is a way of working', () => {
		const { presets, error } = addPreset([], 'Nichts', emptySelection());
		expect(error).toBeUndefined();
		expect(summarize(presets[0].selection).empty).toBe(true);
	});

	it('refuses a name that is only whitespace', () => {
		expect(addPreset([], '   ', emptySelection()).error).toBe('empty-name');
	});

	it('refuses a name already in use, whatever its case', () => {
		const existing = withPresets('Recherche');
		expect(addPreset(existing, 'recherche', emptySelection()).error).toBe('duplicate-name');
	});

	it('refuses to grow past the limit', () => {
		const full = Array.from({ length: MAX_PRESETS }, (_, index) => ({
			id: `id-${index}`,
			name: `Nummer ${index}`,
			selection: emptySelection()
		}));
		expect(addPreset(full, 'noch eins', emptySelection()).error).toBe('too-many');
	});

	it('leaves the list untouched when it refuses', () => {
		const existing = withPresets('Recherche');
		expect(addPreset(existing, 'Recherche', emptySelection()).presets).toBe(existing);
	});
});

describe('changing one', () => {
	it('renames', () => {
		const existing = withPresets('alt');
		const { presets } = renamePreset(existing, existing[0].id, 'neu');
		expect(presets[0].name).toBe('neu');
	});

	it('lets a preset keep its own name while renaming', () => {
		// Otherwise correcting the capitalisation of a name would be refused.
		const existing = withPresets('Recherche');
		expect(renamePreset(existing, existing[0].id, 'RECHERCHE').error).toBeUndefined();
	});

	it('refuses to rename onto another preset', () => {
		const existing = withPresets('eins', 'zwei');
		expect(renamePreset(existing, existing[0].id, 'zwei').error).toBe('duplicate-name');
	});

	it('points a preset at a new selection', () => {
		const existing = withPresets('eins');
		const updated = replacePreset(existing, existing[0].id, selection({ codeInterpreter: true }));
		expect(updated[0].selection.codeInterpreter).toBe(true);
		expect(updated[0].name).toBe('eins');
	});

	it('removes', () => {
		const existing = withPresets('eins', 'zwei');
		expect(removePreset(existing, existing[0].id).map((preset) => preset.name)).toEqual(['zwei']);
	});

	it('knows which names are taken', () => {
		const existing = withPresets('eins');
		expect(nameTaken(existing, 'EINS')).toBe(true);
		expect(nameTaken(existing, 'EINS', existing[0].id)).toBe(false);
	});
});

describe('knowing which one is on', () => {
	it('finds the preset that matches exactly', () => {
		const existing = withPresets('eins', 'zwei');
		expect(activePreset(existing, selection({ toolIds: ['zwei'] }))?.name).toBe('zwei');
	});

	it('ignores the order tools were ticked in', () => {
		const { presets } = addPreset([], 'beide', selection({ toolIds: ['a', 'b'] }));
		expect(activePreset(presets, selection({ toolIds: ['b', 'a'] }))?.name).toBe('beide');
	});

	it('says none when something extra is switched on', () => {
		const existing = withPresets('eins');
		expect(activePreset(existing, selection({ toolIds: ['eins'], webSearch: true }))).toBe(null);
	});
});

describe('summarising one', () => {
	it('counts each kind', () => {
		const summary = summarize(
			selection({ toolIds: ['a', 'b'], skillIds: ['s'], webSearch: true, codeInterpreter: true })
		);
		expect(summary).toEqual({ tools: 2, skills: 1, filters: 0, modes: 2, empty: false });
	});

	it('knows when a preset holds nothing', () => {
		expect(summarize(emptySelection()).empty).toBe(true);
	});
});
