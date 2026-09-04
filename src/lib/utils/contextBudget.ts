/**
 * Where compaction will fire, worked out the same way the server works it out.
 *
 * The window is not the budget. A request has to leave room for the answer and
 * room for the count being wrong, and compaction fires at a fraction of what is
 * left. So "how much room is there before this gets compacted" cannot be read
 * off the window, and a bar that fills against the window alone says nothing
 * about when the thing it is warning about will actually happen.
 *
 * This mirrors backend/open_webui/utils/context_budget.py exactly -- same
 * reserves, same ratios, same rounding -- and contextBudget.test.ts checks the
 * two against figures generated from the Python. If one moves without the
 * other, the interface starts promising something the server will not do.
 */

/** Fraction of the usable budget at which compaction fires. */
export const TRIGGER_RATIO = 0.85;
/** Fraction of the usable budget kept as verbatim recent turns. */
export const RETENTION_RATIO = 0.4;

const OUTPUT_RESERVE_CAP = 4096;
const OUTPUT_RESERVE_FLOOR = 512;
const OUTPUT_RESERVE_DIVISOR = 8;

const SAFETY_RESERVE_RATIO = 0.05;
const SAFETY_RESERVE_FLOOR = 256;

export type ContextBudget = {
	/** The model's context window. */
	window: number;
	/** What a request may actually spend, once the reserves are taken out. */
	usable: number;
	outputReserve: number;
	safetyReserve: number;
	/** The token count at which compaction fires. */
	trigger: number;
	/** What is kept verbatim afterwards. */
	target: number;
};

const positive = (value: unknown): number | null => {
	const parsed = typeof value === 'string' ? Number(value) : value;
	return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
		? Math.trunc(parsed)
		: null;
};

/**
 * The budget for a window, or null when no window is known.
 *
 * Null rather than a guess, for the same reason the server refuses to guess:
 * assuming a small window for a model that states none would promise a
 * compaction that is not coming.
 */
export const resolveBudget = (
	window: number | null | undefined,
	maxOutputTokens: number | null = null
): ContextBudget | null => {
	const size = positive(window);
	if (!size) {
		return null;
	}

	let outputReserve =
		positive(maxOutputTokens) ??
		Math.min(
			OUTPUT_RESERVE_CAP,
			Math.max(OUTPUT_RESERVE_FLOOR, Math.trunc(size / OUTPUT_RESERVE_DIVISOR))
		);
	// A generation limit larger than the window is a setting, not a fact; it
	// would leave nothing to send.
	outputReserve = Math.min(outputReserve, Math.trunc(size / 2));

	const safetyReserve = Math.max(SAFETY_RESERVE_FLOOR, Math.trunc(size * SAFETY_RESERVE_RATIO));
	const usable = Math.max(0, size - outputReserve - safetyReserve);

	return {
		window: size,
		usable,
		outputReserve,
		safetyReserve,
		trigger: Math.trunc(usable * TRIGGER_RATIO),
		target: Math.trunc(usable * RETENTION_RATIO)
	};
};

/** The token count at which compaction fires, or null when it cannot be known. */
export const compactionTrigger = (
	window: number | null | undefined,
	maxOutputTokens: number | null = null
): number | null => resolveBudget(window, maxOutputTokens)?.trigger ?? null;
