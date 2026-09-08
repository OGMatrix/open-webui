/**
 * What the task model thinks this message needs switched on.
 *
 * The model that writes chat titles and follow-up questions is asked one more
 * thing: given what is about to be sent and what this reader can actually turn
 * on, is anything missing, and is anything on that has no business being on.
 *
 * It is a suggestion, shown and waited on -- never applied by itself. The
 * community's auto-tool filters switch tools on silently, which is quick until
 * the day it is wrong and nobody can see why the answer came out strange. What
 * is offered here can be read, taken, or waved away, and the message goes
 * either way.
 */

import { emptySelection, type ComposerSelection } from './composerSelection';

/** The kinds of thing that can be recommended. */
export type SuggestionKind = 'tool' | 'skill' | 'feature';

export interface SuggestionCandidate {
	id: string;
	kind: SuggestionKind;
	name: string;
	description?: string;
}

/**
 * The three modes, addressed under a prefix of their own.
 *
 * A tool's id comes from whoever wrote the tool, so without a prefix a tool
 * called `web_search` and the web search mode would be the same string, and the
 * suggestion would silently mean the wrong one.
 */
export const FEATURE_PREFIX = 'feature:';
export const WEB_SEARCH = `${FEATURE_PREFIX}web_search`;
export const IMAGE_GENERATION = `${FEATURE_PREFIX}image_generation`;
export const CODE_INTERPRETER = `${FEATURE_PREFIX}code_interpreter`;

export interface SuggestionItem extends SuggestionCandidate {
	/** Whether the suggestion is to switch this on or off. */
	on: boolean;
}

export interface ToolSuggestion {
	enable: SuggestionItem[];
	disable: SuggestionItem[];
	/** The model's one-line reason, as it will be shown. */
	reason: string;
}

/** The longest reason worth showing before it stops being a line and becomes a paragraph. */
export const MAX_REASON = 240;

export const emptySuggestion = (): ToolSuggestion => ({ enable: [], disable: [], reason: '' });

export const isEmptySuggestion = (suggestion: ToolSuggestion): boolean =>
	suggestion.enable.length === 0 && suggestion.disable.length === 0;

/** Index a catalogue by id, keeping the first of any repeat. */
const byId = (catalogue: SuggestionCandidate[]): Map<string, SuggestionCandidate> => {
	const index = new Map<string, SuggestionCandidate>();
	for (const candidate of catalogue) {
		if (candidate && typeof candidate.id === 'string' && !index.has(candidate.id)) {
			index.set(candidate.id, candidate);
		}
	}
	return index;
};

/** Whether a candidate is currently switched on. */
export const isOn = (selection: ComposerSelection, candidate: SuggestionCandidate): boolean => {
	switch (candidate.kind) {
		case 'tool':
			return selection.toolIds.includes(candidate.id);
		case 'skill':
			return selection.skillIds.includes(candidate.id);
		case 'feature':
			if (candidate.id === WEB_SEARCH) return selection.webSearch;
			if (candidate.id === IMAGE_GENERATION) return selection.imageGeneration;
			if (candidate.id === CODE_INTERPRETER) return selection.codeInterpreter;
			return false;
	}
};

const ids = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

const reasonText = (value: unknown): string =>
	typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON) : '';

/**
 * Read what the model answered, against what is real.
 *
 * Everything is checked rather than trusted: an id nothing answers to is
 * dropped, an id asking for what is already the case is dropped as noise, and
 * an id named on both sides at once is dropped from both rather than guessed
 * at. What survives is a list of changes that would actually change something.
 */
export const readSuggestion = (
	value: unknown,
	catalogue: SuggestionCandidate[],
	current: ComposerSelection
): ToolSuggestion => {
	const source = (value ?? {}) as Record<string, unknown>;
	const index = byId(catalogue);

	const wanted = new Set(ids(source.enable));
	const unwanted = new Set(ids(source.disable));

	const collect = (from: Set<string>, other: Set<string>, on: boolean): SuggestionItem[] => {
		const items: SuggestionItem[] = [];
		const seen = new Set<string>();
		for (const id of from) {
			if (other.has(id) || seen.has(id)) continue;

			const candidate = index.get(id);
			if (!candidate) continue;
			// Asking for what is already true is not a suggestion.
			if (isOn(current, candidate) === on) continue;

			seen.add(id);
			items.push({ ...candidate, on });
		}
		return items;
	};

	return {
		enable: collect(wanted, unwanted, true),
		disable: collect(unwanted, wanted, false),
		reason: reasonText(source.reason)
	};
};

/** Everything the suggestion would change, in the order it is shown. */
export const suggestedItems = (suggestion: ToolSuggestion): SuggestionItem[] => [
	...suggestion.enable,
	...suggestion.disable
];

const withId = (list: string[], id: string, on: boolean): string[] =>
	on ? (list.includes(id) ? list : [...list, id]) : list.filter((entry) => entry !== id);

/**
 * Take the suggestion.
 *
 * `only` narrows it to the items the reader actually ticked, so a suggestion
 * with three parts can be taken in one, two or three of them.
 */
export const applySuggestion = (
	selection: ComposerSelection,
	suggestion: ToolSuggestion,
	only?: Set<string>
): ComposerSelection => {
	let next: ComposerSelection = { ...selection };

	for (const item of suggestedItems(suggestion)) {
		if (only && !only.has(item.id)) continue;

		if (item.kind === 'tool') {
			next = { ...next, toolIds: withId(next.toolIds, item.id, item.on) };
		} else if (item.kind === 'skill') {
			next = { ...next, skillIds: withId(next.skillIds, item.id, item.on) };
		} else if (item.id === WEB_SEARCH) {
			next = { ...next, webSearch: item.on };
		} else if (item.id === IMAGE_GENERATION) {
			next = { ...next, imageGeneration: item.on };
		} else if (item.id === CODE_INTERPRETER) {
			next = { ...next, codeInterpreter: item.on };
		}
	}

	return next;
};

/**
 * A stable key for a message, so the same one is not analysed twice.
 *
 * Sending, being told what is missing, waving it away and sending again should
 * not ask a second time; nor should editing a message down to the same words.
 */
export const suggestionKey = (prompt: string, attachmentCount = 0): string =>
	`${attachmentCount}:${(prompt ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 2000)}`;

/**
 * Whether asking is worth the wait.
 *
 * Nothing to recommend means nothing to wait for, and a message with no words
 * and no files is not going anywhere anyway.
 */
export const worthAsking = (
	catalogue: SuggestionCandidate[],
	prompt: string,
	attachmentCount = 0
): boolean => catalogue.length > 0 && ((prompt ?? '').trim().length > 0 || attachmentCount > 0);

/** The selection a fresh suggestion is measured against, for tests and callers with none. */
export const noSelection = emptySelection;
