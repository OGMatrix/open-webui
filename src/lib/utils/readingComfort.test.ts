import { describe, expect, it } from 'vitest';
import {
	DEFAULT_READING_WIDTH,
	READING_WIDTHS,
	charactersPerLine,
	isComfortableMeasure,
	normalizeReadingWidth
} from './readingComfort';

describe('working out the measure of a column', () => {
	it('reproduces the column that was measured in the browser', () => {
		// The calibration point: the answer column rendered 122 characters in
		// 900 pixels at a 15-pixel font. If this drifts, the constants are wrong
		// rather than the browser.
		expect(charactersPerLine(58)).toBe(122);
	});

	it('puts the default inside what research calls comfortable', () => {
		const measure = charactersPerLine(READING_WIDTHS[DEFAULT_READING_WIDTH]);
		expect(measure).toBeLessThanOrEqual(90);
		expect(measure).toBeGreaterThanOrEqual(45);
	});

	it('puts the narrow option near the middle of that range', () => {
		expect(charactersPerLine(READING_WIDTHS.narrow)).toBeGreaterThanOrEqual(60);
		expect(charactersPerLine(READING_WIDTHS.narrow)).toBeLessThanOrEqual(75);
	});

	it('leaves the widest option where the column already was', () => {
		// Someone who prefers the old width should get exactly it back.
		expect(READING_WIDTHS.wide).toBe(58);
	});

	it('gets narrower as the column does', () => {
		expect(charactersPerLine(34)).toBeLessThan(charactersPerLine(42));
		expect(charactersPerLine(42)).toBeLessThan(charactersPerLine(58));
	});

	it('has no measure for a column with no room in it', () => {
		expect(charactersPerLine(0)).toBe(0);
		expect(charactersPerLine(1)).toBe(0);
	});
});

describe('judging a measure', () => {
	it('accepts the range reading research settles on', () => {
		expect(isComfortableMeasure(45)).toBe(true);
		expect(isComfortableMeasure(66)).toBe(true);
		expect(isComfortableMeasure(90)).toBe(true);
	});

	it('rejects a line too long to sweep back from', () => {
		// The failure this exists for: at 122 characters the eye regularly
		// misses the start of the next line, which is what makes a long answer
		// tiring however good its colours are.
		expect(isComfortableMeasure(122)).toBe(false);
	});

	it('rejects a line too short to carry a thought', () => {
		expect(isComfortableMeasure(30)).toBe(false);
	});
});

describe('reading the stored setting', () => {
	it('accepts the widths it knows', () => {
		expect(normalizeReadingWidth('narrow')).toBe('narrow');
		expect(normalizeReadingWidth('wide')).toBe('wide');
	});

	it('falls back for anything else', () => {
		// Settings arrive from storage written by an older version, or by hand.
		expect(normalizeReadingWidth('enormous')).toBe(DEFAULT_READING_WIDTH);
		expect(normalizeReadingWidth(undefined)).toBe(DEFAULT_READING_WIDTH);
		expect(normalizeReadingWidth(42)).toBe(DEFAULT_READING_WIDTH);
		expect(normalizeReadingWidth(null)).toBe(DEFAULT_READING_WIDTH);
	});

	it('does not accept an inherited property as a width', () => {
		expect(normalizeReadingWidth('toString')).toBe(DEFAULT_READING_WIDTH);
	});
});
