/**
 * The models you actually reach for, kept at the top of the picker.
 *
 * A long list is mostly models you will never choose. What you pick is a
 * handful, and you pick them again — so the picker can put them where your
 * hand already is instead of making you find them each time.
 *
 * "Recent" here means recently *picked*, which is the act this records. Picking
 * is deliberate, and it is the thing you would repeat; it is not the same as
 * "the model that answered last", which a chat can set for you without you
 * having chosen anything.
 */

/** How many to remember. Beyond a handful it stops being a shortcut. */
export const RECENT_LIMIT = 5;

/**
 * One entry is not a history.
 *
 * Straight after a first pick the list holds exactly the model already
 * selected, and heading that with "Recent" says nothing the row below the
 * cursor does not. Same rule the family headings use: a run of one is a
 * coincidence, not a group.
 */
export const MIN_RECENT = 2;

/** Adds a pick to the front, dropping any earlier mention of it. */
export const rememberModel = (
	recent: readonly string[],
	id: string | null | undefined,
	limit: number = RECENT_LIMIT
): string[] => {
	const value = (id ?? '').trim();
	if (!value) {
		return [...recent];
	}
	return [value, ...recent.filter((entry) => entry !== value)].slice(0, Math.max(0, limit));
};

export type Promoted<T> = {
	/** The same items, recent ones first. */
	items: T[];
	/** How many of the leading items are the recent ones. */
	count: number;
};

/**
 * Moves the recently picked models to the front, newest first.
 *
 * Moved rather than copied. A model listed twice would have to be reasoned
 * about twice — by the keyboard cursor, by the virtual window, by the family
 * headings — and every one of those counts rows. One row per model keeps all
 * of that arithmetic honest.
 *
 * Everything else keeps the order it arrived in, so the promotion is the only
 * change and it is one the reader asked for.
 */
export const promoteRecent = <T>(
	items: readonly T[],
	idOf: (item: T) => string,
	recent: readonly string[],
	minimum: number = MIN_RECENT
): Promoted<T> => {
	const wanted = recent.filter(Boolean);
	if (wanted.length === 0) {
		return { items: [...items], count: 0 };
	}

	const byId = new Map<string, T>();
	for (const item of items) {
		const id = idOf(item);
		// First wins, matching the list's own order for a duplicated id.
		if (id && !byId.has(id)) byId.set(id, item);
	}

	const promoted: T[] = [];
	const taken = new Set<string>();
	for (const id of wanted) {
		const item = byId.get(id);
		if (item !== undefined && !taken.has(id)) {
			promoted.push(item);
			taken.add(id);
		}
	}

	// Too few to be worth a heading: leave the list exactly as it was.
	if (promoted.length < minimum) {
		return { items: [...items], count: 0 };
	}

	const rest = items.filter((item) => !taken.has(idOf(item)));
	return { items: [...promoted, ...rest], count: promoted.length };
};
