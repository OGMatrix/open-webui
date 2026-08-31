/**
 * Estimating what a chat cost, for providers that publish their prices.
 *
 * Gateways such as OpenRouter carry a `pricing` object on every model, and the
 * backend keeps each provider's raw model object, so the rates are already on
 * the client. Verified against OpenRouter's public catalogue: `prompt` and
 * `completion` appear on every model, `input_cache_read` on most of the ones
 * that support caching. All are USD per token, as strings.
 *
 * Local models publish nothing, so they simply have no cost to show.
 */

import type { ChatUsage, TurnUsage } from './tokenUsage';

export type ModelPricing = {
	/** USD per prompt token. */
	prompt: number;
	/** USD per completion token. */
	completion: number;
	/** USD per prompt token served from cache, when the provider prices it apart. */
	cachedPrompt: number | null;
};

const toRate = (value: unknown): number | null => {
	// Rates arrive as strings, and "0" is a real price for a free model.
	const parsed = typeof value === 'string' ? Number(value) : value;
	return typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * The published rates for a model, or null when it publishes none.
 */
export const getModelPricing = (
	model: Record<string, any> | null | undefined
): ModelPricing | null => {
	const pricing = model?.pricing ?? model?.openai?.pricing;
	if (!pricing || typeof pricing !== 'object') {
		return null;
	}

	const prompt = toRate(pricing.prompt);
	const completion = toRate(pricing.completion);
	if (prompt === null || completion === null) {
		return null;
	}

	// A model priced at zero throughout is free, and saying "$0.00" for every
	// chat is noise rather than information.
	const cachedPrompt = toRate(pricing.input_cache_read);
	if (prompt === 0 && completion === 0 && !cachedPrompt) {
		return null;
	}

	return { prompt, completion, cachedPrompt };
};

/**
 * What one turn cost. Cached prompt tokens are billed at the cache rate where
 * the provider publishes one, and at the normal prompt rate otherwise.
 */
export const estimateTurnCost = (
	turn: TurnUsage | null,
	pricing: ModelPricing | null
): number | null => {
	if (!turn || !pricing) {
		return null;
	}

	const cached = Math.min(turn.cachedTokens, turn.promptTokens);
	const fresh = Math.max(0, turn.promptTokens - cached);
	const cachedRate = pricing.cachedPrompt ?? pricing.prompt;

	return fresh * pricing.prompt + cached * cachedRate + turn.completionTokens * pricing.completion;
};

/**
 * What the whole chat cost so far.
 */
export const estimateChatCost = (
	usage: ChatUsage | null,
	pricing: ModelPricing | null
): number | null => estimateTurnCost(usage, pricing);

/**
 * Money, at a precision that stays useful when a chat costs a fraction of a cent.
 */
export const formatCost = (usd: number): string => {
	if (!Number.isFinite(usd) || usd <= 0) {
		return '$0.00';
	}
	if (usd < 0.01) {
		// Below a cent, two decimals would read as free.
		return `<$0.01`;
	}
	if (usd < 1) {
		return `$${usd.toFixed(3).replace(/0$/, '')}`;
	}
	return `$${usd.toFixed(2)}`;
};
