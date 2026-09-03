import { describe, expect, it } from 'vitest';
import {
	GLOW_STYLES,
	PACED_ANIMATIONS,
	rephaseFactor,
	glowMotion,
	glowStyleAttribute,
	glowVariables,
	hasInterior,
	meterBars,
	prefillFraction,
	pushRate,
	respondsToArrivals,
	shouldRipple,
	showsHistory,
	streamingAssistantMessage
} from './generationGlow';

describe('glowMotion', () => {
	it('moves faster the faster the model answers', () => {
		const slow = glowMotion(3);
		const brisk = glowMotion(30);
		const fast = glowMotion(120);

		expect(slow.energy).toBeLessThan(brisk.energy);
		expect(brisk.energy).toBeLessThan(fast.energy);
		// A shorter turn is a faster one.
		expect(slow.durationSeconds).toBeGreaterThan(fast.durationSeconds);
	});

	it('gives the slow end real resolution rather than flattening it', () => {
		// Two local models an order of magnitude apart must not look alike.
		const crawling = glowMotion(2);
		const steady = glowMotion(12);
		expect(steady.energy - crawling.energy).toBeGreaterThan(0.2);
	});

	it('treats anything past the ceiling as simply fast', () => {
		expect(glowMotion(120).energy).toBeCloseTo(glowMotion(5000).energy, 5);
		expect(glowMotion(1).energy).toBeCloseTo(glowMotion(0).energy, 5);
	});

	it('stays nearly still while the prompt is still being read', () => {
		// Nothing is being produced yet, and saying otherwise would be a lie.
		const prefill = glowMotion(null, { prefilling: true });
		expect(prefill.energy).toBeLessThan(0.2);
		expect(prefill.durationSeconds).toBeGreaterThan(glowMotion(60).durationSeconds);
	});

	it('takes a middle position when the rate is not known yet', () => {
		// Streaming, nothing measured. Neither still nor racing.
		const unknown = glowMotion(null);
		expect(unknown.energy).toBeGreaterThan(0.3);
		expect(unknown.energy).toBeLessThan(0.7);
	});

	it('survives a nonsense rate', () => {
		for (const rate of [NaN, Infinity, -Infinity, -5, undefined]) {
			const motion = glowMotion(rate as number);
			expect(Number.isFinite(motion.durationSeconds)).toBe(true);
			expect(motion.opacity).toBeGreaterThanOrEqual(0);
			expect(motion.opacity).toBeLessThanOrEqual(1);
		}
	});

	it('lets the speed setting stretch and compress the whole range', () => {
		const normal = glowMotion(30);
		const doubled = glowMotion(30, { speedScale: 2 });
		const halved = glowMotion(30, { speedScale: 0.5 });

		expect(doubled.durationSeconds).toBeLessThan(normal.durationSeconds);
		expect(halved.durationSeconds).toBeGreaterThan(normal.durationSeconds);
		// The reading of the rate itself does not change, only the pace.
		expect(doubled.energy).toBeCloseTo(normal.energy, 5);
	});

	it('clamps an absurd speed setting instead of stopping or blurring', () => {
		expect(glowMotion(30, { speedScale: 999 }).durationSeconds).toBeGreaterThan(0);
		expect(Number.isFinite(glowMotion(30, { speedScale: 0 }).durationSeconds)).toBe(true);
	});

	it('lets the intensity setting reach nothing at all', () => {
		const invisible = glowMotion(30, { intensity: 0 });
		expect(invisible.opacity).toBe(0);
		expect(invisible.bloomPx).toBe(0);
	});

	it('keeps opacity inside what a colour can take', () => {
		expect(glowMotion(120, { intensity: 2 }).opacity).toBeLessThanOrEqual(1);
	});

	it('lets the spill setting say how far the light reaches', () => {
		expect(glowMotion(30, { spill: 0 }).spillPx).toBe(0);
		expect(glowMotion(30, { spill: 2 }).spillPx).toBeGreaterThan(
			glowMotion(30, { spill: 1 }).spillPx
		);
	});

	it('reaches the same distance however fast the model is answering', () => {
		// A reach that moved with the rate would redraw a wide blur several times
		// a second, and would read as an unsteady frame rather than a fast one.
		expect(glowMotion(3).spillPx).toBe(glowMotion(120).spillPx);
		expect(glowMotion(null, { prefilling: true }).spillPx).toBe(glowMotion(60).spillPx);
	});

	it('has nothing to spill when nothing would be seen', () => {
		// The layer is skipped on a zero reach, so this is what keeps a wide blur
		// off the compositor when the effect is turned all the way down.
		expect(glowMotion(30, { intensity: 0 }).spillPx).toBe(0);
	});

	it('clamps an absurd spill setting rather than blurring the page', () => {
		expect(glowMotion(30, { spill: 99 }).spillPx).toBeLessThanOrEqual(60);
		expect(glowMotion(30, { spill: -4 }).spillPx).toBe(0);
	});
});

describe('the variables handed to CSS', () => {
	it('names every property the frame reads', () => {
		const vars = glowVariables(glowMotion(30));
		expect(Object.keys(vars).sort()).toEqual([
			'--glow-bloom',
			'--glow-duration',
			'--glow-energy',
			'--glow-opacity',
			'--glow-spill'
		]);
	});

	it('writes units CSS accepts', () => {
		const vars = glowVariables(glowMotion(30));
		expect(vars['--glow-duration']).toMatch(/^\d+\.\d{2}s$/);
		expect(vars['--glow-bloom']).toMatch(/^\d+px$/);
		expect(vars['--glow-spill']).toMatch(/^\d+px$/);
		expect(Number(vars['--glow-opacity'])).toBeGreaterThan(0);
	});

	it('serialises to something a style attribute takes', () => {
		const attribute = glowStyleAttribute(glowMotion(30));
		expect(attribute).toContain('--glow-duration:');
		expect(attribute.split(';')).toHaveLength(5);
	});
});

describe('which styles light the field itself', () => {
	it('knows the two that do', () => {
		expect(hasInterior('aurora')).toBe(true);
		expect(hasInterior('nebula')).toBe(true);
	});

	it('leaves the edge-only ones alone', () => {
		// Building drifting blobs for a style that never shows them is work for
		// nothing, on every frame.
		expect(hasInterior('sweep')).toBe(false);
		expect(hasInterior('pulse')).toBe(false);
		expect(hasInterior('off')).toBe(false);
	});

	it('has an answer for every style that exists', () => {
		for (const style of GLOW_STYLES) {
			expect(typeof hasInterior(style)).toBe('boolean');
		}
	});
});

describe('ripples, one per arrival of text', () => {
	it('spaces rings far enough apart to be told apart', () => {
		// Tokens arrive many times a second; a ring for each would be a strobe.
		expect(shouldRipple(1000, 1000)).toBe(false);
		expect(shouldRipple(1000, 1050)).toBe(false);
		expect(shouldRipple(1000, 1200)).toBe(true);
	});

	it('lets the gap be tuned', () => {
		expect(shouldRipple(0, 50, 40)).toBe(true);
		expect(shouldRipple(0, 50, 400)).toBe(false);
	});

	it('rings on the first arrival, with no previous one to wait for', () => {
		expect(shouldRipple(0, Date.now())).toBe(true);
	});
});

describe('the rate history behind the meter', () => {
	it('keeps the newest readings and drops the oldest', () => {
		let history: number[] = [];
		for (let i = 1; i <= 40; i += 1) history = pushRate(history, i, 8);
		expect(history).toEqual([33, 34, 35, 36, 37, 38, 39, 40]);
	});

	it('records a stall as a zero rather than skipping it', () => {
		// Closing the gap would hide exactly the moment worth seeing.
		expect(pushRate([10, 12], null)).toEqual([10, 12, 0]);
		expect(pushRate([10], NaN)).toEqual([10, 0]);
		expect(pushRate([10], -4)).toEqual([10, 0]);
	});

	it('scales the bars to the window it is showing', () => {
		// The same shape, ten times faster, has to look the same.
		expect(meterBars([2, 4, 8])).toEqual(meterBars([20, 40, 80]));
	});

	it('puts the tallest reading at the top', () => {
		const bars = meterBars([5, 20, 10]);
		expect(bars[1]).toBe(1);
		expect(bars[0]).toBeLessThan(bars[1]);
	});

	it('keeps a quiet stretch visible instead of blank', () => {
		const bars = meterBars([100, 1, 1]);
		expect(bars[1]).toBeGreaterThan(0);
	});

	it('survives a history that is empty or all stalled', () => {
		expect(meterBars([])).toEqual([]);
		expect(meterBars([0, 0, 0])).toEqual([0, 0, 0]);
	});

	it('shows only as many bars as asked for', () => {
		expect(meterBars([1, 2, 3, 4, 5], 3)).toHaveLength(3);
	});
});

describe('the prompt-reading fill', () => {
	it('reads a percentage', () => {
		expect(prefillFraction({ percent: 42 })).toBeCloseTo(0.42, 5);
	});

	it('reads a fraction just as well', () => {
		// Providers disagree about which they report; both mean the same thing.
		expect(prefillFraction({ percent: 0.42 })).toBeCloseTo(0.42, 5);
	});

	it('never leaves the frame', () => {
		expect(prefillFraction({ percent: 140 })).toBe(1);
		expect(prefillFraction({ percent: -5 })).toBe(0);
	});

	it('says nothing when the provider reported nothing', () => {
		expect(prefillFraction(null)).toBeNull();
		expect(prefillFraction({})).toBeNull();
		expect(prefillFraction({ percent: NaN })).toBeNull();
	});
});

describe('what each style is driven by', () => {
	it('knows which one answers to arrivals', () => {
		expect(respondsToArrivals('ripple')).toBe(true);
		expect(respondsToArrivals('sweep')).toBe(false);
	});

	it('knows which one draws the history', () => {
		expect(showsHistory('meter')).toBe(true);
		expect(showsHistory('nebula')).toBe(false);
	});

	it('has an answer for every style', () => {
		for (const style of GLOW_STYLES) {
			expect(typeof respondsToArrivals(style)).toBe('boolean');
			expect(typeof showsHistory(style)).toBe('boolean');
		}
	});
});

describe('spotting the answer being written', () => {
	const writing = { role: 'assistant', done: false, content: 'hal' };
	const finished = { role: 'assistant', done: true, content: 'hallo' };
	const asked = { role: 'user', done: true, content: 'hi' };

	it('finds an assistant message that is not done yet', () => {
		expect(streamingAssistantMessage({ currentId: 'b', messages: { a: asked, b: writing } })).toBe(
			writing
		);
	});

	it('reports nothing once the answer is done', () => {
		expect(
			streamingAssistantMessage({ currentId: 'b', messages: { a: asked, b: finished } })
		).toBeNull();
	});

	it('never mistakes the question for an answer', () => {
		// Between sending and the first chunk, the newest message is the user's.
		expect(streamingAssistantMessage({ currentId: 'a', messages: { a: asked } })).toBeNull();
	});

	it('does not treat a message with no done flag as finished', () => {
		// The flag is written as false at creation, but absence must not read as
		// "done" - that would hide the animation for the whole first chunk.
		const fresh = { role: 'assistant', content: '' };
		expect(streamingAssistantMessage({ currentId: 'b', messages: { b: fresh } })).toBe(fresh);
	});

	it('survives an empty or malformed history', () => {
		expect(streamingAssistantMessage(null)).toBeNull();
		expect(streamingAssistantMessage(undefined)).toBeNull();
		expect(streamingAssistantMessage({})).toBeNull();
		expect(streamingAssistantMessage({ currentId: 'nope', messages: {} })).toBeNull();
		expect(streamingAssistantMessage({ currentId: null, messages: null })).toBeNull();
	});
});

describe('holding the phase when the pace changes', () => {
	it('stretches the clock by the same factor the duration moved', () => {
		expect(rephaseFactor(3, 1.5)).toBe(0.5);
		expect(rephaseFactor(2, 4)).toBe(2);
	});

	it('does nothing on the first reading or on no change', () => {
		// Touching the clocks either time would be motion introduced by the fix.
		expect(rephaseFactor(null, 3)).toBeNull();
		expect(rephaseFactor(undefined, 3)).toBeNull();
		expect(rephaseFactor(3, 3)).toBeNull();
	});

	it('refuses a pace that cannot be divided by', () => {
		expect(rephaseFactor(0, 3)).toBeNull();
		expect(rephaseFactor(3, 0)).toBeNull();
		expect(rephaseFactor(-2, 3)).toBeNull();
		expect(rephaseFactor(NaN, 3)).toBeNull();
		expect(rephaseFactor(3, Infinity)).toBeNull();
	});

	it('names the animations that follow the pace, and only those', () => {
		// The grain and the ripple rings run on fixed durations; stretching
		// their clocks would be the bug rather than the cure.
		expect(PACED_ANIMATIONS.has('glow-turn')).toBe(true);
		expect(PACED_ANIMATIONS.has('glow-drift-b')).toBe(true);
		expect(PACED_ANIMATIONS.has('glow-grain-shift')).toBe(false);
		expect(PACED_ANIMATIONS.has('glow-ring-out')).toBe(false);
		expect(PACED_ANIMATIONS.has('glow-enter')).toBe(false);
	});
});

describe('the duration the stylesheet actually receives', () => {
	it('is the same number the phase correction is computed from', () => {
		// Correcting against a value the stylesheet never saw would push the
		// light off by exactly the difference.
		for (const rate of [2, 7, 30, 61, 120]) {
			const motion = glowMotion(rate);
			expect(glowVariables(motion)['--glow-duration']).toBe(
				`${motion.durationSeconds.toFixed(2)}s`
			);
			expect(Math.round(motion.durationSeconds * 100) / 100).toBe(motion.durationSeconds);
		}
	});

	it('never rounds down to a standstill, even at the fastest setting', () => {
		expect(glowMotion(120, { speedScale: 3 }).durationSeconds).toBeGreaterThan(0);
		expect(glowMotion(120, { speedScale: 999 }).durationSeconds).toBeGreaterThan(0);
	});
});
