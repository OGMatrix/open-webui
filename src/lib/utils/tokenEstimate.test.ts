import { describe, expect, it } from 'vitest';
import {
	IMAGE_TOKENS,
	estimateMessageTokens,
	estimateMessagesTokens,
	estimateTokens
} from './tokenEstimate';

/**
 * The numbers below were produced by the server's own estimator
 * (backend/open_webui/utils/token_counter.py). They are here so the two
 * implementations cannot drift apart unnoticed: a meter that disagrees with
 * the decision it is supposed to explain is worse than no meter.
 *
 * If one of these fails after a change to either side, the fix is to change
 * both and regenerate — not to relax the expectation.
 */
const AGREES_WITH_SERVER: [string, string, number][] = [
	['english', 'Context compaction should happen before the request fails, not after it.', 18],
	[
		'german',
		'Die Kompaktierung geschieht automatisch, bevor die Anfrage scheitert. Groessere AEnderungen kosten.',
		25
	],
	['french', "La compaction du contexte doit se produire avant que la requete n'echoue.", 19],
	['russian', 'Szhatie konteksta dolzhno proiskhodit avtomaticheski.', 14],
	['chinese', '上下文压缩应该自动发生。', 10],
	['japanese', 'コンテキストの圧縮は自動です。', 13],
	['korean', '컨텍스트 압축은 자동으로 이루어집니다.', 16],
	['json', '{"results":[{"title":"Result 1","url":"https://example.com/1","score":0.94}]}', 27],
	[
		'python',
		'def compact(messages, budget):\n    total = sum(count(m) for m in messages)\n    return messages',
		25
	],
	['markdown', '# Heading\n\n- one item\n- another\n\n```bash\nnpm run build\n```\n', 16],
	[
		'urls',
		'https://github.com/open-webui/open-webui/blob/main/backend/open_webui/utils/token_counter.py#L42',
		29
	],
	['digits', '1234567890 3.14159 2026-09-04 8192', 15],
	['whitespace', '\n\n    \t\n\n', 2],
	['single', 'a', 1],
	['punctuation', '!!! ??? ... ,,, ;;; :::', 10]
];

describe('agreeing with the server', () => {
	it.each(AGREES_WITH_SERVER)(
		'counts %s the same way the backend does',
		(_name, text, expected) => {
			expect(estimateTokens(text)).toBe(expected);
		}
	);
});

describe('what the character classes are for', () => {
	it('does not lose two thirds of a CJK message', () => {
		// The failure this replaced: dividing by four counts a Japanese
		// sentence at a third of its real size, and undercounting is the
		// direction that overflows a context window.
		const japanese = 'コンテキストの圧縮は自動です。';
		expect(estimateTokens(japanese)).toBeGreaterThan(Math.floor(japanese.length / 4) * 2);
	});

	it('charges more for dense punctuation than for prose of the same length', () => {
		const prose = 'a'.repeat(60);
		const dense = '{},'.repeat(20);
		expect(dense).toHaveLength(prose.length);
		expect(estimateTokens(dense)).toBeGreaterThan(estimateTokens(prose));
	});

	it('reads an emoji as one character, not two halves of a surrogate pair', () => {
		// Iterating a string by index would count these twice.
		expect(estimateTokens('👍👍👍')).toBeLessThanOrEqual(estimateTokens('abcdef'));
	});
});

describe('what nothing costs', () => {
	it.each([null, undefined, ''])('%s costs nothing', (value) => {
		expect(estimateTokens(value)).toBe(0);
	});

	it('anything at all costs at least one', () => {
		expect(estimateTokens('a')).toBe(1);
		expect(estimateTokens(' ')).toBe(1);
	});

	it('serialises what is not text', () => {
		expect(estimateTokens({ query: 'weather' })).toBeGreaterThan(0);
		expect(estimateTokens([1, 2, 3])).toBeGreaterThan(0);
	});

	it('survives a value that cannot be serialised', () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(() => estimateTokens(circular)).not.toThrow();
	});
});

describe('messages', () => {
	it('charges for the structure around the content', () => {
		expect(estimateMessageTokens({ role: 'user', content: '' })).toBeGreaterThan(0);
	});

	it('counts an image part alongside the text', () => {
		const withImage = estimateMessageTokens({
			role: 'user',
			content: [
				{ type: 'text', text: 'what is this' },
				{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
			]
		});
		expect(withImage).toBeGreaterThan(IMAGE_TOKENS);
	});

	it('counts tool calls and replayed reasoning', () => {
		const plain = estimateMessageTokens({ role: 'assistant', content: 'done' });
		const busy = estimateMessageTokens({
			role: 'assistant',
			content: 'done',
			reasoning: 'a long deliberation about which tool to call and why it was the right one',
			tool_calls: [{ id: 'c1', function: { name: 'search_web', arguments: '{"q":"x"}' } }]
		});
		expect(busy).toBeGreaterThan(plain + 20);
	});

	it('a list costs more than its contents alone', () => {
		const messages = [
			{ role: 'user', content: 'hello' },
			{ role: 'assistant', content: 'hi' }
		];
		expect(estimateMessagesTokens(messages)).toBeGreaterThan(
			estimateTokens('hello') + estimateTokens('hi')
		);
	});

	it.each([[[]], [null], [undefined]])('no messages cost nothing', (messages) => {
		expect(estimateMessagesTokens(messages as never)).toBe(0);
	});

	it('survives a message that is not an object', () => {
		expect(estimateMessageTokens('just a string' as never)).toBeGreaterThan(0);
	});
});
