import { describe, expect, it } from 'vitest';
import { localeDecimalSeparator, readNumericColumn, sortRowOrder } from './markdownTable';

const values = (cells: string[], locale = 'en-US') =>
	readNumericColumn(cells, locale)?.values ?? null;

describe('readNumericColumn', () => {
	it('reads plain integers', () => {
		expect(values(['1', '20', '300'])).toEqual([1, 20, 300]);
	});

	it('reads a column written the English way', () => {
		expect(values(['1,234.50', '87.25', '1,000,000'])).toEqual([1234.5, 87.25, 1000000]);
	});

	it('reads a column written the German way', () => {
		expect(values(['1.234,50', '87,25', '1.000.000'])).toEqual([1234.5, 87.25, 1000000]);
	});

	it('lets a mixed-separator cell settle the whole column', () => {
		// "1.234" alone is ambiguous; "9.876,50" in the same column is not.
		expect(values(['1.234', '9.876,50'])).toEqual([1234, 9876.5]);
	});

	it('treats a repeated separator as grouping', () => {
		expect(values(['1.234.567', '890'])).toEqual([1234567, 890]);
	});

	it('falls back to the locale when the column stays ambiguous', () => {
		expect(values(['1.234', '5.678'], 'en-US')).toEqual([1.234, 5.678]);
		expect(values(['1.234', '5.678'], 'de-DE')).toEqual([1234, 5678]);
	});

	it('does not mistake a leading decimal for grouping', () => {
		expect(values(['0.500', '0.250'])).toEqual([0.5, 0.25]);
	});

	it('sees through currency, percent and signs', () => {
		expect(values(['€ 12,50', '-3,10', '+0,90'], 'de-DE')).toEqual([12.5, -3.1, 0.9]);
		expect(values(['42%', '7%', '100%'])).toEqual([42, 7, 100]);
		expect(values(['$1,234.56', '$0.99'])).toEqual([1234.56, 0.99]);
	});

	it('handles the space and apostrophe group separators', () => {
		expect(values(['1 234,56', '99,00'], 'fr-FR')).toEqual([1234.56, 99]);
		expect(values(["1'234.50", '99.00'], 'de-CH')).toEqual([1234.5, 99]);
	});

	it('keeps empty cells as gaps rather than zeros', () => {
		expect(values(['5', '', '7'])).toEqual([5, null, 7]);
	});

	it('rejects a column with any non-numeric cell', () => {
		expect(readNumericColumn(['1', '2', 'n/a'])).toBeNull();
		expect(readNumericColumn(['1', '2', '3 Stück'])).toBeNull();
		expect(readNumericColumn(['2024-01-05', '2024-02-06'])).toBeNull();
	});

	it('rejects a column that is entirely empty', () => {
		expect(readNumericColumn(['', '', ''])).toBeNull();
	});

	it('rejects decoration on its own', () => {
		expect(readNumericColumn(['%', '€'])).toBeNull();
	});
});

describe('localeDecimalSeparator', () => {
	it('reads the separator out of Intl rather than a hardcoded list', () => {
		expect(localeDecimalSeparator('en-US')).toBe('.');
		expect(localeDecimalSeparator('de-DE')).toBe(',');
		expect(localeDecimalSeparator('fr-FR')).toBe(',');
		expect(localeDecimalSeparator('ja-JP')).toBe('.');
	});

	it('survives a nonsense locale', () => {
		expect(localeDecimalSeparator('not a locale')).toBe('.');
	});
});

describe('sortRowOrder', () => {
	it('sorts numbers by value, not by their spelling', () => {
		// As text, "87" would come after "1.234".
		const cells = ['1.234', '87', '9'];
		expect(sortRowOrder(cells, 'asc', 'de-DE')).toEqual([2, 1, 0]);
		expect(sortRowOrder(cells, 'desc', 'de-DE')).toEqual([0, 1, 2]);
	});

	it('sorts text with the reader locale', () => {
		// Ä sorts next to A in German, and the collator is what decides that.
		const order = sortRowOrder(['Zebra', 'Äpfel', 'Banane'], 'asc', 'de-DE');
		expect(order).toEqual([1, 2, 0]);
	});

	it('keeps empty cells at the bottom in both directions', () => {
		const cells = ['b', '', 'a'];
		expect(sortRowOrder(cells, 'asc')).toEqual([2, 0, 1]);
		expect(sortRowOrder(cells, 'desc')).toEqual([0, 2, 1]);
	});

	it('is stable for equal keys', () => {
		expect(sortRowOrder(['a', 'a', 'a'], 'asc')).toEqual([0, 1, 2]);
		expect(sortRowOrder(['a', 'a', 'a'], 'desc')).toEqual([0, 1, 2]);
	});

	it('ignores case when comparing text', () => {
		expect(sortRowOrder(['beta', 'Alpha'], 'asc')).toEqual([1, 0]);
	});
});
