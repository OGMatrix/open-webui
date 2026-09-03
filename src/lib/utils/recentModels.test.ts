import { describe, expect, it } from 'vitest';
import { promoteRecent, rememberModel } from './recentModels';

describe('remembering a pick', () => {
	it('puts the newest first', () => {
		expect(rememberModel(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
	});

	it('moves a repeat rather than listing it twice', () => {
		expect(rememberModel(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
	});

	it('keeps only as many as asked for', () => {
		expect(rememberModel(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
		expect(rememberModel(['a'], 'b', 0)).toEqual([]);
	});

	it('ignores a pick with no id', () => {
		expect(rememberModel(['a'], '')).toEqual(['a']);
		expect(rememberModel(['a'], '   ')).toEqual(['a']);
		expect(rememberModel(['a'], null)).toEqual(['a']);
	});

	it('does not modify the list it was given', () => {
		const before = ['a', 'b'];
		rememberModel(before, 'c');
		expect(before).toEqual(['a', 'b']);
	});
});

describe('promoting the recent ones', () => {
	const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
	const idOf = (item: { id: string }) => item.id;
	const ids = (items: { id: string }[]) => items.map(idOf);

	it('moves them to the front, newest first', () => {
		const result = promoteRecent(list, idOf, ['c', 'a']);
		expect(ids(result.items)).toEqual(['c', 'a', 'b', 'd']);
		expect(result.count).toBe(2);
	});

	it('leaves everything else in the order it arrived', () => {
		const result = promoteRecent(list, idOf, ['d', 'b']);
		expect(ids(result.items)).toEqual(['d', 'b', 'a', 'c']);
	});

	it('moves rather than copies, so nothing appears twice', () => {
		// Every row is counted - by the keyboard cursor, by the virtual window,
		// by the headings. A model listed twice would break all three.
		const result = promoteRecent(list, idOf, ['b']);
		expect(result.items).toHaveLength(list.length);
	});

	it('skips models that are no longer in the list', () => {
		const result = promoteRecent(list, idOf, ['gone', 'c', 'a']);
		expect(ids(result.items)).toEqual(['c', 'a', 'b', 'd']);
		expect(result.count).toBe(2);
	});

	it('does nothing when one entry is all there is', () => {
		// Straight after a first pick that entry is the model already selected,
		// and heading it "Recent" says nothing.
		const result = promoteRecent(list, idOf, ['b']);
		expect(ids(result.items)).toEqual(['a', 'b', 'c', 'd']);
		expect(result.count).toBe(0);
	});

	it('respects a caller that wants a different minimum', () => {
		const result = promoteRecent(list, idOf, ['b'], 1);
		expect(ids(result.items)).toEqual(['b', 'a', 'c', 'd']);
		expect(result.count).toBe(1);
	});

	it('does nothing when nothing has been picked yet', () => {
		const result = promoteRecent(list, idOf, []);
		expect(ids(result.items)).toEqual(['a', 'b', 'c', 'd']);
		expect(result.count).toBe(0);
	});

	it('survives an empty list and blank ids', () => {
		expect(promoteRecent([], idOf, ['a']).items).toEqual([]);
		const withBlank = [{ id: '' }, { id: 'a' }, { id: 'b' }];
		const result = promoteRecent(withBlank, idOf, ['b', 'a']);
		expect(ids(result.items)).toEqual(['b', 'a', '']);
	});

	it('does not modify the list it was given', () => {
		const before = [...list];
		promoteRecent(before, idOf, ['c', 'a']);
		expect(ids(before)).toEqual(['a', 'b', 'c', 'd']);
	});
});
