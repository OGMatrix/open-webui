import { describe, expect, it } from 'vitest';
import { estimateChatCost, estimateTurnCost, formatCost, getModelPricing } from './cost';
import type { ChatUsage } from './tokenUsage';

// Rates taken verbatim from OpenRouter's public catalogue.
const claudePricing = {
	prompt: '0.00001',
	completion: '0.00005',
	web_search: '0.01',
	input_cache_read: '0.000001',
	input_cache_write: '0.0000125'
};

describe('getModelPricing', () => {
	it('reads the gateway shape', () => {
		expect(getModelPricing({ pricing: claudePricing })).toEqual({
			prompt: 0.00001,
			completion: 0.00005,
			cachedPrompt: 0.000001
		});
	});

	it('also looks under the preserved provider object', () => {
		expect(getModelPricing({ openai: { pricing: claudePricing } })?.prompt).toBe(0.00001);
	});

	it('copes with a model that prices no cache separately', () => {
		expect(getModelPricing({ pricing: { prompt: '0.0000005', completion: '0.0000015' } })).toEqual({
			prompt: 0.0000005,
			completion: 0.0000015,
			cachedPrompt: null
		});
	});

	it('treats a free model as having nothing to show', () => {
		expect(getModelPricing({ pricing: { prompt: '0', completion: '0' } })).toBeNull();
	});

	it('reports nothing for a model that publishes no prices', () => {
		expect(getModelPricing({ id: 'qwen3.8-27b-mtp-256k' })).toBeNull();
		expect(getModelPricing(null)).toBeNull();
		expect(getModelPricing({ pricing: 'free' })).toBeNull();
		expect(getModelPricing({ pricing: { completion: '0.001' } })).toBeNull();
	});
});

describe('estimateTurnCost', () => {
	const pricing = getModelPricing({ pricing: claudePricing })!;

	it('bills prompt and completion at their own rates', () => {
		const cost = estimateTurnCost(
			{ promptTokens: 1000, completionTokens: 500, cachedTokens: 0 },
			pricing
		);
		// 1000 * 0.00001 + 500 * 0.00005
		expect(cost).toBeCloseTo(0.01 + 0.025, 6);
	});

	it('bills cached prompt tokens at the cache rate', () => {
		const cost = estimateTurnCost(
			{ promptTokens: 1000, completionTokens: 0, cachedTokens: 900 },
			pricing
		);
		// 100 fresh at 0.00001, 900 cached at 0.000001
		expect(cost).toBeCloseTo(0.001 + 0.0009, 6);
	});

	it('falls back to the prompt rate when no cache rate is published', () => {
		const flat = getModelPricing({ pricing: { prompt: '0.00001', completion: '0' } })!;
		const cost = estimateTurnCost(
			{ promptTokens: 1000, completionTokens: 0, cachedTokens: 1000 },
			flat
		);
		expect(cost).toBeCloseTo(0.01, 6);
	});

	it('never bills more cached tokens than there were prompt tokens', () => {
		// A provider reporting cache above prompt must not produce a negative charge.
		const cost = estimateTurnCost(
			{ promptTokens: 100, completionTokens: 0, cachedTokens: 5000 },
			pricing
		);
		expect(cost).toBeCloseTo(100 * 0.000001, 8);
	});

	it('reports nothing without usage or without prices', () => {
		expect(estimateTurnCost(null, pricing)).toBeNull();
		expect(
			estimateTurnCost({ promptTokens: 1, completionTokens: 1, cachedTokens: 0 }, null)
		).toBeNull();
	});
});

describe('estimateChatCost', () => {
	it('bills the chat totals', () => {
		const usage = {
			promptTokens: 161310,
			completionTokens: 5881,
			cachedTokens: 100000,
			turns: 12,
			tokensPerSecond: 21.2,
			lastTurn: null,
			lastTimeToFirstTokenMs: null,
			turnRates: []
		} satisfies ChatUsage;
		const pricing = getModelPricing({ pricing: claudePricing })!;
		// 61310 fresh, 100000 cached, 5881 completion
		expect(estimateChatCost(usage, pricing)).toBeCloseTo(
			61310 * 0.00001 + 100000 * 0.000001 + 5881 * 0.00005,
			6
		);
	});
});

describe('formatCost', () => {
	it('keeps small amounts honest instead of rounding them to nothing', () => {
		expect(formatCost(0.004)).toBe('<$0.01');
		expect(formatCost(0)).toBe('$0.00');
	});

	it('writes ordinary amounts plainly', () => {
		expect(formatCost(0.421)).toBe('$0.421');
		expect(formatCost(1.5)).toBe('$1.50');
		expect(formatCost(12.345)).toBe('$12.35');
	});
});
