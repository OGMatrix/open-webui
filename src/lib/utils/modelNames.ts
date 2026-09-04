/**
 * Tells apart model names that are mostly the same.
 *
 * A list like qwen3.8-27b-32k / -64k / -128k / -256k is nine tenths identical,
 * and the part that actually picks one model over another sits at the end where
 * the eye arrives last. Working out what a name shares with its neighbours lets
 * the shared part be pushed back so the difference is what stands out.
 *
 * The comparison is per name rather than across the whole list, because a real
 * list holds several families at once. qwen3.8-27b-256k should have
 * "qwen3.8-27b-" played down against its four siblings while a lone
 * nemotron-3-nano stays whole, and a rule applied to the list as a whole cannot
 * do both.
 */

/** Where one part of a name ends and the next begins. */
const SEPARATORS = /[-_.\s/:]/;

/** Splits a name into segments, keeping the separators as their own pieces. */
export const splitName = (name: string): string[] => {
	const parts: string[] = [];
	let current = '';
	for (const character of name ?? '') {
		if (SEPARATORS.test(character)) {
			if (current) parts.push(current);
			parts.push(character);
			current = '';
		} else {
			current += character;
		}
	}
	if (current) parts.push(current);
	return parts;
};

export type NameParts = {
	/** Opening this name shares with a neighbour, shown muted. */
	head: string;
	/** What makes this name different, shown at full strength. */
	body: string;
	/** Ending this name shares with a neighbour, shown muted. */
	tail: string;
};

/** How many leading segments two names have in common. */
const commonHead = (a: string[], b: string[]) => {
	let count = 0;
	while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
	return count;
};

/** How many trailing segments two names have in common. */
const commonTail = (a: string[], b: string[]) => {
	let count = 0;
	while (
		count < a.length &&
		count < b.length &&
		a[a.length - 1 - count] === b[b.length - 1 - count]
	) {
		count += 1;
	}
	return count;
};

/**
 * Splits every name into the part it shares with its closest neighbour and the
 * part that distinguishes it.
 *
 * Counted in whole segments, never characters: cutting "qwen3.8-27b" in the
 * middle of a number reads as a rendering fault rather than as emphasis. A name
 * always keeps a body, so a row can never come out blank.
 */
export const emphasizeNames = (names: string[]): NameParts[] => {
	const segmented = names.map((name) => splitName(name ?? ''));

	return names.map((name, index) => {
		const own = segmented[index];
		if (own.length === 0) {
			return { head: '', body: name ?? '', tail: '' };
		}

		let head = 0;
		let tail = 0;
		for (let other = 0; other < segmented.length; other += 1) {
			if (other === index || segmented[other].length === 0) continue;
			const shared = commonHead(own, segmented[other]);
			head = Math.max(head, shared);
			// A shared ending only counts between names of the same family. Two
			// unrelated models both ending in "-32k" say nothing about each other,
			// and dimming that would tie names together that have no relation.
			if (shared > 0) {
				tail = Math.max(tail, commonTail(own, segmented[other]));
			}
		}

		// A separator alone says nothing; dim it only with the word it belongs to.
		while (head > 0 && SEPARATORS.test(own[head - 1]) && own[head - 1].length === 1 && head === 1) {
			head -= 1;
		}

		// Whatever is left has to stay visible, and the head wins the tie.
		if (head >= own.length) head = own.length - 1;
		if (head + tail >= own.length) tail = own.length - head - 1;
		if (tail < 0) tail = 0;

		const end = own.length - tail;
		return {
			head: own.slice(0, head).join(''),
			body: own.slice(head, end).join(''),
			tail: own.slice(end).join('')
		};
	});
};
