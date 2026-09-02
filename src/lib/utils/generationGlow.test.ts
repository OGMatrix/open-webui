import { describe, expect, it } from 'vitest';
import {
	GLOW_STYLES,
	glowMotion,
	glowStyleAttribute,
	glowVariables,
	hasInterior
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
});

describe('the variables handed to CSS', () => {
	it('names every property the frame reads', () => {
		const vars = glowVariables(glowMotion(30));
		expect(Object.keys(vars).sort()).toEqual([
			'--glow-bloom',
			'--glow-duration',
			'--glow-energy',
			'--glow-opacity'
		]);
	});

	it('writes units CSS accepts', () => {
		const vars = glowVariables(glowMotion(30));
		expect(vars['--glow-duration']).toMatch(/^\d+\.\d{2}s$/);
		expect(vars['--glow-bloom']).toMatch(/^\d+px$/);
		expect(Number(vars['--glow-opacity'])).toBeGreaterThan(0);
	});

	it('serialises to something a style attribute takes', () => {
		const attribute = glowStyleAttribute(glowMotion(30));
		expect(attribute).toContain('--glow-duration:');
		expect(attribute.split(';')).toHaveLength(4);
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
