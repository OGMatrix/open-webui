/**
 * A generation that never happened, so the settings can show one.
 *
 * Picking an animation from a dropdown means imagining it. This plays a short
 * run on a loop instead - the prompt being read, the answer arriving, the model
 * hesitating once and then settling - and feeds the same numbers the real thing
 * feeds, so what the preview shows is what the chat will do.
 *
 * Every value is a function of the time elapsed, with no state of its own: the
 * preview can be started, stopped and restarted without drifting, and the same
 * moment always looks the same, which is what makes it testable at all.
 */

export type PreviewPhase = 'reading' | 'writing' | 'settling';

export type PreviewFrame = {
	phase: PreviewPhase;
	/** Reading the prompt, nothing written yet. */
	prefilling: boolean;
	/** Reading progress, in the shape a provider reports it. */
	prefill: { percent: number } | null;
	/** Current rate, or null while nothing is being written. */
	tokensPerSecond: number | null;
	/** Tokens produced so far this run, which is what drives the ripples. */
	tokens: number;
};

/** One run of the loop. Long enough to show a whole arc, short enough to watch. */
export const PREVIEW_CYCLE_MS = 11_000;

const READING_MS = 2_600;
const WRITING_MS = 7_000;

/**
 * The rate at a point through the writing, in tokens per second.
 *
 * Shaped rather than random: it climbs, holds, stumbles once, and recovers.
 * A random walk would look plausible for a second and then look like noise,
 * and the stumble is the part worth seeing - it is what tells the styles apart.
 */
const writingRate = (progress: number): number => {
	if (progress < 0.12) {
		// Getting going.
		return 6 + (progress / 0.12) * 34;
	}
	if (progress < 0.52) {
		// Running, with a slow swell so it never looks frozen.
		return 40 + Math.sin((progress - 0.12) * 14) * 6;
	}
	if (progress < 0.64) {
		// The stumble.
		const through = (progress - 0.52) / 0.12;
		return Math.max(2, 40 - through * 38);
	}
	if (progress < 0.74) {
		// Picking back up.
		return 2 + ((progress - 0.64) / 0.1) * 32;
	}
	// Steady to the end.
	return 34 + Math.sin((progress - 0.74) * 20) * 4;
};

/** Tokens produced by a point through the writing, integrated from the rate. */
const tokensBy = (progress: number, steps = 48): number => {
	const seconds = (WRITING_MS / 1000) * progress;
	let total = 0;
	for (let step = 0; step < steps; step += 1) {
		total += writingRate((progress * (step + 0.5)) / steps);
	}
	return Math.round((total / steps) * seconds);
};

/** What the preview is doing at this point in its loop. */
export const previewFrame = (elapsedMs: number): PreviewFrame => {
	const time = ((elapsedMs % PREVIEW_CYCLE_MS) + PREVIEW_CYCLE_MS) % PREVIEW_CYCLE_MS;

	if (time < READING_MS) {
		const percent = Math.min(100, (time / READING_MS) * 100);
		return {
			phase: 'reading',
			prefilling: true,
			prefill: { percent },
			tokensPerSecond: null,
			tokens: 0
		};
	}

	const writing = time - READING_MS;
	if (writing < WRITING_MS) {
		const progress = writing / WRITING_MS;
		return {
			phase: 'writing',
			prefilling: false,
			prefill: null,
			tokensPerSecond: Math.round(writingRate(progress) * 10) / 10,
			tokens: tokensBy(progress)
		};
	}

	// The answer is done; the frame has a moment to fade before it starts over.
	return {
		phase: 'settling',
		prefilling: false,
		prefill: null,
		tokensPerSecond: null,
		tokens: tokensBy(1)
	};
};
