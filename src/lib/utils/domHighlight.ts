/**
 * Painting search hits onto rendered messages.
 *
 * Rendered Markdown is a tree, and a match found in the flat text of a message
 * can begin in one element and end in another. Two things follow:
 *
 * - The text has to be flattened with a record of where each piece came from,
 *   so an offset can be turned back into a position in the tree.
 * - The highlight must not change the tree. Wrapping matches in `<mark>` would
 *   mean editing DOM that Svelte owns, and Svelte would undo it on the next
 *   render. The CSS Custom Highlight API paints ranges without touching them.
 *
 * The offset arithmetic is the part that can be wrong, so it is separated from
 * the browser calls and takes anything with a `data` string -- which is what
 * makes it testable where there is no DOM.
 */

/** As much of a text node as this module needs. */
export interface TextLike {
	readonly data: string;
}

export interface TextSpan<T extends TextLike = TextLike> {
	node: T;
	/** Where this node's first character sits in the flattened text. */
	start: number;
}

export interface FlatText<T extends TextLike = TextLike> {
	text: string;
	/** Ascending by `start`, and never overlapping. */
	spans: TextSpan<T>[];
}

/** A position inside one node. */
export interface Point<T extends TextLike = TextLike> {
	node: T;
	offset: number;
}

/**
 * Turn an offset in the flattened text back into a position in a node.
 *
 * Offsets can land on a separator that belongs to no node -- the newline put
 * between two blocks -- so the answer is clamped to the end of the node that
 * precedes it rather than refused.
 */
export const locate = <T extends TextLike>(flat: FlatText<T>, offset: number): Point<T> | null => {
	const spans = flat?.spans ?? [];
	if (spans.length === 0 || offset < 0) return null;

	let low = 0;
	let high = spans.length - 1;
	let found = -1;

	while (low <= high) {
		const middle = (low + high) >> 1;
		if (spans[middle].start <= offset) {
			found = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}

	if (found === -1) return null;

	const span = spans[found];
	return { node: span.node, offset: Math.min(offset - span.start, span.node.data.length) };
};

/**
 * Elements that put their content on its own line.
 *
 * Used to decide where a separator belongs, so that the last word of one
 * paragraph does not fuse with the first word of the next -- matching how the
 * search index treats the same content.
 */
const BLOCK_TAGS = new Set([
	'ADDRESS',
	'ARTICLE',
	'ASIDE',
	'BLOCKQUOTE',
	'BR',
	'DD',
	'DETAILS',
	'DIV',
	'DL',
	'DT',
	'FIELDSET',
	'FIGCAPTION',
	'FIGURE',
	'FOOTER',
	'FORM',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'HEADER',
	'HR',
	'LI',
	'MAIN',
	'NAV',
	'OL',
	'P',
	'PRE',
	'SECTION',
	'SUMMARY',
	'TABLE',
	'TD',
	'TH',
	'TR',
	'UL'
]);

/** Never contributes text a reader can see. */
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

/**
 * Flatten an element's visible text, recording where every piece came from.
 *
 * Marked-up elements that carry no text of their own still separate the text
 * around them, so a newline is emitted when a block closes. Runs of whitespace
 * are left alone here: the matcher folds them, and folding twice would put the
 * offsets out of step.
 */
export const flatten = (root: Element | null): FlatText<Text> => {
	const spans: TextSpan<Text>[] = [];
	const parts: string[] = [];
	let length = 0;

	if (!root) return { text: '', spans };

	const separate = () => {
		if (length === 0) return;
		parts.push('\n');
		length += 1;
	};

	const walk = (node: Node) => {
		if (node.nodeType === 3 /* Node.TEXT_NODE */) {
			const text = node as Text;
			if (text.data.length === 0) return;
			spans.push({ node: text, start: length });
			parts.push(text.data);
			length += text.data.length;
			return;
		}

		if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) return;

		const element = node as Element;
		if (SKIPPED_TAGS.has(element.tagName)) return;
		// `hidden` is the one form of invisibility cheap enough to check on every
		// element; anything costlier would mean a layout pass per message.
		if (element.hasAttribute('hidden')) return;

		const isBlock = BLOCK_TAGS.has(element.tagName);
		if (isBlock) separate();

		for (let child = element.firstChild; child; child = child.nextSibling) {
			walk(child);
		}

		if (isBlock) separate();
	};

	walk(root);
	return { text: parts.join(''), spans };
};

/** A DOM range over a stretch of the flattened text, or null if it cannot be placed. */
export const rangeFor = (flat: FlatText<Text>, start: number, end: number): Range | null => {
	const from = locate(flat, start);
	const to = locate(flat, end);
	if (!from || !to) return null;

	try {
		const range = document.createRange();
		range.setStart(from.node, from.offset);
		range.setEnd(to.node, to.offset);
		return range.collapsed && start !== end ? null : range;
	} catch {
		return null;
	}
};

export const HIGHLIGHT_ALL = 'owui-find';
export const HIGHLIGHT_CURRENT = 'owui-find-current';

interface HighlightRegistry {
	set(name: string, highlight: unknown): void;
	delete(name: string): void;
}

const registry = (): HighlightRegistry | null => {
	if (typeof CSS === 'undefined') return null;
	const highlights = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
	return highlights ?? null;
};

/**
 * Whether hits can be painted in place.
 *
 * Where they cannot, the caller still scrolls to the message and marks it; only
 * the character-level highlight is lost.
 */
export const supportsHighlights = (): boolean =>
	registry() !== null && typeof (globalThis as { Highlight?: unknown }).Highlight === 'function';

/** Paint one set of ranges under a name declared in the stylesheet. */
export const paint = (name: string, ranges: Range[]): void => {
	const highlights = registry();
	if (!highlights) return;

	if (ranges.length === 0) {
		highlights.delete(name);
		return;
	}

	const Constructor = (globalThis as { Highlight?: new (...args: Range[]) => unknown }).Highlight;
	if (!Constructor) return;

	try {
		highlights.set(name, new Constructor(...ranges));
	} catch {
		highlights.delete(name);
	}
};

export const clearPaint = (...names: string[]): void => {
	const highlights = registry();
	if (!highlights) return;
	for (const name of names.length ? names : [HIGHLIGHT_ALL, HIGHLIGHT_CURRENT]) {
		highlights.delete(name);
	}
};

/**
 * The collapsed blocks inside an element, in document order.
 *
 * A closed tool call or reasoning block renders none of its content, so text
 * the index found is not on the page until these are opened.
 */
export const collapsedTriggers = (root: Element | null): HTMLElement[] =>
	root ? Array.from(root.querySelectorAll<HTMLElement>('button[aria-expanded="false"]')) : [];
