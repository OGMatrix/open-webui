import { markdownToText } from './chatSearch';

/**
 * The shape of a conversation, for moving around inside a long one.
 *
 * An agentic run is mostly machinery: one question can be followed by twenty
 * tool calls and a page of reasoning. What structures it is the questions, and
 * the points where the history was compacted away. Those are what the outline
 * lists, and what stepping through turns steps between.
 */

export type OutlineKind = 'user' | 'compaction';

export interface OutlineEntry {
	/** The message to scroll to. */
	id: string;
	kind: OutlineKind;
	/** Position in the branch, oldest first. */
	turn: number;
	/** The first line of the message, for a label. */
	label: string;
	/** Tool calls in the answer to this question. */
	toolCalls: number;
	/** Reasoning blocks in the answer to this question. */
	reasoning: number;
	/** Assistant messages this question drew, which is not always one. */
	replies: number;
}

export interface OutlineMessage {
	id?: string;
	role?: string;
	content?: string;
	contextSummary?: unknown;
	context_summary?: unknown;
	[key: string]: unknown;
}

const DETAIL_OF_TYPE = (type: string) => new RegExp(`<details\\b[^>]*\\btype="${type}"`, 'g');

const countDetails = (content: string, type: string): number =>
	content ? (content.match(DETAIL_OF_TYPE(type)) ?? []).length : 0;

const LABEL_LIMIT = 90;

/**
 * Labels already worked out, because the outline is rebuilt constantly.
 *
 * While an answer streams, the branch changes on every frame and the outline
 * with it -- but the questions in it do not, and lexing each of them sixty
 * times a second to arrive at the same string is the one expensive thing here.
 * Bounded, so a long session cannot grow it without limit.
 */
const LABEL_CACHE = new Map<string, string>();
const LABEL_CACHE_LIMIT = 512;

/**
 * A one-line name for a message.
 *
 * The first line that has anything in it, because a question often opens with a
 * blank line or a heading marker, and because the rest of it will not fit.
 */
export const labelFor = (content: string): string => {
	const source = content ?? '';
	const cached = LABEL_CACHE.get(source);
	if (cached !== undefined) return cached;

	const label = computeLabel(source);

	if (LABEL_CACHE.size >= LABEL_CACHE_LIMIT) {
		// Oldest first, which is insertion order for a Map.
		LABEL_CACHE.delete(LABEL_CACHE.keys().next().value as string);
	}
	LABEL_CACHE.set(source, label);
	return label;
};

const computeLabel = (content: string): string => {
	const text = markdownToText(content ?? '');
	const line = text
		.split('\n')
		.map((part) => part.trim())
		.find((part) => part.length > 0);

	if (!line) return '';
	return line.length > LABEL_LIMIT ? `${line.slice(0, LABEL_LIMIT - 1).trimEnd()}…` : line;
};

/**
 * Build the outline of a branch.
 *
 * Assistant messages do not get entries of their own; what they contribute is
 * counted onto the question that produced them, so the outline stays as long as
 * the conversation felt rather than as long as it technically is.
 */
export const buildOutline = (messages: OutlineMessage[]): OutlineEntry[] => {
	const entries: OutlineEntry[] = [];
	let open: OutlineEntry | null = null;

	(messages ?? []).forEach((message, turn) => {
		const id = String(message?.id ?? '');
		const content = String(message?.content ?? '');

		// Compaction happened before this message, so it is listed before it.
		if (message?.contextSummary ?? message?.context_summary) {
			entries.push({
				id,
				kind: 'compaction',
				turn,
				label: '',
				toolCalls: 0,
				reasoning: 0,
				replies: 0
			});
			open = null;
		}

		if (message?.role === 'user') {
			open = {
				id,
				kind: 'user',
				turn,
				label: labelFor(content),
				toolCalls: 0,
				reasoning: 0,
				replies: 0
			};
			entries.push(open);
			return;
		}

		if (open) {
			open.replies += 1;
			open.toolCalls += countDetails(content, 'tool_calls');
			open.reasoning += countDetails(content, 'reasoning');
		}
	});

	return entries;
};

/**
 * The entry a step in `direction` lands on.
 *
 * Stops at the ends rather than wrapping: a conversation has a beginning and an
 * end, and silently jumping from one to the other loses the reader's place.
 */
export const stepOutline = (
	outline: OutlineEntry[],
	fromId: string | null,
	direction: 1 | -1
): OutlineEntry | null => {
	if (!outline?.length) return null;

	const at = outline.findIndex((entry) => entry.id === fromId);
	if (at === -1) {
		return direction === 1 ? outline[0] : outline[outline.length - 1];
	}

	const next = at + direction;
	if (next < 0 || next >= outline.length) return null;
	return outline[next];
};

/**
 * The entry the reader is inside, given how far down the branch they are.
 *
 * The last entry at or above the message on screen: an answer belongs to the
 * question that asked it, however far below that question it is.
 */
export const entryForTurn = (outline: OutlineEntry[], turn: number): OutlineEntry | null => {
	let found: OutlineEntry | null = null;
	for (const entry of outline ?? []) {
		if (entry.turn <= turn) found = entry;
		else break;
	}
	return found;
};
