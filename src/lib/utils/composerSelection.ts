/**
 * What a conversation has switched on, and where that comes from.
 *
 * The selection lived nowhere durable. It was held in an unsent draft that is
 * deleted the moment a message is sent, and rebuilt from the model's configured
 * defaults on every mount -- so whatever the reader had chosen was replaced by
 * the model's list each time a chat was opened or started.
 *
 * There are three possible sources and they are not equal:
 *
 * 1. What this conversation was last using. A chat that ran with three tools
 *    should come back with those three, not with whatever the model lists now.
 * 2. What the reader saved as their own starting point.
 * 3. What the model is configured with.
 *
 * A saved conversation answers for itself. A new one starts from the reader's
 * default if they set one, and from the model's list if they did not -- which
 * is the mechanism the project already documents, kept working rather than
 * replaced.
 */

export interface ComposerSelection {
	toolIds: string[];
	skillIds: string[];
	filterIds: string[];
	webSearch: boolean;
	imageGeneration: boolean;
	codeInterpreter: boolean;
}

export const emptySelection = (): ComposerSelection => ({
	toolIds: [],
	skillIds: [],
	filterIds: [],
	webSearch: false,
	imageGeneration: false,
	codeInterpreter: false
});

const ids = (value: unknown): string[] =>
	Array.isArray(value)
		? [...new Set(value.filter((id): id is string => typeof id === 'string'))]
		: [];

const flag = (value: unknown): boolean => value === true;

/** Read a selection out of anything stored, however old or hand-edited. */
export const readSelection = (value: unknown): ComposerSelection => {
	const source = (value ?? {}) as Record<string, unknown>;
	return {
		toolIds: ids(source.toolIds ?? source.selectedToolIds),
		skillIds: ids(source.skillIds ?? source.selectedSkillIds),
		filterIds: ids(source.filterIds ?? source.selectedFilterIds),
		webSearch: flag(source.webSearch ?? source.webSearchEnabled),
		imageGeneration: flag(source.imageGeneration ?? source.imageGenerationEnabled),
		codeInterpreter: flag(source.codeInterpreter ?? source.codeInterpreterEnabled)
	};
};

/** Whether a selection asks for anything at all. */
export const isEmptySelection = (selection: ComposerSelection): boolean =>
	selection.toolIds.length === 0 &&
	selection.skillIds.length === 0 &&
	selection.filterIds.length === 0 &&
	!selection.webSearch &&
	!selection.imageGeneration &&
	!selection.codeInterpreter;

const sameIds = (a: string[], b: string[]): boolean =>
	a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);

/**
 * Whether two selections ask for the same thing.
 *
 * Order-insensitive, because the order tools were ticked in is not something
 * anyone chose, and comparing by it would save the chat on every reorder.
 */
export const sameSelection = (a: ComposerSelection, b: ComposerSelection): boolean =>
	sameIds(a.toolIds, b.toolIds) &&
	sameIds(a.skillIds, b.skillIds) &&
	sameIds(a.filterIds, b.filterIds) &&
	a.webSearch === b.webSearch &&
	a.imageGeneration === b.imageGeneration &&
	a.codeInterpreter === b.codeInterpreter;

export interface AvailableIds {
	toolIds: string[];
	skillIds: string[];
	filterIds: string[];
}

/**
 * Drop what is no longer there.
 *
 * A tool can be deleted, or a server can go away, long after a conversation
 * chose it. Sending an id nothing answers to is worse than sending nothing:
 * the request fails somewhere the reader cannot see.
 */
export const prune = (
	selection: ComposerSelection,
	available: Partial<AvailableIds>
): ComposerSelection => {
	const keep = (chosen: string[], exists: string[] | undefined) =>
		exists === undefined ? chosen : chosen.filter((id) => exists.includes(id));

	return {
		...selection,
		toolIds: keep(selection.toolIds, available.toolIds),
		skillIds: keep(selection.skillIds, available.skillIds),
		filterIds: keep(selection.filterIds, available.filterIds)
	};
};

export interface SelectionSources {
	/** What this conversation was last using, if it is a saved one. */
	saved?: unknown;
	/** What the reader saved as the starting point for new conversations. */
	userDefault?: unknown;
	/** The tools the model is configured with. */
	modelToolIds?: string[];
	/** The skills the model is configured with. */
	modelSkillIds?: string[];
	/** The toggleable filters the model switches on by default. */
	modelFilterIds?: string[];
	/** The modes the model switches on: web_search, image_generation, code_interpreter. */
	modelFeatureIds?: string[];
}

/** The mode names a model uses in its default feature list. */
const FEATURES = {
	webSearch: 'web_search',
	imageGeneration: 'image_generation',
	codeInterpreter: 'code_interpreter'
} as const;

/**
 * The reader's own starting point, out of their settings.
 *
 * `tools` is the older shape: a bare list of tool ids that this app read but
 * never wrote, because no screen ever offered to set one. Anyone who put it
 * there by hand keeps it.
 */
export const readUserDefault = (
	settings: Record<string, unknown> | null | undefined
): ComposerSelection | null => {
	if (!settings) return null;

	const saved = settings.defaultSelection;
	if (saved !== undefined && saved !== null) return readSelection(saved);

	if (Array.isArray(settings.tools)) return { ...emptySelection(), toolIds: ids(settings.tools) };

	return null;
};

/**
 * The selection a conversation should open with.
 *
 * A saved conversation answers for itself and nothing overrides it -- that is
 * the whole point, and it is what was missing. Only a conversation that has
 * never chosen anything falls through to a default.
 */
export const resolveSelection = (
	sources: SelectionSources,
	available: Partial<AvailableIds> = {}
): ComposerSelection => {
	if (sources.saved !== undefined && sources.saved !== null) {
		return prune(readSelection(sources.saved), available);
	}

	const featureIds = ids(sources.modelFeatureIds);
	const model: ComposerSelection = {
		toolIds: ids(sources.modelToolIds),
		skillIds: ids(sources.modelSkillIds),
		filterIds: ids(sources.modelFilterIds),
		webSearch: featureIds.includes(FEATURES.webSearch),
		imageGeneration: featureIds.includes(FEATURES.imageGeneration),
		codeInterpreter: featureIds.includes(FEATURES.codeInterpreter)
	};

	// The reader's own default wins over the model's list: they set it later and
	// more deliberately. A model that lists tools still supplies them to someone
	// who has never expressed a preference.
	const preferred = sources.userDefault ? readSelection(sources.userDefault) : null;
	const chosen = preferred && !isEmptySelection(preferred) ? preferred : model;

	return prune(chosen, available);
};
