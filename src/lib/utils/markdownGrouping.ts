/**
 * Folding an agentic turn back into something a person can read.
 *
 * A turn that calls twenty tools renders as twenty separate rows, because the
 * assistant writes a sentence between each call and grouping only ever joined
 * details that were *adjacent*. One sentence of prose was enough to break the
 * run, so the thing designed to collapse a long tool sequence never fired on
 * the sequences that actually needed it.
 *
 * The rule that fixes it is about what the prose is, not where it sits:
 *
 *   Prose with more tool calls after it was written while working.
 *   Prose after the last tool call is the answer.
 *
 * So the first kind folds into the group and the second stays out. Live, that
 * means the newest note is always visible under a compact summary of
 * everything before it; finished, it means the turn reads as one folded
 * "Explored ..." line followed by what the assistant actually concluded.
 */

/**
 * A marked token, as far as this module cares.
 *
 * Only `type` and `attributes.type` are read here. The index signature is
 * deliberately `any` rather than `unknown`: these tokens are handed straight to
 * a renderer that reads `depth`, `raw`, `ordered` and a dozen other fields off
 * whichever kind it turns out to be, and narrowing them here would make the
 * caller cast every one of them back.
 */
type Token = {
	type?: string;
	attributes?: { type?: string };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
};

export type DisplayToken = Token | { type: 'detail_group'; items: Token[] };

/** Detail blocks that are process rather than answer. */
export const GROUPABLE_DETAIL_TYPES = new Set(['tool_calls', 'reasoning', 'code_interpreter']);

/**
 * Token types that may be folded in as working notes.
 *
 * Deliberately narrow. A sentence between two tool calls is commentary; a code
 * block, a table or a list is something the assistant produced, and hiding
 * output because it happened to sit mid-run would be a worse failure than the
 * one being fixed.
 */
export const ABSORBABLE_TYPES = new Set(['paragraph', 'space', 'text']);

export const isGroupableDetailToken = (token: Token | undefined): boolean =>
	token?.type === 'details' && GROUPABLE_DETAIL_TYPES.has(token?.attributes?.type ?? '');

const isAbsorbable = (token: Token | undefined): boolean => ABSORBABLE_TYPES.has(token?.type ?? '');

/**
 * Turn a flat token list into one where a whole run of tool activity is a
 * single item.
 *
 * A run collects groupable details, and any working notes between them, until
 * it meets something that is neither. Notes trailing the last detail are handed
 * back rather than swallowed -- they are the answer, and the caller renders
 * them as it always did.
 *
 * A run of exactly one detail is passed through unwrapped, because a group of
 * one is a heading with nothing under it.
 */
export const getDisplayTokens = (tokenList: Token[] = []): DisplayToken[] => {
	const display: DisplayToken[] = [];
	let index = 0;

	while (index < tokenList.length) {
		if (!isGroupableDetailToken(tokenList[index])) {
			display.push(tokenList[index]);
			index += 1;
			continue;
		}

		const group: Token[] = [];
		// Notes seen since the last detail. They join the group only once
		// another detail turns up behind them; otherwise they belong to the
		// answer and are given back.
		let pending: Token[] = [];
		let cursor = index;

		while (cursor < tokenList.length) {
			const token = tokenList[cursor];
			if (isGroupableDetailToken(token)) {
				group.push(...pending, token);
				pending = [];
				cursor += 1;
			} else if (isAbsorbable(token)) {
				pending.push(token);
				cursor += 1;
			} else {
				break;
			}
		}

		if (group.length > 1) {
			display.push({ type: 'detail_group', items: group });
		} else {
			display.push(...group);
		}

		// Resume at the first note that did not make it into the group.
		index = cursor - pending.length;
	}

	return display;
};

/** How many tool calls a group holds, for deciding whether it is worth folding. */
export const countToolCalls = (items: Token[] = []): number =>
	items.filter((item) => item?.attributes?.type === 'tool_calls').length;
