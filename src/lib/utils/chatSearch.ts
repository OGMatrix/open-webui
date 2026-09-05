import { marked } from 'marked';

/**
 * Finding text in a conversation.
 *
 * Three things make this harder than `indexOf`, and each is handled here rather
 * than left to the caller:
 *
 * 1. What is on screen is not what is stored. The stored form is Markdown, so a
 *    search for "hello world" has to match `**hello** world`, and a search that
 *    crosses a line break has to match text the renderer joined into one line.
 * 2. Models write typographic punctuation. Someone typing `don't` means to find
 *    `don’t`, and someone typing `a - b` means to find `a – b`.
 * 3. Accented text has to be reachable from an unaccented keyboard.
 *
 * Folding the text solves all three, but folding changes lengths, so every fold
 * carries a map back to the original offsets. Callers get offsets into the text
 * they passed in, never into an internal representation.
 */

/** Half-open offsets into the string that was searched. */
export interface MatchRange {
	start: number;
	end: number;
}

export interface MatchOptions {
	/** Distinguish `Model` from `model`. Off by default, as in every find bar. */
	caseSensitive: boolean;
	/** Require the match to stand alone: `cat` but not `concatenate`. */
	wholeWord: boolean;
	/** Read the query as a regular expression instead of literal text. */
	regex: boolean;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
	caseSensitive: false,
	wholeWord: false,
	regex: false
};

/**
 * Punctuation a keyboard cannot easily produce, mapped to what it stands for.
 *
 * Only characters whose ASCII form is unambiguous. A guillemet becomes a double
 * quote because that is the character a user reaches for when searching for a
 * quotation; it is not a claim that the two are the same character.
 */
const PUNCTUATION_FOLDING: Record<string, string> = {
	'‘': "'",
	'’': "'",
	'‚': "'",
	'‛': "'",
	'′': "'",
	ʼ: "'",
	'“': '"',
	'”': '"',
	'„': '"',
	'‟': '"',
	'″': '"',
	'«': '"',
	'»': '"',
	'‐': '-',
	'‑': '-',
	'‒': '-',
	'–': '-',
	'—': '-',
	'―': '-',
	'−': '-',
	'…': '...',
	' ': ' ',
	' ': ' ',
	' ': ' '
};

const COMBINING_MARKS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃰︠-︯]/g;
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

export interface FoldedText {
	/** The comparable form. */
	text: string;
	/**
	 * Where each folded character came from.
	 *
	 * `offsets[i]` is the index in the original string that produced folded
	 * character `i`, and `offsets[text.length]` is the original length, so a
	 * folded range maps back with `offsets[start]` and `offsets[end]`.
	 */
	offsets: number[];
}

const isWhitespace = (character: string) => /\s/.test(character);

/**
 * Reduce text to a comparable form, keeping a way back to the original.
 *
 * Runs of whitespace collapse to a single space so a query can cross the line
 * breaks a renderer introduces; accents and typographic punctuation fold to
 * their plain equivalents; and unless the caller asks for case sensitivity the
 * result is lowercased.
 */
export const fold = (input: string, caseSensitive = false): FoldedText => {
	const out: string[] = [];
	const offsets: number[] = [];

	let index = 0;
	let lastWasSpace = false;

	while (index < input.length) {
		const codePoint = input.codePointAt(index) ?? 0;
		const character = String.fromCodePoint(codePoint);
		const width = character.length;

		if (isWhitespace(character)) {
			// A run of whitespace stands for exactly one space, so that a phrase
			// wrapped across two lines still reads as one phrase.
			if (!lastWasSpace) {
				out.push(' ');
				offsets.push(index);
				lastWasSpace = true;
			}
			index += width;
			continue;
		}

		lastWasSpace = false;

		let folded = PUNCTUATION_FOLDING[character] ?? character;
		folded = folded.normalize('NFKD').replace(COMBINING_MARKS, '');
		if (!caseSensitive) {
			folded = folded.toLowerCase();
		}

		// One source character can fold to several -- a ligature, an ellipsis --
		// and every one of them points back at the character it came from.
		//
		// One offset per UTF-16 unit, not per code point: `indexOf` reports UTF-16
		// indices, so an emoji has to occupy two entries or every offset after it
		// is wrong by one.
		for (const produced of folded) {
			out.push(produced);
			for (let unit = 0; unit < produced.length; unit += 1) {
				offsets.push(index);
			}
		}

		index += width;
	}

	offsets.push(input.length);
	return { text: out.join(''), offsets };
};

const isWordCharacter = (character: string | undefined) =>
	character !== undefined && WORD_CHARACTER.test(character);

/**
 * Whether a query can be compiled at all.
 *
 * Only regular expressions can fail, and they fail while being typed -- `[a` is
 * an error on the way to `[ab]`. The find bar reports it rather than silently
 * showing nothing.
 */
export const isQueryValid = (query: string, options: Partial<MatchOptions> = {}): boolean => {
	if (!(options.regex ?? DEFAULT_MATCH_OPTIONS.regex)) return true;
	if (query === '') return true;
	try {
		new RegExp(query, 'u');
		return true;
	} catch {
		try {
			new RegExp(query);
			return true;
		} catch {
			return false;
		}
	}
};

const buildRegex = (query: string, options: MatchOptions): RegExp | null => {
	const flags = options.caseSensitive ? 'gu' : 'giu';
	const source = options.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${query})(?![\\p{L}\\p{N}_])` : query;
	try {
		return new RegExp(source, flags);
	} catch {
		// A pattern that is not valid Unicode-mode may still be valid without it
		// (a lone `\d` inside a class, say). Losing `u` costs nothing here.
		try {
			return new RegExp(source, options.caseSensitive ? 'g' : 'gi');
		} catch {
			return null;
		}
	}
};

/**
 * Every occurrence of `query` in `text`, as offsets into `text`.
 *
 * Matches never overlap: the search resumes after the end of the one it just
 * found, which is what stepping through hits with a next button implies.
 */
export const findMatches = (
	text: string,
	query: string,
	options: Partial<MatchOptions> = {}
): MatchRange[] => {
	const settings = { ...DEFAULT_MATCH_OPTIONS, ...options };
	if (!text || !query) return [];

	if (settings.regex) {
		const pattern = buildRegex(query, settings);
		if (!pattern) return [];

		const ranges: MatchRange[] = [];
		let guard = 0;
		for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
			if (guard++ > 100_000) break;
			// A pattern that can match nothing would otherwise never advance.
			if (match[0] === '') {
				pattern.lastIndex += 1;
				continue;
			}
			ranges.push({ start: match.index, end: match.index + match[0].length });
		}
		return ranges;
	}

	const haystack = fold(text, settings.caseSensitive);
	const needle = fold(query, settings.caseSensitive);
	if (needle.text === '') return [];

	const ranges: MatchRange[] = [];
	let from = 0;

	for (;;) {
		const at = haystack.text.indexOf(needle.text, from);
		if (at === -1) break;

		const end = at + needle.text.length;
		const standsAlone =
			!settings.wholeWord ||
			(!isWordCharacter(haystack.text[at - 1]) && !isWordCharacter(haystack.text[end]));

		if (standsAlone) {
			ranges.push({ start: haystack.offsets[at], end: haystack.offsets[end] });
			from = end;
		} else {
			from = at + 1;
		}
	}

	return ranges;
};

/* -------------------------------------------------------------------------- */
/*  Turning a message into the text a reader sees                              */
/* -------------------------------------------------------------------------- */

const stripHtml = (html: string) =>
	html
		// The summary of a collapsed block is text the reader sees, so it is kept
		// while the tag around it is dropped.
		.replace(/<\/?(?:script|style)[^>]*>[\s\S]*?(?:<\/(?:script|style)>|$)/gi, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");

/**
 * The visible text of a Markdown token tree.
 *
 * Lexed rather than pattern-stripped: `*` is emphasis in one place and a
 * multiplication sign in another, and only a parser knows which. Block-level
 * tokens are separated by newlines so that the last word of one paragraph does
 * not fuse with the first word of the next.
 */
const tokensToText = (tokens: unknown[] | undefined): string => {
	if (!Array.isArray(tokens)) return '';

	const parts: string[] = [];

	for (const raw of tokens) {
		const token = raw as Record<string, any>;

		switch (token?.type) {
			case 'space':
				parts.push('\n');
				break;
			case 'hr':
				break;
			case 'code':
				// Code is read as often as prose in an agentic chat.
				parts.push(`${token.text ?? ''}\n`);
				break;
			case 'codespan':
			case 'escape':
				parts.push(token.text ?? '');
				break;
			case 'br':
				parts.push('\n');
				break;
			case 'html':
				parts.push(`${stripHtml(String(token.raw ?? token.text ?? ''))}\n`);
				break;
			case 'image':
			case 'link':
				// The label, not the target: the target is not on screen.
				parts.push(token.tokens?.length ? tokensToText(token.tokens) : (token.text ?? ''));
				break;
			case 'table': {
				const cells: string[] = [];
				for (const cell of token.header ?? []) {
					cells.push(tokensToText(cell?.tokens) || String(cell?.text ?? ''));
				}
				for (const row of token.rows ?? []) {
					for (const cell of row ?? []) {
						cells.push(tokensToText(cell?.tokens) || String(cell?.text ?? ''));
					}
				}
				parts.push(`${cells.join(' ')}\n`);
				break;
			}
			case 'list':
				parts.push(tokensToText(token.items));
				break;
			case 'list_item':
			case 'blockquote':
			case 'heading':
			case 'paragraph':
			case 'text':
			case 'strong':
			case 'em':
			case 'del':
				parts.push(
					token.tokens?.length ? tokensToText(token.tokens) : String(token.text ?? token.raw ?? '')
				);
				if (['blockquote', 'heading', 'paragraph', 'list_item'].includes(token.type)) {
					parts.push('\n');
				}
				break;
			default:
				if (token?.tokens) {
					parts.push(tokensToText(token.tokens));
				} else if (typeof token?.text === 'string') {
					parts.push(token.text);
				}
				break;
		}
	}

	return parts.join('');
};

/**
 * The readable text of a Markdown string.
 *
 * Falls back to the input when the lexer throws: a half-typed fence during
 * streaming should still be searchable.
 */
export const markdownToText = (markdown: string): string => {
	if (!markdown) return '';
	try {
		return tokensToText(marked.lexer(markdown) as unknown[]);
	} catch {
		return markdown;
	}
};

export interface SearchableMessage {
	id: string;
	role?: string;
	content?: string;
	error?: unknown;
	files?: { name?: string; collection_name?: string }[];
	[key: string]: unknown;
}

export interface IndexedMessage {
	id: string;
	role: string;
	/** Position in the branch, oldest first, so hits can be ordered. */
	turn: number;
	/** The text a reader would see, in reading order. */
	text: string;
}

const errorText = (error: unknown): string => {
	if (!error) return '';
	if (typeof error === 'string') return error;
	if (typeof error === 'object') {
		const content = (error as Record<string, unknown>).content;
		if (typeof content === 'string') return content;
	}
	return '';
};

/**
 * Build the searchable form of a branch once.
 *
 * Kept apart from searching because lexing every message is the expensive half
 * and the query changes on every keystroke while the text does not.
 */
export const buildSearchIndex = (messages: SearchableMessage[]): IndexedMessage[] =>
	(messages ?? []).map((message, turn) => {
		const parts = [markdownToText(String(message?.content ?? ''))];

		const attachments = (message?.files ?? [])
			.map((file) => file?.name ?? file?.collection_name ?? '')
			.filter(Boolean);
		if (attachments.length) parts.push(attachments.join(' '));

		const failure = errorText(message?.error);
		if (failure) parts.push(failure);

		return {
			id: String(message?.id ?? ''),
			role: String(message?.role ?? ''),
			turn,
			text: parts.filter(Boolean).join('\n')
		};
	});

/**
 * An indexer that only re-reads the messages that changed.
 *
 * Lexing is the expensive half, and while an answer streams the branch is
 * rebuilt on every frame with exactly one message different. Without this, a
 * two-hundred-message chat would be lexed from scratch sixty times a second.
 */
export const createIndexer = () => {
	const cache = new Map<string, { source: string; entry: IndexedMessage }>();

	return (messages: SearchableMessage[]): IndexedMessage[] => {
		const seen = new Set<string>();

		const index = (messages ?? []).map((message, turn) => {
			const id = String(message?.id ?? '');
			// Everything the searchable text is derived from, so that a change to
			// any of it invalidates the entry.
			const source = JSON.stringify([message?.content, message?.files, message?.error]);
			seen.add(id);

			const cached = cache.get(id);
			if (cached && cached.source === source && cached.entry.turn === turn) {
				return cached.entry;
			}

			const [entry] = buildSearchIndex([message]);
			const positioned = { ...entry, turn };
			cache.set(id, { source, entry: positioned });
			return positioned;
		});

		for (const id of [...cache.keys()]) {
			if (!seen.has(id)) cache.delete(id);
		}

		return index;
	};
};

export type RoleFilter = 'all' | 'user' | 'assistant';

export interface SearchOptions extends MatchOptions {
	role: RoleFilter;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
	...DEFAULT_MATCH_OPTIONS,
	role: 'all'
};

export interface Snippet {
	before: string;
	match: string;
	after: string;
}

export interface SearchHit {
	messageId: string;
	role: string;
	turn: number;
	/** Offsets into the indexed message's text. */
	start: number;
	end: number;
	/** Which occurrence this is within its own message, from zero. */
	occurrence: number;
	snippet: Snippet;
}

const SNIPPET_CONTEXT = 48;

const tidy = (value: string) => value.replace(/\s+/g, ' ');

const buildSnippet = (text: string, range: MatchRange): Snippet => {
	const from = Math.max(0, range.start - SNIPPET_CONTEXT);
	const to = Math.min(text.length, range.end + SNIPPET_CONTEXT);
	return {
		before: (from > 0 ? '…' : '') + tidy(text.slice(from, range.start)),
		match: tidy(text.slice(range.start, range.end)),
		after: tidy(text.slice(range.end, to)) + (to < text.length ? '…' : '')
	};
};

/**
 * Every occurrence in the branch, oldest first.
 *
 * Chronological rather than ranked: the counter and the next button only mean
 * something if "next" is the next one down the page.
 */
export const searchIndex = (
	index: IndexedMessage[],
	query: string,
	options: Partial<SearchOptions> = {}
): SearchHit[] => {
	const settings = { ...DEFAULT_SEARCH_OPTIONS, ...options };
	if (!query) return [];

	const hits: SearchHit[] = [];

	for (const message of index ?? []) {
		if (settings.role !== 'all' && message.role !== settings.role) continue;

		const ranges = findMatches(message.text, query, settings);
		ranges.forEach((range, occurrence) => {
			hits.push({
				messageId: message.id,
				role: message.role,
				turn: message.turn,
				start: range.start,
				end: range.end,
				occurrence,
				snippet: buildSnippet(message.text, range)
			});
		});
	}

	return hits;
};

/** How many hits fall in each message, for deciding what to expand. */
export const hitsByMessage = (hits: SearchHit[]): Map<string, number> => {
	const counts = new Map<string, number>();
	for (const hit of hits) {
		counts.set(hit.messageId, (counts.get(hit.messageId) ?? 0) + 1);
	}
	return counts;
};

/** Step through hits with wrap-around; -1 when there is nothing to step to. */
export const stepHit = (current: number, total: number, direction: 1 | -1): number => {
	if (total <= 0) return -1;
	if (current < 0) return direction === 1 ? 0 : total - 1;
	return (current + direction + total) % total;
};
