/**
 * How the row under the prompt fits what is switched on into the space it has.
 *
 * It used to decide between "one line" and "two lines" by the width of the
 * whole chat pane, while the composer itself was capped at the reading width.
 * On a wide window the pane said "plenty of room", the composer had 650 pixels,
 * and the chips were pushed into a strip that scrolled sideways -- the one
 * layout usability research is most consistent about people missing.
 *
 * The row now measures itself and settles on the richest layout that actually
 * fits, in this order:
 *
 * 1. `full`            -- one line, every chip with its words.
 * 2. `compact`         -- one line, chips reduced to their icons. The words move
 *                         into the tooltip and the accessible name, where they
 *                         already were.
 * 3. `stacked`         -- the chips get a line of their own above the actions,
 *                         with their words back -- only if that line holds them.
 * 4. `stacked-compact` -- a line of their own, as icons, wrapping if even that
 *                         is too much.
 *
 * The fourth exists because of phones: stacked chips with their words wrapped
 * onto two lines of their own, and the composer carried three rows of controls
 * where two would do.
 *
 * Nothing is ever scrolled and nothing is ever hidden behind a "more" button:
 * with a handful of chips, a second line keeps everything in view, and content
 * behind a menu is content fewer people find.
 */

export type ToolbarDensity = 'full' | 'compact' | 'stacked' | 'stacked-compact';

/** The layouts to try, richest first. The last one always fits: it may wrap. */
export const DENSITIES: readonly ToolbarDensity[] = [
	'full',
	'compact',
	'stacked',
	'stacked-compact'
];

/** The layout nothing is ever measured against, because it wraps. */
const LAST = DENSITIES[DENSITIES.length - 1];

/**
 * Settle on a layout.
 *
 * `fits` applies a layout and reports whether the chips then sit on one line
 * without running past their space. It is called at most three times; the
 * last layout is never tried, because a layout that wraps cannot overflow.
 */
export const fitDensity = async (
	fits: (density: ToolbarDensity) => boolean | Promise<boolean>
): Promise<ToolbarDensity> => {
	for (const density of DENSITIES) {
		if (density === LAST) return density;
		if (await fits(density)) return density;
	}
	return LAST;
};

/** Whether a layout puts the chips on a line of their own. */
export const isStacked = (density: ToolbarDensity): boolean => density.startsWith('stacked');

/** Whether a layout shows the chips as icons. */
export const isCompact = (density: ToolbarDensity): boolean => density.endsWith('compact');

/** A box, as far as fitting is concerned. */
export interface ChipBox {
	left: number;
	right: number;
	top: number;
	width: number;
}

/**
 * Whether the chips fit where they are, on one line.
 *
 * Takes the boxes of the chips' own buttons rather than of the list's
 * children: several chips sit inside wrappers with `display: contents`, whose
 * boxes are all zeros and would hide a chip running past the edge.
 */
export const chipsFit = (chips: readonly ChipBox[], limitRight: number): boolean => {
	const drawn = chips.filter((chip) => chip.width > 0);
	if (drawn.length === 0) return true;

	const past = drawn.some((chip) => chip.right > limitRight + 0.5);
	// A chip more than half a line below the first has wrapped.
	const firstTop = Math.min(...drawn.map((chip) => chip.top));
	const wrapped = drawn.some((chip) => chip.top - firstTop > 8);
	return !past && !wrapped;
};

/**
 * A count short enough to sit in a pill.
 *
 * Two digits are the most a pill this size carries without stretching; past
 * that the exact figure is in the tooltip, and "99+" says what matters -- that
 * there are a great many.
 */
export const countLabel = (count: number, max = 99): string => {
	if (!Number.isFinite(count) || count <= 0) return '';
	return count > max ? `${max}+` : String(Math.floor(count));
};

/** Characters a model name may run to before splitting it is worth the trouble. */
const SPLIT_FROM = 16;

/**
 * The shortest and longest ending worth keeping whole.
 *
 * Long enough for `-256k`, `:latest` or `-q4_K_M`; short enough that the front
 * of the name still has room to say which family it is.
 */
const TAIL_MIN = 3;
const TAIL_MAX = 8;

/** Where an identifier breaks into parts. */
const SEPARATORS = new Set(['-', '_', ':', '/', '.', '@']);

/**
 * Cut a model name where the middle can go and the ending must stay.
 *
 * Model identifiers differ at both ends: the family at the front, and the
 * size, quantisation or context length at the back -- `qwen3.8-27b-mtp-256k`,
 * `llama3.1:8b-instruct-q4_K_M`. Cutting the end, as `text-overflow` does,
 * removes exactly the part that tells two of them apart. This keeps the last
 * part whole and lets the front truncate, the way Finder shortens file names.
 *
 * The ending is the longest last part that fits the limit, so a quantisation
 * like `-q4_K_M` survives whole rather than as its last `_K_M`.
 *
 * Only for identifiers. A name with spaces in it is prose, and prose reads
 * better cut at the end.
 */
export const splitModelName = (name: string): { head: string; tail: string } => {
	const text = typeof name === 'string' ? name : '';
	if (text.length < SPLIT_FROM || /\s/.test(text)) return { head: text, tail: '' };

	// Walking backwards, each separator found gives a longer ending than the one
	// before; the last one inside the limit is the one to keep.
	let tail = '';
	for (let index = text.length - TAIL_MIN; index > 0; index--) {
		if (!SEPARATORS.has(text[index])) continue;

		const candidate = text.slice(index);
		if (candidate.length > TAIL_MAX) break;
		tail = candidate;
	}

	return tail ? { head: text.slice(0, text.length - tail.length), tail } : { head: text, tail: '' };
};

/** Bars past which a meter stops reading as a meter and starts reading as a comb. */
const MAX_BARS = 6;

/**
 * A level drawn as bars, for when there is no room to write it.
 *
 * Counted against the model's own levels, so a model offering three reads as
 * three bars and one offering five as five: "two of three" and "two of five"
 * are different amounts of thinking, and a fixed scale would say otherwise.
 * Every level this app knows fits in six, so no two levels ever share a bar
 * count; a model with more is scaled down rather than drawn as a comb.
 */
export const levelMeter = (
	levels: readonly string[] | undefined,
	current: string | null | undefined
): { total: number; filled: number } | null => {
	const steps = (levels ?? []).filter((level) => level !== 'off');
	if (steps.length < 2 || !current || current === 'off') return null;

	const at = steps.indexOf(current);
	if (at === -1) return null;

	if (steps.length <= MAX_BARS) return { total: steps.length, filled: at + 1 };

	return {
		total: MAX_BARS,
		filled: Math.max(1, Math.round(((at + 1) / steps.length) * MAX_BARS))
	};
};
