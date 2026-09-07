/**
 * How wide a column of prose should be, and what that means in characters.
 *
 * Typography research is unusually settled here: a line of 50 to 75 characters
 * reads comfortably, 90 is the outer edge, and past that the return sweep --
 * the jump from the end of one line to the start of the next -- starts to miss.
 * Measured against the shipped stylesheet, an answer column was running at 122
 * characters, which is why a long one is tiring to read however good the
 * colours are.
 *
 * The number shown to the reader is computed rather than guessed, so a width
 * can be chosen by what it does rather than by what it is called.
 */

/**
 * Average advance of a character as a fraction of the font size.
 *
 * Measured, not assumed: the answer column rendered 122 characters in 900
 * pixels at a 15-pixel font, which is 7.38 pixels a character, or 0.49em. That
 * is also the classic rule of thumb for proportional text, which is reassuring
 * but not why it is here.
 */
const AVERAGE_CHARACTER_EM = 0.49;

/** The body size of rendered markdown, in pixels. */
const BODY_FONT_PX = 15;

/** `px-3.5` on both sides of the column. */
const COLUMN_PADDING_PX = 28;

/** Root font size the rem values are against. */
const ROOT_PX = 16;

export type ReadingWidth = 'narrow' | 'comfortable' | 'wide';

/**
 * The widths on offer, in rem.
 *
 * `wide` is what the column was before any of this: it stays, because someone
 * who prefers it should not have to argue with a research paper about it.
 */
export const READING_WIDTHS: Record<ReadingWidth, number> = {
	narrow: 34,
	comfortable: 42,
	wide: 58
};

export const DEFAULT_READING_WIDTH: ReadingWidth = 'comfortable';

/**
 * Roughly how many characters fit on a line at a given column width.
 *
 * Independent of the interface scale: the column is measured in rem and the
 * text scales with the same root, so both grow together and the count does not
 * move.
 */
export const charactersPerLine = (widthRem: number): number => {
	const content = widthRem * ROOT_PX - COLUMN_PADDING_PX;
	if (!(content > 0)) return 0;
	return Math.round(content / (BODY_FONT_PX * AVERAGE_CHARACTER_EM));
};

/** Whether a measure falls in the range reading research calls comfortable. */
export const isComfortableMeasure = (characters: number): boolean =>
	characters >= 45 && characters <= 90;

/** A stored setting turned into a width this app knows, or the default. */
export const normalizeReadingWidth = (value: unknown): ReadingWidth =>
	// `hasOwn`, not `in`: `in` walks the prototype, so "toString" would pass as a
	// width and the stylesheet would be handed a function.
	typeof value === 'string' && Object.hasOwn(READING_WIDTHS, value)
		? (value as ReadingWidth)
		: DEFAULT_READING_WIDTH;

/**
 * Put the chosen width where the stylesheet can see it.
 *
 * The same mechanism the interface scale already uses: one custom property on
 * the root, read by every column that holds prose.
 */
export const setReadingWidth = (value: unknown): void => {
	if (typeof document === 'undefined') return;
	const width = READING_WIDTHS[normalizeReadingWidth(value)];
	document.documentElement.style.setProperty('--reading-width', `${width}rem`);
};
