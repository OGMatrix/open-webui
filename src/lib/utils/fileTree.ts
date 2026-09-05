/**
 * The parts of a file tree that can be wrong, kept away from the component.
 *
 * Two of them matter. Paths come from whatever machine the server runs on, so
 * joining a name onto a directory has to keep that machine's separator rather
 * than impose one. And a listing is only interesting next to the last one:
 * seeing that a file appeared, grew, or went away is the reason to keep the
 * panel open at all.
 */

export interface FileEntry {
	name: string;
	type: 'file' | 'directory';
	size: number | null;
}

/** How an entry differs from the last time this directory was read. */
export type ChangeKind = 'added' | 'removed' | 'modified' | null;

export interface DiffedEntry extends FileEntry {
	change: ChangeKind;
}

/**
 * The separator a path is written with.
 *
 * Taken from the path itself: the server may be on Windows while the browser
 * is not, and a path built with the wrong slash is a path the server rejects.
 */
export const separatorOf = (path: string): string => {
	if (!path) return '/';
	// A drive letter or a UNC prefix settles it even before any separator.
	if (/^[A-Za-z]:/.test(path) || path.startsWith('\\\\')) return '\\';
	if (path.includes('\\') && !path.includes('/')) return '\\';
	return '/';
};

/** A child of `base`, in the same style `base` was written in. */
export const joinPath = (base: string, name: string): string => {
	if (!base) return name;
	const separator = separatorOf(base);
	const trimmed = base.endsWith(separator) ? base.slice(0, -separator.length) : base;
	// A root is the one case where trimming leaves nothing to join onto.
	return trimmed === '' ? `${separator}${name}` : `${trimmed}${separator}${name}`;
};

/** The directory holding `path`, or null when it is already a root. */
export const parentPath = (path: string): string | null => {
	if (!path) return null;
	const separator = separatorOf(path);
	const trimmed = path.endsWith(separator) && path.length > 1 ? path.slice(0, -1) : path;
	const at = trimmed.lastIndexOf(separator);
	if (at <= 0) {
		// `/a` has the root as its parent; `C:\a` has `C:\`.
		if (separator === '/' && trimmed.startsWith('/') && trimmed.length > 1) return '/';
		return null;
	}
	const parent = trimmed.slice(0, at);
	return parent === '' ? separator : parent;
};

/** The last segment of a path, which is what a tree shows. */
export const baseName = (path: string): string => {
	if (!path) return '';
	const separator = separatorOf(path);
	const trimmed = path.endsWith(separator) && path.length > 1 ? path.slice(0, -1) : path;
	return trimmed.split(separator).pop() || trimmed;
};

/**
 * Directories first, then by name.
 *
 * Case-insensitive, and numbers compared as numbers, so `file10` sorts after
 * `file9` the way a person reading the list expects.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export const sortEntries = <T extends FileEntry>(entries: T[]): T[] =>
	[...(entries ?? [])].sort((a, b) => {
		if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
		return collator.compare(a.name, b.name);
	});

/**
 * What changed between two readings of one directory.
 *
 * Entries that went away are kept in the result and marked, because the point
 * of looking twice is to see them go; a caller that only wants what is there
 * now can filter them out. With no previous reading nothing is marked: on a
 * first look everything would be "added", which says nothing.
 */
export const diffListing = (
	previous: FileEntry[] | null | undefined,
	current: FileEntry[] | null | undefined
): DiffedEntry[] => {
	const now = current ?? [];

	if (!previous) {
		return sortEntries(now.map((entry) => ({ ...entry, change: null as ChangeKind })));
	}

	const before = new Map(previous.map((entry) => [entry.name, entry]));
	const result: DiffedEntry[] = [];

	for (const entry of now) {
		const was = before.get(entry.name);
		let change: ChangeKind = null;

		if (!was) {
			change = 'added';
		} else if (was.type !== entry.type) {
			change = 'modified';
		} else if (
			// A size only counts as a change when both readings knew it; a server
			// that does not report sizes must not make every file look modified.
			typeof was.size === 'number' &&
			typeof entry.size === 'number' &&
			was.size !== entry.size
		) {
			change = 'modified';
		}

		result.push({ ...entry, change });
		before.delete(entry.name);
	}

	for (const gone of before.values()) {
		result.push({ ...gone, change: 'removed' });
	}

	return sortEntries(result);
};

/** How many entries changed, for a summary the reader can act on. */
export const countChanges = (entries: DiffedEntry[]): number =>
	(entries ?? []).filter((entry) => entry.change !== null).length;

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** A size a person can read, or an empty string when the server did not say. */
export const formatSize = (bytes: number | null | undefined): string => {
	if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
	if (bytes < 1024) return `${bytes} B`;

	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
};

/** Whether a name looks like something worth previewing as text. */
const TEXT_LIKE =
	/\.(txt|md|markdown|json|jsonl|ya?ml|toml|ini|cfg|conf|env|csv|tsv|log|sql|sh|bash|zsh|fish|ps1|bat|py|pyi|js|mjs|cjs|jsx|ts|tsx|svelte|vue|html?|css|scss|less|xml|svg|rs|go|java|kt|kts|c|h|cc|cpp|hpp|cs|rb|php|pl|lua|r|jl|swift|dart|scala|clj|ex|exs|erl|hs|ml|f90|tf|dockerfile|gitignore|editorconfig|lock)$/i;

const TEXT_NAMES = new Set([
	'dockerfile',
	'makefile',
	'license',
	'licence',
	'readme',
	'changelog',
	'contributing',
	'codeowners',
	'.gitignore',
	'.dockerignore',
	'.editorconfig',
	'.env'
]);

export const looksTextual = (name: string): boolean => {
	const lower = (name ?? '').toLowerCase();
	return TEXT_NAMES.has(lower) || TEXT_LIKE.test(lower);
};
