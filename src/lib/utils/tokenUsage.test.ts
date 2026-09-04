import { describe, expect, it } from 'vitest';
import { extractTurnUsage, formatTokenCount, formatTokenRate, sumChatUsage } from './tokenUsage';

describe('extractTurnUsage', () => {
	it('reads the OpenAI shape', () => {
		expect(extractTurnUsage({ prompt_tokens: 100, completion_tokens: 20 })).toEqual({
			promptTokens: 100,
			completionTokens: 20,
			cachedTokens: 0
		});
	});

	it('reads the shape llama.cpp actually returns through Open WebUI', () => {
		// Taken from a real stored chat.
		expect(
			extractTurnUsage({
				input_tokens: 6291,
				output_tokens: 568,
				total_tokens: 6859,
				input_tokens_details: { cached_tokens: 6287 }
			})
		).toEqual({ promptTokens: 6291, completionTokens: 568, cachedTokens: 6287 });
	});

	it('reads the Ollama shape', () => {
		expect(extractTurnUsage({ prompt_eval_count: 40, eval_count: 12 })).toEqual({
			promptTokens: 40,
			completionTokens: 12,
			cachedTokens: 0
		});
	});

	it('reads Anthropic and DeepSeek cache fields', () => {
		expect(
			extractTurnUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900 })
				?.cachedTokens
		).toBe(900);
		expect(
			extractTurnUsage({ prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 700 })
				?.cachedTokens
		).toBe(700);
	});

	it('adds llama.cpp native prompt_n and cache_n into the prompt total', () => {
		expect(extractTurnUsage({ prompt_n: 20, cache_n: 80, predicted_n: 9 })).toEqual({
			promptTokens: 100,
			completionTokens: 9,
			cachedTokens: 80
		});
	});

	it('reports nothing rather than zeroes when there is no usage', () => {
		expect(extractTurnUsage(null)).toBeNull();
		expect(extractTurnUsage({})).toBeNull();
		expect(extractTurnUsage('nonsense')).toBeNull();
		expect(extractTurnUsage({ prompt_tokens: 0, completion_tokens: 0 })).toBeNull();
	});
});

describe('sumChatUsage', () => {
	const T0 = 1_700_000_000_000;

	it('adds up every assistant turn and keeps the last one', () => {
		const totals = sumChatUsage([
			{ role: 'user' },
			{ role: 'assistant', usage: { prompt_tokens: 100, completion_tokens: 10 } },
			{ role: 'user' },
			{
				role: 'assistant',
				usage: {
					prompt_tokens: 200,
					completion_tokens: 30,
					prompt_tokens_details: { cached_tokens: 90 }
				}
			}
		]);

		expect(totals.promptTokens).toBe(300);
		expect(totals.completionTokens).toBe(40);
		expect(totals.cachedTokens).toBe(90);
		expect(totals.turns).toBe(2);
		expect(totals.lastTurn).toEqual({
			promptTokens: 200,
			completionTokens: 30,
			cachedTokens: 90
		});
	});

	it('ignores usage hanging off user messages', () => {
		const totals = sumChatUsage([
			{ role: 'user', usage: { prompt_tokens: 999, completion_tokens: 999 } }
		]);
		expect(totals.turns).toBe(0);
		expect(totals.promptTokens).toBe(0);
	});

	it('weights the rate by tokens rather than averaging per turn', () => {
		const totals = sumChatUsage([
			{
				role: 'assistant',
				// 10 tokens in 1s
				generationStats: { tokens: 10, firstTokenAt: T0, completedAt: T0 + 1000 }
			},
			{
				role: 'assistant',
				// 90 tokens in 9s -> both are 10/s, so the total must be 10/s
				generationStats: { tokens: 90, firstTokenAt: T0, completedAt: T0 + 9000 }
			}
		]);
		expect(totals.tokensPerSecond).toBeCloseTo(10);
	});

	it('does not let a one-token turn skew the rate', () => {
		const totals = sumChatUsage([
			{
				role: 'assistant',
				generationStats: { tokens: 1, firstTokenAt: T0, completedAt: T0 + 1000 }
			},
			{
				role: 'assistant',
				generationStats: { tokens: 999, firstTokenAt: T0, completedAt: T0 + 10_000 }
			}
		]);
		// A per-turn mean would give ~50/s; weighted gives 1000 tokens over 11s.
		expect(totals.tokensPerSecond).toBeCloseTo(1000 / 11);
	});

	it('falls back to the last token when a turn was stopped early', () => {
		const totals = sumChatUsage([
			{
				role: 'assistant',
				generationStats: { tokens: 20, firstTokenAt: T0, lastTokenAt: T0 + 2000 }
			}
		]);
		expect(totals.tokensPerSecond).toBeCloseTo(10);
	});

	it('keeps each measured turn’s rate, oldest first', () => {
		const totals = sumChatUsage([
			{
				role: 'assistant',
				generationStats: { tokens: 10, firstTokenAt: T0, completedAt: T0 + 1000 }
			},
			{ role: 'user' },
			{
				role: 'assistant',
				generationStats: { tokens: 40, firstTokenAt: T0, completedAt: T0 + 2000 }
			},
			// No stats: contributes nothing rather than a zero.
			{ role: 'assistant', usage: { prompt_tokens: 5, completion_tokens: 5 } }
		]);
		expect(totals.turnRates).toHaveLength(2);
		expect(totals.turnRates[0]).toBeCloseTo(10);
		expect(totals.turnRates[1]).toBeCloseTo(20);
	});

	it('reports no rate when nothing was measured', () => {
		expect(
			sumChatUsage([{ role: 'assistant', usage: { prompt_tokens: 5 } }]).tokensPerSecond
		).toBeNull();
		expect(sumChatUsage(null).tokensPerSecond).toBeNull();
		expect(sumChatUsage([]).turns).toBe(0);
	});
});

describe('formatting', () => {
	it('writes counts the way inference UIs do', () => {
		expect(formatTokenCount(0)).toBe('0');
		expect(formatTokenCount(999)).toBe('999');
		expect(formatTokenCount(6120)).toBe('6.12K');
		expect(formatTokenCount(262_144)).toBe('262.14K');
		expect(formatTokenCount(1_500_000)).toBe('1.50M');
	});

	it('keeps rates short', () => {
		expect(formatTokenRate(21.2)).toBe('21.2');
		expect(formatTokenRate(237.4)).toBe('237');
	});
});
