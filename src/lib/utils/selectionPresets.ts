/**
 * Named selections the reader can put on in one click.
 *
 * A default answers "what should every new chat start with". A preset answers
 * the other question: "I have three or four ways I work, let me switch between
 * them". Without one the only way to move between two sets of tools was to tick
 * them off and on again, one row at a time, every time.
 *
 * They live in the reader's settings, so they follow them to every browser they
 * sign in from, the same way the default does.
 */

import {
	emptySelection,
	readSelection,
	sameSelection,
	type ComposerSelection
} from './composerSelection';

export interface SelectionPreset {
	id: string;
	name: string;
	selection: ComposerSelection;
}

/**
 * How many presets one reader may keep.
 *
 * Not a technical limit -- settings are small -- but a list longer than this
 * stops being something you pick from and becomes something you search, and the
 * menu it lives in is not built for searching.
 */
export const MAX_PRESETS = 24;

/** The longest a name may be before it stops fitting the row it is shown in. */
export const MAX_PRESET_NAME = 40;

/** Trim a name to something that can be stored and shown. */
export const presetName = (raw: unknown): string =>
	typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_PRESET_NAME) : '';

const readPreset = (value: unknown): SelectionPreset | null => {
	if (!value || typeof value !== 'object') return null;

	const source = value as Record<string, unknown>;
	const name = presetName(source.name);
	if (name === '') return null;

	const id = typeof source.id === 'string' && source.id !== '' ? source.id : null;
	if (id === null) return null;

	return { id, name, selection: readSelection(source.selection) };
};

/** Read the presets out of settings, however old or hand-edited. */
export const readPresets = (settings: Record<string, unknown> | null | undefined) => {
	const stored = settings?.selectionPresets;
	if (!Array.isArray(stored)) return [];

	const seen = new Set<string>();
	const presets: SelectionPreset[] = [];
	for (const entry of stored) {
		const preset = readPreset(entry);
		// A duplicate id would make every edit ambiguous about which one it meant.
		if (preset && !seen.has(preset.id)) {
			seen.add(preset.id);
			presets.push(preset);
		}
		if (presets.length >= MAX_PRESETS) break;
	}
	return presets;
};

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Whether a name is already taken, ignoring one preset (the one being renamed). */
export const nameTaken = (presets: SelectionPreset[], name: string, exceptId?: string): boolean =>
	presets.some((preset) => preset.id !== exceptId && sameName(preset.name, name));

export type PresetError = 'empty-name' | 'duplicate-name' | 'too-many';

const newId = () =>
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Add one, or say why not.
 *
 * An empty selection is allowed on purpose: "everything off" is a way of
 * working, and it is the one that is most tedious to reach by hand.
 */
export const addPreset = (
	presets: SelectionPreset[],
	name: string,
	selection: ComposerSelection
): { presets: SelectionPreset[]; error?: PresetError } => {
	const clean = presetName(name);
	if (clean === '') return { presets, error: 'empty-name' };
	if (nameTaken(presets, clean)) return { presets, error: 'duplicate-name' };
	if (presets.length >= MAX_PRESETS) return { presets, error: 'too-many' };

	return { presets: [...presets, { id: newId(), name: clean, selection }] };
};

export const removePreset = (presets: SelectionPreset[], id: string): SelectionPreset[] =>
	presets.filter((preset) => preset.id !== id);

export const renamePreset = (
	presets: SelectionPreset[],
	id: string,
	name: string
): { presets: SelectionPreset[]; error?: PresetError } => {
	const clean = presetName(name);
	if (clean === '') return { presets, error: 'empty-name' };
	if (nameTaken(presets, clean, id)) return { presets, error: 'duplicate-name' };

	return {
		presets: presets.map((preset) => (preset.id === id ? { ...preset, name: clean } : preset))
	};
};

/** Point an existing preset at what is switched on now. */
export const replacePreset = (
	presets: SelectionPreset[],
	id: string,
	selection: ComposerSelection
): SelectionPreset[] =>
	presets.map((preset) => (preset.id === id ? { ...preset, selection } : preset));

/** Which preset, if any, is exactly what is switched on now. */
export const activePreset = (
	presets: SelectionPreset[],
	selection: ComposerSelection
): SelectionPreset | null =>
	presets.find((preset) => sameSelection(preset.selection, selection)) ?? null;

export interface PresetSummary {
	tools: number;
	skills: number;
	filters: number;
	modes: number;
	empty: boolean;
}

/** What a preset holds, for a line of text under its name. */
export const summarize = (selection: ComposerSelection): PresetSummary => {
	const modes = [selection.webSearch, selection.imageGeneration, selection.codeInterpreter].filter(
		Boolean
	).length;

	const summary = {
		tools: selection.toolIds.length,
		skills: selection.skillIds.length,
		filters: selection.filterIds.length,
		modes
	};

	return {
		...summary,
		empty: summary.tools + summary.skills + summary.filters + modes === 0
	};
};

/** A preset holding nothing at all, for the "everything off" case. */
export const emptyPreset = (name: string): SelectionPreset => ({
	id: newId(),
	name: presetName(name),
	selection: emptySelection()
});
