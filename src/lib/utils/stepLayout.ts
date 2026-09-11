/**
 * How the steps of an answer -- tool calls, thoughts, and the notes written
 * between them -- are laid out.
 *
 * By default a whole run of steps folds into one "Explored ..." line, with the
 * answer below it. That keeps a finished answer short, and it is the right
 * default. It also means a long agentic turn is one line until opened, which
 * is the wrong default for anyone who reads the process as closely as the
 * result.
 *
 * Two settings change it, each on its own or together:
 *
 * - `inline`     -- every step on its own line, in the order it happened, with
 *                   the notes between them as ordinary text. Nothing is folded
 *                   at the level of the run.
 * - `groupTools` -- tool calls that follow one another directly share one
 *                   expandable row. A thought, or a line of text, ends the row:
 *                   those are where the assistant stopped to think or to say
 *                   something, and they stay in view.
 *
 * Together, the run is laid out flat with each burst of back-to-back tool
 * calls folded into a row of its own. `groupTools` alone folds the bursts
 * inside the run's "Explored ..." group, for when that is opened.
 */

export interface StepLayout {
	inline: boolean;
	groupTools: boolean;
}

export const DEFAULT_STEP_LAYOUT: StepLayout = { inline: false, groupTools: false };

/** The layout from the reader's settings; anything but `true` is off. */
export const readStepLayout = (
	settings: Record<string, unknown> | null | undefined
): StepLayout => ({
	inline: settings?.showStepsInline === true,
	groupTools: settings?.groupToolCalls === true
});

/** Whether a run group should fold its bursts of tool calls when opened. */
export const foldsBurstsInsideRuns = (layout: StepLayout): boolean =>
	layout.groupTools && !layout.inline;

export type StepPart<T> = { kind: 'tools'; items: T[] } | { kind: 'single'; item: T };

/**
 * Fold bursts of back-to-back tool calls, and leave everything else in place.
 *
 * A burst ends at anything that is not a tool call -- a thought, a note, an
 * answer, a file -- except what `isTransparent` says is only spacing: blank
 * space between two blocks is neither a thought nor text, so it neither ends a
 * burst nor is lost from it. Spacing inside a burst stays inside, spacing
 * after the last call comes back out after it.
 *
 * A burst of one is left single: a group of one is a heading with nothing
 * under it. Every item comes back exactly once, in order.
 */
export const groupToolBursts = <T>(
	items: readonly T[],
	isToolCall: (item: T) => boolean,
	isTransparent: (item: T) => boolean = () => false
): StepPart<T>[] => {
	const parts: StepPart<T>[] = [];
	let burst: T[] = [];
	// Spacing seen after a call: between two calls if another follows, trailing
	// the burst if not. Undecided until the next item arrives.
	let held: T[] = [];

	const flush = () => {
		if (burst.filter(isToolCall).length > 1) {
			parts.push({ kind: 'tools', items: burst });
		} else {
			for (const item of burst) parts.push({ kind: 'single', item });
		}
		for (const item of held) parts.push({ kind: 'single', item });
		burst = [];
		held = [];
	};

	for (const item of items) {
		if (isToolCall(item)) {
			burst.push(...held, item);
			held = [];
		} else if (burst.length > 0 && isTransparent(item)) {
			held.push(item);
		} else {
			flush();
			parts.push({ kind: 'single', item });
		}
	}
	flush();

	return parts;
};

/**
 * The parts of a run group's content, in order.
 *
 * Bursts fold only when the layout folds them inside runs; otherwise every
 * step is a part of its own, so the default layout renders exactly as it did.
 */
export const runParts = <T>(
	items: readonly T[],
	layout: StepLayout,
	isToolCall: (item: T) => boolean,
	isTransparent: (item: T) => boolean = () => false
): StepPart<T>[] =>
	foldsBurstsInsideRuns(layout)
		? groupToolBursts(items, isToolCall, isTransparent)
		: items.map((item) => ({ kind: 'single', item }));
