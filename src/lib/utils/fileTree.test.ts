import { describe, expect, it } from 'vitest';
import {
	baseName,
	countChanges,
	diffListing,
	formatSize,
	joinPath,
	looksTextual,
	parentPath,
	separatorOf,
	sortEntries,
	type FileEntry
} from './fileTree';

const file = (name: string, size: number | null = null): FileEntry => ({ name, type: 'file', size });
const dir = (name: string): FileEntry => ({ name, type: 'directory', size: null });

describe('reading a path the way its own machine writes it', () => {
	it('uses a forward slash for a posix path', () => {
		expect(separatorOf('/srv/app')).toBe('/');
	});

	it('uses a backslash for a windows path', () => {
		expect(separatorOf('C:\\Users\\lukiw')).toBe('\\');
	});

	it('recognises a drive letter before any separator appears', () => {
		expect(separatorOf('C:')).toBe('\\');
	});

	it('recognises a UNC path', () => {
		expect(separatorOf('\\\\server\\share')).toBe('\\');
	});

	it('defaults to a forward slash when there is nothing to go on', () => {
		expect(separatorOf('')).toBe('/');
		expect(separatorOf('name')).toBe('/');
	});
});

describe('joining a name onto a directory', () => {
	it('joins a posix path', () => {
		expect(joinPath('/srv/app', 'main.py')).toBe('/srv/app/main.py');
	});

	it('joins a windows path with a backslash', () => {
		// The failure this exists for: a path built with the wrong slash is a
		// path the server on the other end refuses.
		expect(joinPath('C:\\Users', 'lukiw')).toBe('C:\\Users\\lukiw');
	});

	it('does not double a separator the directory already ends with', () => {
		expect(joinPath('/srv/app/', 'main.py')).toBe('/srv/app/main.py');
	});

	it('joins onto the root itself', () => {
		expect(joinPath('/', 'etc')).toBe('/etc');
	});

	it('returns the name when there is no directory', () => {
		expect(joinPath('', 'main.py')).toBe('main.py');
	});
});

describe('walking back up', () => {
	it('finds the parent of a posix path', () => {
		expect(parentPath('/srv/app/main.py')).toBe('/srv/app');
	});

	it('finds the parent of a windows path', () => {
		expect(parentPath('C:\\Users\\lukiw\\notes.md')).toBe('C:\\Users\\lukiw');
	});

	it('stops at the posix root', () => {
		expect(parentPath('/srv')).toBe('/');
		expect(parentPath('/')).toBeNull();
	});

	it('has no parent for a bare name', () => {
		expect(parentPath('main.py')).toBeNull();
	});

	it('ignores a trailing separator', () => {
		expect(parentPath('/srv/app/')).toBe('/srv');
	});

	it('names the last segment', () => {
		expect(baseName('/srv/app/main.py')).toBe('main.py');
		expect(baseName('C:\\Users\\lukiw')).toBe('lukiw');
		expect(baseName('/srv/app/')).toBe('app');
	});
});

describe('ordering a listing', () => {
	it('puts directories first', () => {
		const sorted = sortEntries([file('a.txt'), dir('z-folder')]);
		expect(sorted.map((entry) => entry.name)).toEqual(['z-folder', 'a.txt']);
	});

	it('ignores case', () => {
		const sorted = sortEntries([file('Zebra.txt'), file('apple.txt')]);
		expect(sorted.map((entry) => entry.name)).toEqual(['apple.txt', 'Zebra.txt']);
	});

	it('compares numbers as numbers', () => {
		// The failure this exists for: file10 sorting before file9, which is
		// what a plain string compare does and what nobody expects to read.
		const sorted = sortEntries([file('file10.log'), file('file9.log')]);
		expect(sorted.map((entry) => entry.name)).toEqual(['file9.log', 'file10.log']);
	});

	it('does not disturb the array it was given', () => {
		const entries = [file('b'), file('a')];
		sortEntries(entries);
		expect(entries.map((entry) => entry.name)).toEqual(['b', 'a']);
	});
});

describe('seeing what changed', () => {
	const before = [dir('src'), file('README.md', 100), file('old.log', 5)];

	it('marks nothing on a first look', () => {
		// Everything would be "added", which tells the reader nothing.
		const diffed = diffListing(null, before);
		expect(diffed.every((entry) => entry.change === null)).toBe(true);
	});

	it('marks a file that appeared', () => {
		const diffed = diffListing(before, [...before, file('new.txt', 1)]);
		expect(diffed.find((entry) => entry.name === 'new.txt')?.change).toBe('added');
	});

	it('keeps a file that went away, and says so', () => {
		// The point of looking twice is to see it go; dropping the row would
		// make a deletion indistinguishable from never having been there.
		const diffed = diffListing(before, [dir('src'), file('README.md', 100)]);
		expect(diffed.find((entry) => entry.name === 'old.log')?.change).toBe('removed');
	});

	it('marks a file whose size moved', () => {
		const diffed = diffListing(before, [dir('src'), file('README.md', 250), file('old.log', 5)]);
		expect(diffed.find((entry) => entry.name === 'README.md')?.change).toBe('modified');
	});

	it('marks a name that changed from a file to a directory', () => {
		const diffed = diffListing([file('build', 10)], [dir('build')]);
		expect(diffed[0].change).toBe('modified');
	});

	it('does not call everything modified when the server reports no sizes', () => {
		// The failure this exists for: list_directory gives no sizes at all, so
		// comparing null against null would light up every row on every refresh.
		const withoutSizes = [file('a.txt'), file('b.txt')];
		const diffed = diffListing(withoutSizes, [file('a.txt'), file('b.txt')]);
		expect(diffed.every((entry) => entry.change === null)).toBe(true);
	});

	it('does not call a file modified when only one reading knew its size', () => {
		const diffed = diffListing([file('a.txt', null)], [file('a.txt', 12)]);
		expect(diffed[0].change).toBeNull();
	});

	it('leaves an unchanged file unmarked', () => {
		const diffed = diffListing(before, before);
		expect(diffed.every((entry) => entry.change === null)).toBe(true);
	});

	it('counts what changed', () => {
		const diffed = diffListing(before, [dir('src'), file('README.md', 250), file('new.txt', 1)]);
		// README grew, new.txt appeared, old.log went away.
		expect(countChanges(diffed)).toBe(3);
	});

	it('still puts directories first after a diff', () => {
		const diffed = diffListing(before, [file('a.txt', 1), dir('src')]);
		expect(diffed[0].type).toBe('directory');
	});
});

describe('writing a size a person can read', () => {
	it('leaves small sizes in bytes', () => {
		expect(formatSize(512)).toBe('512 B');
	});

	it('moves up a unit at a kilobyte', () => {
		expect(formatSize(1536)).toBe('1.5 KB');
	});

	it('drops the decimal once the number is big enough not to need it', () => {
		expect(formatSize(15 * 1024)).toBe('15 KB');
	});

	it('keeps going up', () => {
		expect(formatSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
	});

	it('says nothing when the server did not', () => {
		expect(formatSize(null)).toBe('');
		expect(formatSize(undefined)).toBe('');
	});

	it('says nothing for a nonsense size', () => {
		expect(formatSize(-1)).toBe('');
		expect(formatSize(Number.NaN)).toBe('');
	});
});

describe('guessing what can be previewed', () => {
	it('recognises common source and text files', () => {
		for (const name of ['notes.md', 'main.py', 'App.svelte', 'config.yaml', 'data.csv']) {
			expect(looksTextual(name)).toBe(true);
		}
	});

	it('recognises files that have no extension at all', () => {
		expect(looksTextual('Dockerfile')).toBe(true);
		expect(looksTextual('LICENSE')).toBe(true);
		expect(looksTextual('.gitignore')).toBe(true);
	});

	it('does not offer to preview a binary', () => {
		for (const name of ['photo.png', 'archive.zip', 'app.exe', 'clip.mp4']) {
			expect(looksTextual(name)).toBe(false);
		}
	});
});
