import { splitName } from './modelNames';

/**
 * Puts headings into a long model list without moving anything.
 *
 * Grouping by connection is the usual answer, and it is the right one when
 * several providers are configured. It does nothing at all for the common local
 * setup, where one llama.cpp or Ollama endpoint serves every model and the list
 * is one undifferentiated column. What separates those models is the name: a run
 * of qwen3.8-27b-32k / -64k / -128k / -256k is a family, and saying so once at
 * the top of the run is worth more than repeating it on every line.
 *
 * Runs are found in place, so the order the list arrived in is preserved
 * exactly. Reordering would fight the user's own sort and quietly move the model
 * under their cursor.
 */

export type ModelRow<T> =
	| { kind: 'header'; label: string; key: string }
	| { kind: 'model'; item: T; modelIndex: number };

export type GroupedModels<T> = {
	/** Rows to render, headers included, in display order. */
	rows: ModelRow<T>[];
	/** Row position of each model, for scrolling to a keyboard selection. */
	rowIndexOfModel: number[];
};

/** A run shorter than this is not a family, it is a coincidence. */
const MIN_RUN = 2;

/** Leading segments two names share, ignoring a trailing separator. */
const sharedPrefixLength = (a: string[], b: string[]) => {
	let count = 0;
	while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
	// A prefix ending on a separator is the same family as one that does not.
	while (count > 0 && /^[-_.\s/:]$/.test(a[count - 1])) count -= 1;
	return count;
};

/**
 * A block at the head of the list that is a group because it was put there,
 * not because the names happen to agree — the recently picked models.
 */
export type LeadingGroup = { count: number; label: string };

/**
 * Groups adjacent models that share a leading part of their name.
 *
 * `label` decides what a row is called; anything it returns empty is treated as
 * unnamed and never joins a family.
 *
 * `leading` marks off however many items at the front were promoted there by
 * the caller. They are held out of the family search: their names have nothing
 * to do with each other, and letting them join a run would drag an unrelated
 * heading over the top of the list.
 */
export const groupModels = <T>(
	items: T[],
	label: (item: T) => string,
	headerFor: (prefix: string, item: T) => string = (prefix) => prefix,
	leading?: LeadingGroup
): GroupedModels<T> => {
	const names = items.map((item) => label(item) ?? '');
	const segmented = names.map(splitName);

	const rows: ModelRow<T>[] = [];
	const rowIndexOfModel: number[] = [];

	let index = 0;

	const leadingCount = Math.max(0, Math.min(leading?.count ?? 0, items.length));
	if (leadingCount > 0 && leading?.label) {
		rows.push({ kind: 'header', label: leading.label, key: 'header:leading' });
		for (; index < leadingCount; index += 1) {
			rowIndexOfModel[index] = rows.length;
			rows.push({ kind: 'model', item: items[index], modelIndex: index });
		}
	}

	while (index < items.length) {
		// How far the run starting here reaches, and on how much of the name.
		let end = index + 1;
		let prefix = segmented[index].length;

		while (end < items.length) {
			const shared = sharedPrefixLength(segmented[index], segmented[end]);
			if (shared === 0) break;
			prefix = Math.min(prefix, shared);
			end += 1;
		}

		const runLength = end - index;
		if (runLength >= MIN_RUN && prefix > 0 && names[index] !== '') {
			const heading = headerFor(segmented[index].slice(0, prefix).join(''), items[index]);
			if (heading) {
				rows.push({ kind: 'header', label: heading, key: `header:${heading}:${index}` });
			}
		}

		for (let position = index; position < end; position += 1) {
			rowIndexOfModel[position] = rows.length;
			rows.push({ kind: 'model', item: items[position], modelIndex: position });
		}

		index = end;
	}

	return { rows, rowIndexOfModel };
};
