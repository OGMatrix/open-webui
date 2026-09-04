import { describe, expect, it } from 'vitest';
import {
	applyGenerationUsage,
	recordPrefillProgress,
	completeGenerationStats,
	createGenerationStats,
	formatGenerationDuration,
	formatTokensPerSecond,
	getGenerationStatsView,
	recordGenerationDelta,
	syncGenerationProgress
} from './generationStats';

const T0 = 1_700_000_000_000;

describe('generationStats', () => {
	it('counts one token per streamed delta', () => {
		let stats = createGenerationStats(T0);
		stats = recordGenerationDelta(stats, 'Hello', T0 + 100);
		stats = recordGenerationDelta(stats, ' there', T0 + 200);

		expect(stats.tokens).toBe(2);
		expect(stats.chars).toBe(11);
		expect(stats.firstTokenAt).toBe(T0 + 100);
		expect(stats.lastTokenAt).toBe(T0 + 200);
	});

	it('splits a batched delta into several tokens', () => {
		const stats = recordGenerationDelta(createGenerationStats(T0), 'a'.repeat(40), T0 + 100);
		expect(stats.tokens).toBe(10);
	});

	it('ignores empty deltas without allocating', () => {
		const stats = createGenerationStats(T0);
		expect(recordGenerationDelta(stats, '', T0 + 100)).toBe(stats);
	});

	it('does not double count text a delta already accounted for', () => {
		let stats = recordGenerationDelta(createGenerationStats(T0), 'Hello', T0 + 100);
		stats = syncGenerationProgress(stats, 'Hello', T0 + 100);
		expect(stats.tokens).toBe(1);
	});

	it('counts text that arrived by whole-body replacement', () => {
		const stats = syncGenerationProgress(createGenerationStats(T0), 'a'.repeat(16), T0 + 100);
		expect(stats.tokens).toBe(4);
		expect(stats.chars).toBe(16);
	});

	it('keeps text that predates the measurement out of the count', () => {
		// A continued response baselines at whatever is already on the message.
		const stats = syncGenerationProgress(createGenerationStats(T0, 100), 'a'.repeat(120), T0 + 100);
		expect(stats.tokens).toBe(5);
	});

	it('replaces the estimate with the provider count', () => {
		let stats = recordGenerationDelta(createGenerationStats(T0), 'Hello', T0 + 100);
		stats = applyGenerationUsage(stats, { completion_tokens: 42 }, T0 + 200);

		expect(stats.tokens).toBe(42);
		expect(stats.exact).toBe(true);
	});

	it('reads the rate Ollama reports', () => {
		const stats = applyGenerationUsage(
			createGenerationStats(T0),
			{ eval_count: 100, 'response_token/s': 22.81 },
			T0 + 200
		);
		expect(stats.tokensPerSecond).toBeCloseTo(22.81);
	});

	it('ignores a rate the provider could not compute', () => {
		const stats = applyGenerationUsage(
			createGenerationStats(T0),
			{ eval_count: 100, 'response_token/s': 'N/A', eval_duration: 5_000_000_000 },
			T0 + 200
		);
		// Falls back to eval_duration: 100 tokens over 5s.
		expect(stats.tokensPerSecond).toBeCloseTo(20);
	});

	it('derives a llama.cpp rate from predicted_ms', () => {
		const stats = applyGenerationUsage(
			createGenerationStats(T0),
			{ predicted_n: 50, predicted_ms: 2000 },
			T0 + 200
		);
		expect(stats.tokens).toBe(50);
		expect(stats.tokensPerSecond).toBeCloseTo(25);
	});

	it('ticks while streaming and freezes once complete', () => {
		let stats = recordGenerationDelta(createGenerationStats(T0), 'Hello', T0 + 1000);

		const live = getGenerationStatsView(stats, T0 + 5000, true);
		expect(live?.elapsedMs).toBe(5000);

		stats = completeGenerationStats(stats, T0 + 6000);
		const frozen = getGenerationStatsView(stats, T0 + 60_000, false);
		expect(frozen?.elapsedMs).toBe(6000);
	});

	it('freezes a cancelled response at its last token', () => {
		// Stopping a response marks it done without ever sending a completion event.
		const stats = recordGenerationDelta(createGenerationStats(T0), 'Hello', T0 + 2000);
		expect(getGenerationStatsView(stats, T0 + 60_000, false)?.elapsedMs).toBe(2000);
	});

	it('measures the rate over decode time, not prompt time', () => {
		let stats = createGenerationStats(T0);
		// First token lands 4s in, then 10 tokens over the next 2s.
		stats = recordGenerationDelta(stats, 'a', T0 + 4000);
		for (let i = 1; i < 10; i += 1) {
			stats = recordGenerationDelta(stats, 'a', T0 + 4000 + i * 200);
		}
		stats = completeGenerationStats(stats, T0 + 6000);

		const view = getGenerationStatsView(stats, T0 + 6000, false);
		expect(view?.elapsedMs).toBe(6000);
		expect(view?.timeToFirstTokenMs).toBe(4000);
		expect(view?.tokensPerSecond).toBeCloseTo(5); // 10 tokens / 2s
	});

	it('withholds a rate until the window is long enough to be meaningful', () => {
		const stats = recordGenerationDelta(createGenerationStats(T0), 'a', T0 + 10);
		expect(getGenerationStatsView(stats, T0 + 20, true)?.tokensPerSecond).toBeNull();
	});

	it('reports the prefill phase until the first token arrives', () => {
		// The long quiet stretch before generation starts: llama.cpp calls this
		// prompt processing, and a 0 token count there is meaningless.
		const waiting = createGenerationStats(T0);
		expect(getGenerationStatsView(waiting, T0 + 3000, true)?.prefilling).toBe(true);

		const started = recordGenerationDelta(waiting, 'a', T0 + 4000);
		expect(getGenerationStatsView(started, T0 + 5000, true)?.prefilling).toBe(false);
	});

	it('is not prefilling once the response is no longer streaming', () => {
		const abandoned = createGenerationStats(T0);
		expect(getGenerationStatsView(abandoned, T0 + 3000, false)?.prefilling).toBe(false);
	});

	it('reads the prefill report llama.cpp actually sends', () => {
		// Captured from a live llama-server stream.
		const stats = recordPrefillProgress(createGenerationStats(T0), {
			total: 5657,
			cache: 0,
			processed: 4130,
			time_ms: 5588
		});
		const view = getGenerationStatsView(stats, T0 + 5588, true);

		expect(view?.prefill?.total).toBe(5657);
		expect(view?.prefill?.processed).toBe(4130);
		expect(view?.prefill?.percent).toBeCloseTo(73.0, 0);
		// 5588ms for 4130 tokens, 1527 left -> about 2.07s
		expect(view?.prefill?.remainingMs).toBeCloseTo(2066, -2);
	});

	it('does not let a late report rewind the bar', () => {
		let stats = recordPrefillProgress(createGenerationStats(T0), {
			total: 100,
			processed: 80,
			time_ms: 800
		});
		stats = recordPrefillProgress(stats, { total: 100, processed: 40, time_ms: 400 });
		expect(stats.prefill?.processed).toBe(80);
	});

	it('stops projecting once the prompt is fully read', () => {
		const stats = recordPrefillProgress(createGenerationStats(T0), {
			total: 5657,
			cache: 0,
			processed: 5657,
			time_ms: 8584
		});
		const view = getGenerationStatsView(stats, T0 + 8584, true);
		expect(view?.prefill?.percent).toBe(100);
		expect(view?.prefill?.remainingMs).toBeNull();
	});

	it('ignores a report with nothing usable in it', () => {
		const base = createGenerationStats(T0);
		expect(recordPrefillProgress(base, null).prefill).toBeUndefined();
		expect(recordPrefillProgress(base, { total: 0, processed: 0 }).prefill).toBeUndefined();
		expect(recordPrefillProgress(base, 'nope').prefill).toBeUndefined();
	});

	it('reports no prefill detail when the provider sent none', () => {
		expect(getGenerationStatsView(createGenerationStats(T0), T0 + 100, true)?.prefill).toBeNull();
	});

	it('returns nothing without a measurement', () => {
		expect(getGenerationStatsView(null, T0, true)).toBeNull();
	});

	it('formats durations and rates', () => {
		expect(formatGenerationDuration(1234)).toBe('1.2s');
		expect(formatGenerationDuration(123_000)).toBe('2m 3s');
		expect(formatGenerationDuration(3_723_000)).toBe('1h 2m 3s');
		expect(formatTokensPerSecond(22.812)).toBe('22.81');
		expect(formatTokensPerSecond(1234.5)).toBe('1235');
	});
});
