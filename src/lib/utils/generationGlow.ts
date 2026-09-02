/**
 * Turns how fast a model is answering into how the input frame should move.
 *
 * The point of animating the frame at all is that it says something. A fixed
 * spinner says only "busy", which the stop button already says. Speed is the
 * one thing about a running generation that changes moment to moment and that
 * a person can feel: a local 3B model racing along and a 70B model grinding
 * through a long prompt should not look the same.
 */

export const GLOW_STYLES = ['off', 'sweep', 'pulse', 'aurora'] as const;
export type GlowStyle = (typeof GLOW_STYLES)[number];

/**
 * The range worth distinguishing, in tokens per second.
 *
 * Below the floor everything feels stalled and above the ceiling everything
 * feels instant, so neither end needs more resolution. Local models sit in the
 * single digits, hosted ones in the high tens; a logarithmic curve gives both
 * ends room instead of flattening the slow end into nothing.
 */
const SLOW = 2;
const FAST = 120;

export type GlowMotion = {
	/** 0 while stalled, 1 at full tilt. */
	energy: number;
	/** Seconds for one full turn of the sweep. */
	durationSeconds: number;
	/** 0..1, how present the effect is. */
	opacity: number;
	/** Extra blur radius in pixels for the outer bloom. */
	bloomPx: number;
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * How lively the frame should be for a given rate.
 *
 * `null` means no rate is known yet, which is not the same as slow: a stream
 * that has not produced a token is working on the prompt, and saying so with a
 * near-still frame is more honest than pretending it is crawling.
 */
export const glowMotion = (
	tokensPerSecond: number | null | undefined,
	options: { prefilling?: boolean; speedScale?: number; intensity?: number } = {}
): GlowMotion => {
	const speedScale = clamp(options.speedScale ?? 1, 0.25, 3);
	const intensity = clamp(options.intensity ?? 1, 0, 2);

	let energy: number;
	if (options.prefilling) {
		// Reading the prompt: alive, but not producing anything yet.
		energy = 0.12;
	} else if (typeof tokensPerSecond !== 'number' || !Number.isFinite(tokensPerSecond)) {
		// Streaming with nothing measured yet. Halfway is the honest guess.
		energy = 0.5;
	} else {
		const rate = clamp(tokensPerSecond, SLOW, FAST);
		energy = Math.log(rate / SLOW) / Math.log(FAST / SLOW);
	}

	energy = clamp(energy, 0, 1);

	// A full turn takes six seconds when barely moving and one when flying.
	const durationSeconds = clamp(6 - energy * 5, 0.6, 12) / speedScale;

	return {
		energy,
		durationSeconds,
		opacity: clamp((0.35 + energy * 0.45) * intensity, 0, 1),
		bloomPx: Math.round(clamp((6 + energy * 14) * intensity, 0, 40))
	};
};

/** The CSS custom properties a frame needs, ready to drop on an element. */
export const glowVariables = (motion: GlowMotion): Record<string, string> => ({
	'--glow-duration': `${motion.durationSeconds.toFixed(2)}s`,
	'--glow-opacity': motion.opacity.toFixed(3),
	'--glow-bloom': `${motion.bloomPx}px`,
	'--glow-energy': motion.energy.toFixed(3)
});

/** Serialises those properties for a `style` attribute. */
export const glowStyleAttribute = (motion: GlowMotion): string =>
	Object.entries(glowVariables(motion))
		.map(([name, value]) => `${name}: ${value}`)
		.join('; ');
