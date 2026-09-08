import { describe, expect, it } from 'vitest';
import { emptySelection, type ComposerSelection } from './composerSelection';
import {
	CODE_INTERPRETER,
	IMAGE_GENERATION,
	MAX_REASON,
	WEB_SEARCH,
	applySuggestion,
	emptySuggestion,
	isEmptySuggestion,
	isOn,
	readSuggestion,
	suggestedItems,
	suggestionKey,
	worthAsking,
	type SuggestionCandidate
} from './toolSuggestions';

const selection = (over: Partial<ComposerSelection> = {}): ComposerSelection => ({
	...emptySelection(),
	...over
});

const catalogue: SuggestionCandidate[] = [
	{ id: 'wetter', kind: 'tool', name: 'Wetter', description: 'Schlägt das Wetter nach' },
	{ id: 'rechner', kind: 'tool', name: 'Rechner' },
	{ id: 'lektorat', kind: 'skill', name: 'Lektorat' },
	{ id: WEB_SEARCH, kind: 'feature', name: 'Web Search' },
	{ id: CODE_INTERPRETER, kind: 'feature', name: 'Code Interpreter' }
];

describe('reading what the model answered', () => {
	it('takes a tool that is not on yet', () => {
		const read = readSuggestion(
			{ enable: ['wetter'], reason: 'Braucht aktuelle Daten' },
			catalogue,
			selection()
		);
		expect(read.enable.map((item) => item.id)).toEqual(['wetter']);
		expect(read.enable[0].name).toBe('Wetter');
		expect(read.reason).toBe('Braucht aktuelle Daten');
	});

	it('takes a mode', () => {
		const read = readSuggestion({ enable: [WEB_SEARCH] }, catalogue, selection());
		expect(read.enable[0].kind).toBe('feature');
	});

	it('drops an id nothing answers to', () => {
		// A model that invents a tool must not put a row on screen for it.
		expect(readSuggestion({ enable: ['erfunden'] }, catalogue, selection()).enable).toEqual([]);
	});

	it('drops asking for what is already on', () => {
		const read = readSuggestion(
			{ enable: ['wetter'] },
			catalogue,
			selection({ toolIds: ['wetter'] })
		);
		expect(isEmptySuggestion(read)).toBe(true);
	});

	it('drops asking to switch off what is already off', () => {
		expect(
			isEmptySuggestion(readSuggestion({ disable: ['rechner'] }, catalogue, selection()))
		).toBe(true);
	});

	it('keeps switching something off that is on', () => {
		const read = readSuggestion(
			{ disable: ['rechner'] },
			catalogue,
			selection({ toolIds: ['rechner'] })
		);
		expect(read.disable.map((item) => item.id)).toEqual(['rechner']);
	});

	it('drops an id named on both sides rather than guessing', () => {
		const read = readSuggestion(
			{ enable: ['wetter'], disable: ['wetter'] },
			catalogue,
			selection()
		);
		expect(isEmptySuggestion(read)).toBe(true);
	});

	it('drops a repeated id', () => {
		const read = readSuggestion({ enable: ['wetter', 'wetter'] }, catalogue, selection());
		expect(read.enable).toHaveLength(1);
	});

	it('survives nonsense', () => {
		expect(isEmptySuggestion(readSuggestion(null, catalogue, selection()))).toBe(true);
		expect(isEmptySuggestion(readSuggestion('nein', catalogue, selection()))).toBe(true);
		expect(isEmptySuggestion(readSuggestion({ enable: 'wetter' }, catalogue, selection()))).toBe(
			true
		);
	});

	it('ignores ids that are not strings', () => {
		expect(
			readSuggestion({ enable: [3, null, 'wetter'] }, catalogue, selection()).enable
		).toHaveLength(1);
	});

	it('tidies and caps the reason', () => {
		expect(readSuggestion({ reason: '  viel\n  Platz ' }, catalogue, selection()).reason).toBe(
			'viel Platz'
		);
		expect(
			readSuggestion({ reason: 'x'.repeat(1000) }, catalogue, selection()).reason
		).toHaveLength(MAX_REASON);
	});

	it('reads a duplicated catalogue id as the first one given', () => {
		// The backend puts real tools first, so a tool keeps its own id.
		const doubled: SuggestionCandidate[] = [
			{ id: 'x', kind: 'tool', name: 'Werkzeug' },
			{ id: 'x', kind: 'skill', name: 'Skill' }
		];
		expect(readSuggestion({ enable: ['x'] }, doubled, selection()).enable[0].kind).toBe('tool');
	});
});

describe('knowing what is already on', () => {
	it('reads each kind out of the selection', () => {
		const on = selection({
			toolIds: ['wetter'],
			skillIds: ['lektorat'],
			webSearch: true,
			imageGeneration: true,
			codeInterpreter: true
		});
		expect(isOn(on, catalogue[0])).toBe(true);
		expect(isOn(on, catalogue[2])).toBe(true);
		expect(isOn(on, { id: WEB_SEARCH, kind: 'feature', name: '' })).toBe(true);
		expect(isOn(on, { id: IMAGE_GENERATION, kind: 'feature', name: '' })).toBe(true);
		expect(isOn(on, { id: CODE_INTERPRETER, kind: 'feature', name: '' })).toBe(true);
	});

	it('reads an unknown mode as off rather than throwing', () => {
		expect(isOn(selection(), { id: 'feature:erfunden', kind: 'feature', name: '' })).toBe(false);
	});
});

describe('taking the suggestion', () => {
	it('switches on what was suggested', () => {
		const read = readSuggestion(
			{ enable: ['wetter', WEB_SEARCH], disable: ['rechner'] },
			catalogue,
			selection({ toolIds: ['rechner'] })
		);
		const applied = applySuggestion(selection({ toolIds: ['rechner'] }), read);
		expect(applied.toolIds).toEqual(['wetter']);
		expect(applied.webSearch).toBe(true);
	});

	it('takes only the parts that were ticked', () => {
		const read = readSuggestion({ enable: ['wetter', 'rechner'] }, catalogue, selection());
		const applied = applySuggestion(selection(), read, new Set(['wetter']));
		expect(applied.toolIds).toEqual(['wetter']);
	});

	it('changes nothing when nothing was ticked', () => {
		const read = readSuggestion({ enable: ['wetter'] }, catalogue, selection());
		expect(applySuggestion(selection(), read, new Set())).toEqual(emptySelection());
	});

	it('switches a skill on and off', () => {
		const on = readSuggestion({ enable: ['lektorat'] }, catalogue, selection());
		expect(applySuggestion(selection(), on).skillIds).toEqual(['lektorat']);

		const off = readSuggestion(
			{ disable: ['lektorat'] },
			catalogue,
			selection({ skillIds: ['lektorat'] })
		);
		expect(applySuggestion(selection({ skillIds: ['lektorat'] }), off).skillIds).toEqual([]);
	});

	it('leaves the selection it was given alone', () => {
		const before = selection({ toolIds: ['rechner'] });
		const read = readSuggestion({ enable: ['wetter'] }, catalogue, before);
		applySuggestion(before, read);
		expect(before.toolIds).toEqual(['rechner']);
	});

	it('lists what it would change, enables first', () => {
		const read = readSuggestion(
			{ enable: ['wetter'], disable: ['rechner'] },
			catalogue,
			selection({ toolIds: ['rechner'] })
		);
		expect(suggestedItems(read).map((item) => item.id)).toEqual(['wetter', 'rechner']);
	});
});

describe('deciding whether to ask at all', () => {
	it('does not ask when there is nothing to recommend', () => {
		expect(worthAsking([], 'was ist das Wetter', 0)).toBe(false);
	});

	it('does not ask for a message with no words and no files', () => {
		expect(worthAsking(catalogue, '   ', 0)).toBe(false);
	});

	it('asks for a message that is only files', () => {
		expect(worthAsking(catalogue, '', 2)).toBe(true);
	});

	it('asks for an ordinary message', () => {
		expect(worthAsking(catalogue, 'was ist das Wetter', 0)).toBe(true);
	});
});

describe('remembering what was already asked', () => {
	it('reads the same message the same way however it was spaced', () => {
		expect(suggestionKey('  Was  ist\ndas Wetter ')).toBe(suggestionKey('was ist das wetter'));
	});

	it('tells two different messages apart', () => {
		expect(suggestionKey('Wetter')).not.toBe(suggestionKey('Aktien'));
	});

	it('counts attachments, because they change the answer', () => {
		expect(suggestionKey('lies das', 0)).not.toBe(suggestionKey('lies das', 1));
	});

	it('survives an empty suggestion object', () => {
		expect(isEmptySuggestion(emptySuggestion())).toBe(true);
	});
});
