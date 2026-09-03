/**
 * Turns how fast a model is answering into how the input frame should move.
 *
 * The point of animating the frame at all is that it says something. A fixed
 * spinner says only "busy", which the stop button already says. Speed is the
 * one thing about a running generation that changes moment to moment and that
 * a person can feel: a local 3B model racing along and a 70B model grinding
 * through a long prompt should not look the same.
 */

export const GLOW_STYLES = [
	'off',
	'sweep',
	'pulse',
	'aurora',
	'nebula',
	'ripple',
	'meter'
] as const;
export type GlowStyle = (typeof GLOW_STYLES)[number];

/**
 * Styles that light the field itself, not only its edge.
 *
 * These carry drifting blobs behind the text, so they cost more than a ring and
 * are only built when one is actually chosen.
 */
const INTERIOR_STYLES = new Set<GlowStyle>(['aurora', 'nebula']);

/** Styles that answer to each arrival of text rather than to a smoothed rate. */
const ARRIVAL_STYLES = new Set<GlowStyle>(['ripple']);

export const respondsToArrivals = (style: GlowStyle): boolean => ARRIVAL_STYLES.has(style);

/** Styles that draw the recent history of the rate rather than its present value. */
export const showsHistory = (style: GlowStyle): boolean => style === 'meter';

export const hasInterior = (style: GlowStyle): boolean => INTERIOR_STYLES.has(style);

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
	/** How far light reaches past the frame, in pixels. 0 when switched off. */
	spillPx: number;
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
	options: {
		prefilling?: boolean;
		speedScale?: number;
		intensity?: number;
		spill?: number;
	} = {}
): GlowMotion => {
	const speedScale = clamp(options.speedScale ?? 1, 0.25, 3);
	const intensity = clamp(options.intensity ?? 1, 0, 2);
	const spill = clamp(options.spill ?? 1, 0, 2);

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

	/*
	 * A full turn takes six seconds when barely moving and one when flying.
	 *
	 * Rounded to the same two decimals the CSS variable is written with. The
	 * frame's phase is corrected whenever this changes, and correcting it
	 * against a number the stylesheet never received would push the light off
	 * by exactly the difference.
	 */
	const durationSeconds = Math.round((clamp(6 - energy * 5, 0.6, 12) / speedScale) * 100) / 100;

	return {
		energy,
		durationSeconds,
		opacity: clamp((0.35 + energy * 0.45) * intensity, 0, 1),
		bloomPx: Math.round(clamp((6 + energy * 14) * intensity, 0, 40)),
		/*
		 * How far the light reaches is the setting's business alone, not the
		 * rate's. A reach that grew and shrank with every reading would have the
		 * browser redraw a wide blur several times a second, and a frame whose
		 * size breathes reads as unsteady rather than as fast. Speed is already
		 * being said, by the band travelling round the edge.
		 */
		spillPx: intensity === 0 ? 0 : Math.round(clamp(spill * 22, 0, 60))
	};
};

/**
 * Animations whose duration is a fixed multiple of `--glow-duration`.
 *
 * Changing a running animation's duration keeps the elapsed time and recomputes
 * the progress from it, so the light lurches to wherever `(t mod D) / D` now
 * lands — measured at 349 degrees against an expected 7. The jump does not get
 * smaller when the duration changes by less: past the first turn the two
 * remainders have nothing to do with each other.
 *
 * Every one of these scales by the same factor as `--glow-duration` does, so
 * multiplying each of their clocks by that factor holds the progress exactly
 * where it was. The grain and the ripple rings are left out on purpose: their
 * durations are fixed, and stretching their clocks would be the bug rather than
 * the cure.
 */
export const PACED_ANIMATIONS = new Set([
	'glow-turn',
	'glow-breathe',
	'glow-drift-a',
	'glow-drift-b',
	'glow-drift-c'
]);

/**
 * How much to stretch those clocks when the pace changes, or null for nothing
 * to do.
 *
 * The first reading has nothing to compare against, and a pace that has not
 * moved needs no correction — touching the clocks either time would be motion
 * introduced by the fix.
 */
export const rephaseFactor = (
	previous: number | null | undefined,
	next: number | null | undefined
): number | null => {
	if (
		typeof previous !== 'number' ||
		typeof next !== 'number' ||
		!Number.isFinite(previous) ||
		!Number.isFinite(next) ||
		previous <= 0 ||
		next <= 0 ||
		previous === next
	) {
		return null;
	}
	return next / previous;
};

/** The CSS custom properties a frame needs, ready to drop on an element. */
export const glowVariables = (motion: GlowMotion): Record<string, string> => ({
	'--glow-duration': `${motion.durationSeconds.toFixed(2)}s`,
	'--glow-opacity': motion.opacity.toFixed(3),
	'--glow-bloom': `${motion.bloomPx}px`,
	'--glow-spill': `${motion.spillPx}px`,
	'--glow-energy': motion.energy.toFixed(3)
});

/** Serialises those properties for a `style` attribute. */
export const glowStyleAttribute = (motion: GlowMotion): string =>
	Object.entries(glowVariables(motion))
		.map(([name, value]) => `${name}: ${value}`)
		.join('; ');

/**
 * Whether enough has passed to emit another ripple.
 *
 * Tokens arrive many times a second, and a ring for every one of them would be
 * a strobe rather than a rhythm. Rings are spaced far enough apart to be told
 * apart, so a fast model rings steadily rather than blurring into a haze.
 */
export const RIPPLE_MIN_GAP_MS = 110;

export const shouldRipple = (lastAt: number, now: number, minGapMs = RIPPLE_MIN_GAP_MS): boolean =>
	now - lastAt >= minGapMs;

/** How many samples of the rate the meter keeps. */
export const METER_SAMPLES = 32;

/**
 * Adds one reading to the rolling history, dropping the oldest.
 *
 * A reading that could not be taken is kept as a zero rather than skipped: a
 * stall is part of the shape of a generation, and closing the gap would hide
 * exactly the moment worth seeing.
 */
export const pushRate = (
	history: number[],
	rate: number | null | undefined,
	max = METER_SAMPLES
): number[] => {
	const value = typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : 0;
	const next = [...history, value];
	return next.length > max ? next.slice(next.length - max) : next;
};

/**
 * Bar heights from 0 to 1 for the meter, scaled to the tallest reading seen.
 *
 * Scaling to the window's own peak rather than to a fixed ceiling keeps the
 * shape legible whether a model runs at four tokens a second or at ninety;
 * what is being shown is how steady it is, not how it compares to some other
 * model.
 */
export const meterBars = (history: number[], count = METER_SAMPLES): number[] => {
	const window = history.slice(-count);
	if (window.length === 0) {
		return [];
	}

	const peak = Math.max(...window);
	if (peak <= 0) {
		return window.map(() => 0);
	}

	// A floor keeps a bar visible at a rate too low to draw otherwise, so the
	// meter reads as quiet rather than as broken.
	return window.map((value) => Math.max(0.06, Math.min(1, value / peak)));
};

/**
 * How much of the frame the prompt has been read through, 0 to 1.
 *
 * The wait before the first token is the least explained part of a generation,
 * and on a long prompt it is also the longest. Where a provider reports its
 * progress, the frame can fill with it instead of spinning through it.
 */
export const prefillFraction = (
	prefill: { percent?: number } | null | undefined
): number | null => {
	const percent = prefill?.percent;
	if (typeof percent !== 'number' || !Number.isFinite(percent)) {
		return null;
	}
	// Providers report this as a percentage in some builds and a fraction in
	// others; both mean the same thing and both have to land in 0..1.
	const fraction = percent > 1 ? percent / 100 : percent;
	return Math.min(1, Math.max(0, fraction));
};

/**
 * The assistant message being written right now, or null when none is.
 *
 * There is a `generating` flag nearby, and it is the wrong one: it is raised
 * only on the merge-of-agents path, so on an ordinary answer it stays false
 * from beginning to end. What actually marks a running answer is an assistant
 * message that has not been marked done - which is what the rest of the chat
 * checks, and what this returns.
 */
export const streamingAssistantMessage = <T extends { role?: string; done?: boolean }>(
	history:
		| {
				currentId?: string | null;
				messages?: Record<string, T> | null;
		  }
		| null
		| undefined
): T | null => {
	const id = history?.currentId;
	if (!id) {
		return null;
	}
	const message = history?.messages?.[id];
	if (!message || message.role !== 'assistant' || message.done === true) {
		return null;
	}
	return message;
};
