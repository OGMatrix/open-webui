/**
 * Turning what a tool was asked and what it answered into something readable.
 *
 * Both arrive as JSON, and both were shown as JSON: arguments stringified onto
 * one line, results pretty-printed into a monospace block. That is the data,
 * but it is not the answer to what anyone is looking at the row to find out —
 * which is what the tool was asked to do, and whether what came back is any
 * good. Reading braces to work that out is work the interface can do instead.
 *
 * Nothing here formats anything. It describes shape, and the component draws
 * it; keeping the two apart is what makes the hard part — deciding what a value
 * *is* — something that can be tested without a browser.
 */

/** A value from a tool call, described by what it is rather than how it prints. */
export type ToolValue =
	| { kind: 'empty' }
	| { kind: 'text'; value: string; truncated: boolean }
	| { kind: 'number'; value: string }
	| { kind: 'boolean'; value: boolean }
	| { kind: 'list'; items: ToolValue[]; hidden: number }
	| { kind: 'record'; entries: { key: string; value: ToolValue }[]; hidden: number };

/**
 * Where description stops.
 *
 * A tool result can be a page of search hits or a whole document. These bound
 * what is built, not just what is shown: walking a deeply nested megabyte to
 * then draw three lines of it is work nobody asked for, on every re-render of
 * a streaming message.
 */
export const MAX_DEPTH = 4;
export const MAX_ITEMS = 20;
export const MAX_ENTRIES = 24;
export const MAX_TEXT = 400;

const describeText = (value: string): ToolValue => {
	const trimmed = value.trim();
	if (!trimmed) {
		return { kind: 'empty' };
	}
	return trimmed.length > MAX_TEXT
		? { kind: 'text', value: trimmed.slice(0, MAX_TEXT), truncated: true }
		: { kind: 'text', value: trimmed, truncated: false };
};

/** What a value is, to whatever depth is worth describing. */
export const describeValue = (value: unknown, depth = 0): ToolValue => {
	if (value === null || value === undefined) {
		return { kind: 'empty' };
	}

	if (typeof value === 'string') {
		return describeText(value);
	}

	if (typeof value === 'number') {
		// Not a number a person would read as one: say so rather than printing
		// NaN, which reads as a value.
		return Number.isFinite(value) ? { kind: 'number', value: String(value) } : { kind: 'empty' };
	}

	if (typeof value === 'boolean') {
		return { kind: 'boolean', value };
	}

	// Past the depth, or something with no useful shape: show it as text rather
	// than pretending to have understood it.
	if (depth >= MAX_DEPTH) {
		return describeText(safeStringify(value));
	}

	if (Array.isArray(value)) {
		const shown = value.slice(0, MAX_ITEMS);
		return {
			kind: 'list',
			items: shown.map((item) => describeValue(item, depth + 1)),
			hidden: Math.max(0, value.length - shown.length)
		};
	}

	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>);
		const shown = entries.slice(0, MAX_ENTRIES);
		return {
			kind: 'record',
			entries: shown.map(([key, item]) => ({ key, value: describeValue(item, depth + 1) })),
			hidden: Math.max(0, entries.length - shown.length)
		};
	}

	return describeText(safeStringify(value));
};

/** JSON that cannot throw, for the values JSON.stringify refuses. */
export const safeStringify = (value: unknown): string => {
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		// Circular, or a BigInt. Neither is worth an exception in a chat row.
		return String(value);
	}
};

/** How a value reads on one line, for the collapsed row. */
const inline = (value: ToolValue): string => {
	switch (value.kind) {
		case 'empty':
			return '';
		case 'text':
			return value.value.replace(/\s+/g, ' ') + (value.truncated ? '…' : '');
		case 'number':
			return value.value;
		case 'boolean':
			return value.value ? 'true' : 'false';
		case 'list': {
			const parts = value.items.map(inline).filter(Boolean);
			return parts.length ? `[${parts.join(', ')}]` : '[]';
		}
		case 'record': {
			const parts = value.entries.map((entry) => `${entry.key}: ${inline(entry.value)}`);
			return parts.length ? `{${parts.join(', ')}}` : '{}';
		}
	}
};

/** How long a summary may be before it stops being one. */
export const SUMMARY_LIMIT = 88;

/**
 * One line saying what the tool was asked to do.
 *
 * A single argument is quoted alone — `search_web` with one query does not need
 * the word "query" repeated back. Several are named, because then the names are
 * what tells them apart.
 *
 * Deliberately not a guess at which argument matters most: a list of favoured
 * key names would be right for the tools someone thought of and quietly wrong
 * for everything else, and being wrong here is worse than being plain.
 */
export const summariseArguments = (
	args: Record<string, unknown> | null | undefined,
	limit = SUMMARY_LIMIT
): string => {
	if (!args || typeof args !== 'object' || Array.isArray(args)) {
		return '';
	}

	const entries = Object.entries(args).filter(([, value]) => describeValue(value).kind !== 'empty');
	if (entries.length === 0) {
		return '';
	}

	const text =
		entries.length === 1
			? inline(describeValue(entries[0][1]))
			: entries.map(([key, value]) => `${key}: ${inline(describeValue(value))}`).join(', ');

	const collapsed = text.replace(/\s+/g, ' ').trim();
	return collapsed.length > limit ? `${collapsed.slice(0, limit - 1).trimEnd()}…` : collapsed;
};

/**
 * A stable colour for a tool, so a run of calls can be told apart at a glance.
 *
 * Derived from the name rather than assigned, so the same tool is the same
 * colour in every chat and on every machine, and a tool nobody has seen before
 * still gets one. Only the hue moves; saturation and lightness stay where the
 * theme can carry them.
 */
export const toolHue = (name: string): number => {
	let hash = 0;
	for (let index = 0; index < (name ?? '').length; index += 1) {
		hash = (hash * 31 + name.charCodeAt(index)) % 360000;
	}
	return hash % 360;
};

/** The letter to put in the dot, when there is no icon for a tool. */
export const toolInitial = (name: string): string => {
	const match = /[a-z0-9]/i.exec(name ?? '');
	return match ? match[0].toUpperCase() : '?';
};
