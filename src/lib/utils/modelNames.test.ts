import { describe, expect, it } from 'vitest';
import { emphasizeNames, splitName } from './modelNames';

/** How the list would be rendered, written as head|body|tail per name. */
const render = (names: string[]) =>
	emphasizeNames(names).map(({ head, body, tail }) => `${head}|${body}|${tail}`);

describe('splitName', () => {
	it('keeps separators as their own pieces', () => {
		expect(splitName('qwen3.8-27b-256k')).toEqual(['qwen3', '.', '8', '-', '27b', '-', '256k']);
	});

	it('survives an empty name', () => {
		expect(splitName('')).toEqual([]);
	});
});

describe('emphasizeNames', () => {
	it('handles the real list from a llama.cpp router', () => {
		// Three unrelated models and one large family, all in one list. Each row
		// is measured against its own neighbours, not against the list as a whole.
		expect(
			render([
				'nemotron-3-nano-30b-q8-max',
				'nomic-embed-text-v1.5-32k',
				'qwen3.8-27b-128k',
				'qwen3.8-27b-256k',
				'qwen3.8-27b-32k',
				'qwen3.8-27b-64k',
				'qwen3.8-27b-mtp-256k',
				'qwen3.8-flash-next-256k'
			])
		).toEqual([
			'|nemotron-3-nano-30b-q8-max|',
			'|nomic-embed-text-v1.5-32k|',
			'qwen3.8-27b-|128k|',
			'qwen3.8-27b-|256k|',
			'qwen3.8-27b-|32k|',
			'qwen3.8-27b-|64k|',
			'qwen3.8-27b-|mtp|-256k',
			'qwen3.8-|flash-next|-256k'
		]);
	});

	it('leaves a name with no relatives whole', () => {
		expect(render(['llama-3-70b', 'mistral-large'])).toEqual(['|llama-3-70b|', '|mistral-large|']);
	});

	it('does nothing for a single model', () => {
		expect(render(['qwen3.8-27b-256k'])).toEqual(['|qwen3.8-27b-256k|']);
	});

	it('plays down a shared ending as well as a shared opening', () => {
		expect(render(['gpt-4o-mini-preview', 'gpt-4o-turbo-preview'])).toEqual([
			'gpt-4o-|mini|-preview',
			'gpt-4o-|turbo|-preview'
		]);
	});

	it('never leaves a row with nothing to read', () => {
		// "qwen3" shares every segment it has with "qwen3-32k".
		for (const entry of render(['qwen3', 'qwen3-32k'])) {
			expect(entry.split('|')[1]).not.toBe('');
		}
	});

	it('cuts on segment boundaries, never inside one', () => {
		// A character-wise prefix would be "qwen3.8-27b", splitting "27b0" in half.
		const [, second] = emphasizeNames(['qwen3.8-27b', 'qwen3.8-27b0']);
		expect(second.head).toBe('qwen3.8-');
		expect(second.body).toBe('27b0');
	});

	it('does not dim a lone separator', () => {
		// These share only "-", which carries no meaning on its own.
		expect(render(['-alpha', '-beta'])).toEqual(['|-alpha|', '|-beta|']);
	});

	it('handles names that differ in the middle', () => {
		expect(render(['claude-opus-5-20260101', 'claude-haiku-5-20260101'])).toEqual([
			'claude-|opus|-5-20260101',
			'claude-|haiku|-5-20260101'
		]);
	});

	it('ignores blanks in the list', () => {
		expect(render(['', 'qwen-a', 'qwen-b'])).toEqual(['||', 'qwen-|a|', 'qwen-|b|']);
	});

	it('puts every name back together unchanged', () => {
		const names = ['qwen3.8-27b-32k', 'qwen3.8-27b-mtp-256k', 'nomic-embed-text-v1.5-32k', ''];
		emphasizeNames(names).forEach(({ head, body, tail }, index) => {
			expect(head + body + tail).toBe(names[index]);
		});
	});

	it('copes with a long list without pathological cost', () => {
		const many = Array.from({ length: 400 }, (_, i) => `family-${i % 8}-variant-${i}`);
		const started = Date.now();
		expect(emphasizeNames(many)).toHaveLength(400);
		expect(Date.now() - started).toBeLessThan(1000);
	});
});
