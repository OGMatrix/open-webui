/**
 * Column handling for rendered markdown tables: works out which columns hold
 * numbers, so they can be aligned and sorted the way a reader expects.
 *
 * Numbers in chat come in whatever convention the model or the source used, so
 * a column of "1.234" is either one thousand two hundred thirty-four or barely
 * more than one. Guessing per cell gets that wrong; the separators are decided
 * once per column, from the evidence the whole column provides.
 */

/** Symbols that surround a number without stopping it from being one. */
const DECORATION = /[\s   '’]|^\+|[€$£¥₽₹¢%]|(?:^|\s)(?:EUR|USD|GBP|CHF|JPY)(?=\s|$)/gi;

/** What is left of a number once the decoration is gone. */
const NUMBER_SHAPE = /^-?\d+(?:[.,]\d+)*$/;

export type ColumnNumbers = {
	/** Parsed value per row, in row order; null where the cell was empty. */
	values: (number | null)[];
};

const stripDecoration = (text: string) => text.replace(DECORATION, '').trim();

/**
 * Decides which of `.` and `,` separates the decimals in this column.
 *
 * A value carrying both settles it outright — the last one is the decimal
 * point. Failing that, a separator repeated inside one value is grouping, and a
 * lone one with anything other than three digits behind it is a decimal point.
 *
 * A lone separator with exactly three digits behind it proves nothing: "1.234"
 * is the ambiguous case itself, not evidence about it. Columns that offer only
 * that fall back to the reader's locale.
 */
const findDecimalSeparator = (cleaned: string[], locale: string): '.' | ',' => {
	let groupingDot = 0;
	let groupingComma = 0;
	let decimalDot = 0;
	let decimalComma = 0;

	for (const value of cleaned) {
		const dots = (value.match(/\./g) ?? []).length;
		const commas = (value.match(/,/g) ?? []).length;

		if (dots && commas) {
			// Mixed: whichever comes last is the decimal point.
			return value.lastIndexOf('.') > value.lastIndexOf(',') ? '.' : ',';
		}

		if (dots > 1) groupingDot += 1;
		if (commas > 1) groupingComma += 1;

		// Three digits behind a lone separator is the ambiguous shape; it casts no
		// vote either way. Any other count can only be a decimal point.
		if (dots === 1 && !/^\d+\.\d{3}$/.test(value)) decimalDot += 1;
		if (commas === 1 && !/^\d+,\d{3}$/.test(value)) decimalComma += 1;
	}

	if (decimalComma && !decimalDot) return ',';
	if (decimalDot && !decimalComma) return '.';
	// Grouping evidence: a separator repeated inside one value can only be that.
	if (groupingDot && !groupingComma) return ',';
	if (groupingComma && !groupingDot) return '.';

	// Still ambiguous, e.g. a column of nothing but "1.234". The reader's own
	// convention is the last piece of evidence available.
	return localeDecimalSeparator(locale);
};

/** The decimal separator the given locale writes, via Intl rather than a list. */
export const localeDecimalSeparator = (locale: string): '.' | ',' => {
	try {
		const parts = new Intl.NumberFormat(locale).formatToParts(1.1);
		return parts.find((part) => part.type === 'decimal')?.value === ',' ? ',' : '.';
	} catch {
		return '.';
	}
};

const toNumber = (cleaned: string, decimal: '.' | ','): number | null => {
	const group = decimal === '.' ? ',' : '.';
	const normalized = cleaned.split(group).join('').replace(decimal, '.');
	const value = Number(normalized);
	return Number.isFinite(value) ? value : null;
};

/**
 * Reads a column as numbers, or reports that it is not one.
 *
 * Every non-empty cell has to look like a number: one stray label means the
 * column is mixed, and mixed columns read better left-aligned and sorted as
 * text.
 */
export const readNumericColumn = (cells: string[], locale = 'en-US'): ColumnNumbers | null => {
	const cleaned: string[] = [];
	let seen = 0;

	for (const cell of cells) {
		const text = (cell ?? '').trim();
		if (text === '') {
			cleaned.push('');
			continue;
		}
		const bare = stripDecoration(text);
		if (bare === '' || !NUMBER_SHAPE.test(bare)) {
			return null;
		}
		cleaned.push(bare);
		seen += 1;
	}

	if (seen === 0) {
		return null;
	}

	const decimal = findDecimalSeparator(
		cleaned.filter((value) => value !== ''),
		locale
	);

	const values: (number | null)[] = [];
	for (const value of cleaned) {
		if (value === '') {
			values.push(null);
			continue;
		}
		const parsed = toNumber(value, decimal);
		if (parsed === null) {
			// Shaped like a number but not readable as one; treat the column as text.
			return null;
		}
		values.push(parsed);
	}

	return { values };
};

export type SortDirection = 'asc' | 'desc';

/**
 * Row order for one column. Empty cells sink to the bottom in both directions,
 * so a sort never hides the rows that have data.
 */
export const sortRowOrder = (
	cells: string[],
	direction: SortDirection,
	locale = 'en-US',
	numeric: ColumnNumbers | null = readNumericColumn(cells, locale)
): number[] => {
	const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
	const sign = direction === 'asc' ? 1 : -1;

	return cells
		.map((_, index) => index)
		.sort((left, right) => {
			const leftText = (cells[left] ?? '').trim();
			const rightText = (cells[right] ?? '').trim();

			if (leftText === '' || rightText === '') {
				if (leftText === '' && rightText === '') return left - right;
				return leftText === '' ? 1 : -1;
			}

			if (numeric) {
				const a = numeric.values[left];
				const b = numeric.values[right];
				if (a !== null && b !== null && a !== b) return (a - b) * sign;
			} else {
				const compared = collator.compare(leftText, rightText);
				if (compared !== 0) return compared * sign;
			}

			// Equal keys keep the order the table was written in.
			return left - right;
		});
};
