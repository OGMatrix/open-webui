/**
 * Reading token usage back out of a chat, across providers.
 *
 * Every provider names these differently, and several report cache hits in
 * their own shape. The key precedence here matches what the backend already
 * normalises, plus the cache fields each provider actually sends:
 *
 *   prompt      prompt_tokens · input_tokens · prompt_eval_count · prompt_n+cache_n
 *   completion  completion_tokens · output_tokens · eval_count · predicted_n
 *   cached      input_tokens_details.cached_tokens (OpenAI, llama.cpp via the
 *               OpenAI shape) · cache_read_input_tokens (Anthropic) ·
 *               prompt_cache_hit_tokens (DeepSeek) · cache_n (llama.cpp native)
 */

export type TurnUsage = {
	promptTokens: number;
	completionTokens: number;
	cachedTokens: number;
};

export type ChatUsage = TurnUsage & {
	/** Assistant turns that reported any usage at all. */
	turns: number;
	/** Weighted decode rate across the chat, or null when nothing was measured. */
	tokensPerSecond: number | null;
	/** The most recent turn that reported usage. */
	lastTurn: TurnUsage | null;
	/** How long the most recent turn spent before its first token. */
	lastTimeToFirstTokenMs: number | null;
	/**
	 * Decode rate of each measured turn, oldest first. Lets the panel show how
	 * speed moved across the chat rather than only where it ended up.
	 */
	turnRates: number[];
};

const toCount = (value: unknown): number => {
	const parsed = typeof value === 'string' ? Number(value) : value;
	return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
		? Math.trunc(parsed)
		: 0;
};

const firstCount = (...values: unknown[]): number => {
	for (const value of values) {
		const count = toCount(value);
		if (count) {
			return count;
		}
	}
	return 0;
};

/**
 * Normalises one provider usage payload. Returns null when there is nothing in
 * it, so callers can tell "no data" from "a turn that used zero tokens".
 */
export const extractTurnUsage = (usage: unknown): TurnUsage | null => {
	if (!usage || typeof usage !== 'object') {
		return null;
	}

	const payload = usage as Record<string, any>;

	let promptTokens = firstCount(
		payload.prompt_tokens,
		payload.input_tokens,
		payload.prompt_eval_count
	);
	if (!promptTokens) {
		// llama.cpp's native shape splits the prompt into fresh and cached parts.
		promptTokens = toCount(payload.prompt_n) + toCount(payload.cache_n);
	}

	const completionTokens = firstCount(
		payload.completion_tokens,
		payload.output_tokens,
		payload.eval_count,
		payload.predicted_n
	);

	const cachedTokens = firstCount(
		payload.input_tokens_details?.cached_tokens,
		payload.prompt_tokens_details?.cached_tokens,
		payload.cache_read_input_tokens,
		payload.prompt_cache_hit_tokens,
		payload.cache_n
	);

	if (!promptTokens && !completionTokens && !cachedTokens) {
		return null;
	}

	return { promptTokens, completionTokens, cachedTokens };
};

type MessageLike = {
	role?: string;
	usage?: unknown;
	info?: { usage?: unknown };
	generationStats?: {
		tokens?: number;
		startedAt?: number;
		firstTokenAt?: number;
		completedAt?: number;
		lastTokenAt?: number;
	} | null;
};

/**
 * Adds up every assistant turn in a chat.
 *
 * The rate is weighted by tokens rather than averaged over turns: a two-token
 * reply should not pull the number as hard as a thousand-token one.
 */
export const sumChatUsage = (messages: MessageLike[] | null | undefined): ChatUsage => {
	const totals: ChatUsage = {
		promptTokens: 0,
		completionTokens: 0,
		cachedTokens: 0,
		turns: 0,
		tokensPerSecond: null,
		lastTurn: null,
		lastTimeToFirstTokenMs: null,
		turnRates: []
	};

	let ratedTokens = 0;
	let ratedMs = 0;

	for (const message of messages ?? []) {
		if (message?.role !== 'assistant') {
			continue;
		}

		const turn = extractTurnUsage(message.usage ?? message.info?.usage);
		if (turn) {
			totals.promptTokens += turn.promptTokens;
			totals.completionTokens += turn.completionTokens;
			totals.cachedTokens += turn.cachedTokens;
			totals.turns += 1;
			totals.lastTurn = turn;
		}

		const stats = message.generationStats;
		const endedAt = stats?.completedAt ?? stats?.lastTokenAt;
		if (stats?.tokens && stats.firstTokenAt && endedAt) {
			const decodeMs = endedAt - stats.firstTokenAt;
			if (decodeMs > 0) {
				ratedTokens += stats.tokens;
				ratedMs += decodeMs;
				totals.turnRates.push(stats.tokens / (decodeMs / 1000));
			}
		}

		if (stats?.firstTokenAt && stats.startedAt) {
			totals.lastTimeToFirstTokenMs = Math.max(0, stats.firstTokenAt - stats.startedAt);
		}
	}

	if (ratedTokens > 0 && ratedMs > 0) {
		totals.tokensPerSecond = ratedTokens / (ratedMs / 1000);
	}

	return totals;
};

/**
 * Compact token counts, the way inference UIs write them: 6.12K, 262.14K, 1.2M.
 */
export const formatTokenCount = (value: number): string => {
	const count = Number.isFinite(value) ? Math.max(0, value) : 0;

	if (count < 1000) {
		return `${Math.round(count)}`;
	}
	if (count < 1_000_000) {
		return `${(count / 1000).toFixed(2)}K`;
	}
	return `${(count / 1_000_000).toFixed(2)}M`;
};

export const formatTokenRate = (value: number): string =>
	value >= 100 ? `${Math.round(value)}` : `${value.toFixed(1)}`;
