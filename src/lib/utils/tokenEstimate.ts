/**
 * Estimating tokens in the browser, the same way the server does.
 *
 * The context meter and the server's compaction decision have to agree. If the
 * meter says a chat is half full while the server is about to compact it, the
 * meter is worse than nothing -- it is a reason to distrust the feature. So
 * this mirrors backend/open_webui/utils/token_counter.py exactly: same
 * character classes, same weights, same rounding, checked against the same
 * corpus in tokenEstimate.test.ts.
 *
 * What it replaces was `length / 4`, which loses two thirds of a Japanese
 * message and a fifth of a JSON tool result. Both errors run in the direction
 * that lets a request overflow.
 *
 * The server has a real tokenizer and uses it; this is the estimate the server
 * falls back to. The meter is therefore approximate by construction, and says
 * so -- until a turn reports usage, at which point the provider's own count
 * anchors it and the estimate only covers what came after.
 */

/** Scripts written without spaces, where a character is close to a whole token. */
const CJK_RANGES: [number, number][] = [
	[0x1100, 0x11ff], // Hangul Jamo
	[0x3040, 0x30ff], // Hiragana, Katakana
	[0x3400, 0x4dbf], // CJK Extension A
	[0x4e00, 0x9fff], // CJK Unified
	[0xac00, 0xd7af], // Hangul Syllables
	[0xf900, 0xfaff], // CJK Compatibility
	[0x20000, 0x2fa1f] // CJK Extension B and beyond
];

// Measured against o200k_base: 0.71-0.77 tokens per character for Chinese,
// Japanese and Korean. 0.85 keeps the estimate on the safe side of all three.
const CJK_TOKENS_PER_CHAR = 0.85;
const LETTER_CHARS_PER_TOKEN = 4.0;
const DENSE_CHARS_PER_TOKEN = 2.2;
const SPACE_CHARS_PER_TOKEN = 5.0;

const LETTER = /\p{L}/u;
const DIGIT = /\p{Nd}/u;
const SPACE = /\s/u;

const isCjk = (code: number): boolean =>
	CJK_RANGES.some(([low, high]) => code >= low && code <= high);

/** A tokenizer-free count, weighted by what the characters are. */
export const estimateTokens = (value: unknown): number => {
	if (value === null || value === undefined || value === '') {
		return 0;
	}

	let text: string;
	if (typeof value === 'string') {
		text = value;
	} else {
		try {
			text = JSON.stringify(value) ?? String(value);
		} catch {
			text = String(value);
		}
	}
	if (!text) {
		return 0;
	}

	let cjk = 0;
	let letters = 0;
	let dense = 0;
	let spaces = 0;

	// Iterating the string yields whole code points, so anything above the
	// basic plane is one character here and not two halves of a surrogate pair.
	for (const char of text) {
		if (SPACE.test(char)) {
			spaces += 1;
		} else if (isCjk(char.codePointAt(0) as number)) {
			cjk += 1;
		} else if (LETTER.test(char)) {
			letters += 1;
		} else if (DIGIT.test(char)) {
			dense += 1;
		} else {
			dense += 1;
		}
	}

	const estimate =
		cjk * CJK_TOKENS_PER_CHAR +
		letters / LETTER_CHARS_PER_TOKEN +
		dense / DENSE_CHARS_PER_TOKEN +
		spaces / SPACE_CHARS_PER_TOKEN;

	return Math.max(1, Math.ceil(estimate));
};

/**
 * What an image costs.
 *
 * Providers price by area and disagree on the rate; the more expensive rule is
 * the one that keeps a request inside its window. The browser has the data URL
 * but reading its header here would mean decoding base64 on every keystroke of
 * a re-render, so this is the documented default the server also uses when it
 * cannot read a size.
 */
export const IMAGE_TOKENS = 1400;

/** Message overhead: the role, and the delimiters a chat template adds. */
const MESSAGE_OVERHEAD = 4;
const REPLY_OVERHEAD = 3;

const countContent = (content: unknown): number => {
	if (typeof content === 'string' || content === null || content === undefined) {
		return estimateTokens(content);
	}
	if (!Array.isArray(content)) {
		return estimateTokens(content);
	}

	let total = 0;
	for (const part of content) {
		if (part && typeof part === 'object') {
			const kind = (part as Record<string, unknown>).type;
			if (kind === 'image_url' || kind === 'input_image' || kind === 'image') {
				total += IMAGE_TOKENS;
				continue;
			}
			const record = part as Record<string, unknown>;
			total += estimateTokens(record.text ?? record.content ?? part);
		} else {
			total += estimateTokens(part);
		}
	}
	return total;
};

/** What one message costs, including the parts that are not its content. */
export const estimateMessageTokens = (message: Record<string, any> | null | undefined): number => {
	if (!message || typeof message !== 'object') {
		return estimateTokens(message);
	}

	let total = MESSAGE_OVERHEAD + countContent(message.content);
	// In an agentic chat these are most of the payload: a search returning
	// twenty hits outweighs everything the user typed.
	for (const field of ['reasoning', 'reasoning_content', 'output', 'tool_calls', 'files']) {
		if (message[field]) {
			total += estimateTokens(message[field]);
		}
	}
	return total;
};

/** What a whole message list costs, as the request would send it. */
export const estimateMessagesTokens = (
	messages: Record<string, any>[] | null | undefined
): number => {
	if (!messages?.length) {
		return 0;
	}
	return messages.reduce(
		(total, message) => total + estimateMessageTokens(message),
		REPLY_OVERHEAD
	);
};
