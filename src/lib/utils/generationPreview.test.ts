import { describe, expect, it } from 'vitest';
import { PREVIEW_CYCLE_MS, previewFrame } from './generationPreview';

/** Every distinct moment of one run, sampled finely enough to catch each phase. */
const run = Array.from({ length: 220 }, (_, i) => previewFrame((i * PREVIEW_CYCLE_MS) / 220));

describe('the preview run', () => {
	it('reads the prompt before it writes anything', () => {
		const first = previewFrame(0);
		expect(first.phase).toBe('reading');
		expect(first.prefilling).toBe(true);
		expect(first.tokens).toBe(0);
	});

	it('fills the reading progress from nothing to full', () => {
		expect(previewFrame(0).prefill?.percent).toBe(0);
		expect(previewFrame(1300).prefill?.percent).toBeCloseTo(50, 0);
		expect(previewFrame(2599).prefill?.percent).toBeGreaterThan(99);
	});

	it('stops reporting reading progress once it writes', () => {
		const writing = previewFrame(4000);
		expect(writing.phase).toBe('writing');
		expect(writing.prefilling).toBe(false);
		expect(writing.prefill).toBeNull();
	});

	it('goes through all three phases and no others', () => {
		expect(new Set(run.map((frame) => frame.phase))).toEqual(
			new Set(['reading', 'writing', 'settling'])
		);
	});

	it('never lets the token count go backwards while writing', () => {
		const writing = run.filter((frame) => frame.phase === 'writing');
		for (let i = 1; i < writing.length; i += 1) {
			expect(writing[i].tokens).toBeGreaterThanOrEqual(writing[i - 1].tokens);
		}
	});

	it('produces tokens steadily, so the ripples have something to ring for', () => {
		const writing = run.filter((frame) => frame.phase === 'writing');
		expect(writing.at(-1)!.tokens).toBeGreaterThan(150);
	});

	it('stumbles once, which is the part worth watching', () => {
		// A style driven by the rate has nothing to show if the rate never moves.
		const rates = run
			.filter((frame) => frame.phase === 'writing')
			.map((frame) => frame.tokensPerSecond ?? 0);
		expect(Math.min(...rates)).toBeLessThan(8);
		expect(Math.max(...rates)).toBeGreaterThan(35);
	});

	it('keeps every rate inside what a real model does', () => {
		for (const frame of run) {
			if (frame.tokensPerSecond === null) continue;
			expect(frame.tokensPerSecond).toBeGreaterThan(0);
			expect(frame.tokensPerSecond).toBeLessThan(200);
		}
	});

	it('loops seamlessly, so the same moment always looks the same', () => {
		for (const at of [0, 1500, 5000, 9500]) {
			expect(previewFrame(at)).toEqual(previewFrame(at + PREVIEW_CYCLE_MS));
			expect(previewFrame(at)).toEqual(previewFrame(at + PREVIEW_CYCLE_MS * 7));
		}
	});

	it('survives a negative or absurd time', () => {
		// A clock that jumped backwards must not produce a broken frame.
		for (const at of [-1, -PREVIEW_CYCLE_MS * 3.5, Number.MAX_SAFE_INTEGER]) {
			const frame = previewFrame(at);
			expect(['reading', 'writing', 'settling']).toContain(frame.phase);
			expect(frame.tokens).toBeGreaterThanOrEqual(0);
		}
	});

	it('holds no state of its own', () => {
		// Sampling out of order must give the same answers as sampling in order.
		const forwards = [0, 3000, 6000, 9000].map(previewFrame);
		const backwards = [9000, 6000, 3000, 0].map(previewFrame).reverse();
		expect(forwards).toEqual(backwards);
	});
});
