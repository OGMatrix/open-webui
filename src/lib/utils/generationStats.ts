/**
 * Live generation statistics for streamed assistant responses.
 *
 * Providers only report real token usage once a response ends, so the counts
 * shown while a response streams are estimated from the text as it arrives and
 * then replaced with the provider's own numbers as soon as a usage payload
 * lands
 */

export type GenerationStats = {
	/** Request dispatched (ms epoch) */
	startedAt: number;
	/** First content delta (ms epoch) */
	firstTokenAt?: number;
	/** Most recent content delta (ms epoch) */
	lastTokenAt?: number;
	/** Generation finished (ms epoch) */
	completedAt?: number;
	/** Characters accounted for so far, so replaced content isn't counted twice */
	chars: number;
	tokens: number;
	/** True when `tokens` came from the provider rather than the estimate */
	exact?: boolean;
	/** Decode rate reported by the provider, when it reports one */
	tokensPerSecond?: number;
	promptTokens?: number;
	/** Prefill progress, for providers that report it while reading the prompt. */
	prefill?: PrefillProgress;
};

/**
 * How far a provider has read the prompt. llama.cpp reports this as
 * `prompt_progress` when the request asks for it.
 */
export type PrefillProgress = {
	/** Prompt tokens in total. */
	total: number;
	/** Tokens read so far, including whatever came from cache. */
	processed: number;
	/** Tokens served from cache rather than computed. */
	cached: number;
	/** Milliseconds spent so far. */
	elapsedMs: number;
};

export type PrefillView = {
	percent: number;
	processed: number;
	total: number;
	cached: number;
	/** Estimated milliseconds left, or null while there is nothing to go on. */
	remainingMs: number | null;
};

export type GenerationStatsView = {
	tokens: number;
	tokensPerSecond: number | null;
	elapsedMs: number;
	timeToFirstTokenMs: number | null;
	exact: boolean;
	/** Streaming, but no token has arrived yet: the model is still on the prompt. */
	prefilling: boolean;
	/** Prefill detail, where the provider reported any. */
	prefill: PrefillView | null;
};

// Streamed deltas carry a single token far more often than not, so a delta
// counts as one token unless it is long enough to be carrying several
const SINGLE_DELTA_MAX_CHARS = 8;
const CHARS_PER_TOKEN = 4;

// Below this the elapsed time is too short to divide by without the rate
// jumping around wildly on the first few tokens
const MIN_RATE_WINDOW_MS = 250;

const estimateTokensFromChars = (chars: number) =>
	chars > 0 ? Math.max(1, Math.round(chars / CHARS_PER_TOKEN)) : 0;

const toFiniteNumber = (value: unknown): number | null => {
	const parsed = typeof value === 'string' ? Number(value) : value;
	return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
};

export const createGenerationStats = (
	startedAt: number = Date.now(),
	chars: number = 0
): GenerationStats => ({
	startedAt,
	chars,
	tokens: 0
});

/**
 * Account for one streamed delta
 */
export const recordGenerationDelta = (
	stats: GenerationStats | null | undefined,
	text: string,
	now: number = Date.now()
): GenerationStats => {
	if (!text) {
		return stats ?? createGenerationStats(now);
	}

	const next: GenerationStats = stats ? { ...stats } : createGenerationStats(now);

	next.firstTokenAt = next.firstTokenAt ?? now;
	next.lastTokenAt = now;
	next.chars += text.length;
	next.tokens += text.length > SINGLE_DELTA_MAX_CHARS ? estimateTokensFromChars(text.length) : 1;
	// Anything counted past a usage payload is an estimate again
	next.exact = false;

	return next;
};

/**
 * Account for the streaming paths that replace the whole message body instead
 * of appending a delta. Only the text beyond what has already been counted is
 * added, so this is a no-op when `recordGenerationDelta` already saw it
 */
export const syncGenerationProgress = (
	stats: GenerationStats | null | undefined,
	fullText: string,
	now: number = Date.now()
): GenerationStats => {
	const baseline = stats ?? createGenerationStats(now);
	const length = fullText?.length ?? 0;

	if (length <= baseline.chars) {
		return baseline;
	}

	const next: GenerationStats = { ...baseline };

	next.firstTokenAt = next.firstTokenAt ?? now;
	next.lastTokenAt = now;
	next.tokens += estimateTokensFromChars(length - next.chars);
	next.chars = length;
	next.exact = false;

	return next;
};

/**
 * Replace the estimate with the provider's own counts. Key precedence matches
 * the usage normalization the backend already does for Ollama, OpenAI and
 * llama.cpp style payloads
 */
export const applyGenerationUsage = (
	stats: GenerationStats | null | undefined,
	usage: unknown,
	now: number = Date.now()
): GenerationStats => {
	if (!usage || typeof usage !== 'object') {
		return stats ?? createGenerationStats(now);
	}

	const next: GenerationStats = stats ? { ...stats } : createGenerationStats(now);

	const payload = usage as Record<string, unknown>;

	const completionTokens = toFiniteNumber(
		payload.completion_tokens ?? payload.output_tokens ?? payload.eval_count ?? payload.predicted_n
	);
	if (completionTokens !== null && completionTokens > 0) {
		next.tokens = Math.trunc(completionTokens);
		next.exact = true;
	}

	const promptTokens = toFiniteNumber(
		payload.prompt_tokens ?? payload.input_tokens ?? payload.prompt_eval_count
	);
	if (promptTokens !== null && promptTokens > 0) {
		next.promptTokens = Math.trunc(promptTokens);
	}

	// Ollama reports `response_token/s` (or 'N/A')
	// llama.cpp `predicted_per_second`
	const reportedRate = toFiniteNumber(payload['response_token/s'] ?? payload.predicted_per_second);
	if (reportedRate !== null && reportedRate > 0) {
		next.tokensPerSecond = reportedRate;
		return next;
	}

	// Otherwise derive it
	// eval_duration is nanoseconds, predicted_ms milliseconds
	const evalDurationNs = toFiniteNumber(payload.eval_duration);
	const predictedMs = toFiniteNumber(payload.predicted_ms);
	const durationMs =
		evalDurationNs !== null && evalDurationNs > 0 ? evalDurationNs / 1_000_000 : predictedMs;

	if (next.exact && durationMs !== null && durationMs > 0) {
		next.tokensPerSecond = next.tokens / (durationMs / 1000);
	}

	return next;
};

/**
 * Records a provider's prefill progress report.
 *
 * Values that go backwards are ignored: the report arrives on its own events and
 * a late one must not rewind a bar the user is watching.
 */
export const recordPrefillProgress = (
	stats: GenerationStats | null | undefined,
	progress: unknown,
	now: number = Date.now()
): GenerationStats => {
	if (!progress || typeof progress !== 'object') {
		return stats ?? createGenerationStats(now);
	}

	const payload = progress as Record<string, unknown>;
	const total = toFiniteNumber(payload.total);
	const processed = toFiniteNumber(payload.processed);

	if (total === null || total <= 0 || processed === null || processed < 0) {
		return stats ?? createGenerationStats(now);
	}

	const next: GenerationStats = stats ? { ...stats } : createGenerationStats(now);
	const previous = next.prefill;
	if (previous && processed < previous.processed) {
		return next;
	}

	next.prefill = {
		total,
		processed: Math.min(processed, total),
		cached: toFiniteNumber(payload.cache) ?? 0,
		elapsedMs: toFiniteNumber(payload.time_ms) ?? 0
	};

	return next;
};

export const completeGenerationStats = (
	stats: GenerationStats | null | undefined,
	now: number = Date.now()
): GenerationStats => {
	const next: GenerationStats = stats ? { ...stats } : createGenerationStats(now);
	next.completedAt = next.completedAt ?? now;
	return next;
};

/**
 * Resolve the numbers to render. A live response ticks off the caller's clock;
 * a finished or cancelled one freezes at the moment its last token landed.
 */
export const getGenerationStatsView = (
	stats: GenerationStats | null | undefined,
	now: number = Date.now(),
	streaming: boolean = false
): GenerationStatsView | null => {
	if (!stats?.startedAt) {
		return null;
	}

	const endedAt = stats.completedAt ?? (streaming ? now : (stats.lastTokenAt ?? now));
	const elapsedMs = Math.max(0, endedAt - stats.startedAt);

	// Rate is measured over decode time only, so a slow prompt ingest doesn't
	// drag the number down
	// this is the figure llama.cpp reports as eval rate
	const decodeMs = Math.max(0, endedAt - (stats.firstTokenAt ?? stats.startedAt));

	let tokensPerSecond = stats.tokensPerSecond ?? null;
	if (tokensPerSecond === null && stats.tokens > 0 && decodeMs >= MIN_RATE_WINDOW_MS) {
		tokensPerSecond = stats.tokens / (decodeMs / 1000);
	}

	return {
		tokens: stats.tokens,
		tokensPerSecond,
		elapsedMs,
		timeToFirstTokenMs: stats.firstTokenAt
			? Math.max(0, stats.firstTokenAt - stats.startedAt)
			: null,
		exact: Boolean(stats.exact),
		prefilling: streaming && !stats.firstTokenAt,
		prefill: buildPrefillView(stats)
	};
};

const buildPrefillView = (stats: GenerationStats): PrefillView | null => {
	const prefill = stats.prefill;
	if (!prefill || prefill.total <= 0) {
		return null;
	}

	const percent = Math.min(100, Math.max(0, (prefill.processed / prefill.total) * 100));

	// Project from the rate achieved so far. Needs a little of both to mean
	// anything, and nothing is left to wait for once it is done.
	let remainingMs: number | null = null;
	if (prefill.elapsedMs > 0 && prefill.processed > 0 && prefill.processed < prefill.total) {
		const perToken = prefill.elapsedMs / prefill.processed;
		remainingMs = Math.max(0, (prefill.total - prefill.processed) * perToken);
	}

	return {
		percent,
		processed: prefill.processed,
		total: prefill.total,
		cached: prefill.cached,
		remainingMs
	};
};

export const formatGenerationDuration = (ms: number): string => {
	const totalSeconds = Math.max(0, ms) / 1000;

	if (totalSeconds < 60) {
		return `${totalSeconds.toFixed(1)}s`;
	}

	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.floor(totalSeconds % 60);

	if (minutes < 60) {
		return `${minutes}m ${seconds}s`;
	}

	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds}s`;
};

export const formatTokensPerSecond = (value: number): string =>
	value >= 100 ? value.toFixed(0) : value.toFixed(2);
