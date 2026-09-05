import { describe, expect, it } from 'vitest';
import { locate, type FlatText } from './domHighlight';

/**
 * A flattened tree, written the way `flatten` would produce it.
 *
 * `locate` only ever reads `data`, so plain objects stand in for text nodes and
 * the offset arithmetic can be checked where there is no DOM.
 */
const flat = (...pieces: string[]): FlatText => {
	const spans: FlatText['spans'] = [];
	let start = 0;
	for (const piece of pieces) {
		spans.push({ node: { data: piece }, start });
		start += piece.length;
	}
	return { text: pieces.join(''), spans };
};

/** A tree whose blocks are separated, as `flatten` separates them. */
const withSeparator = (): FlatText => ({
	text: 'one\ntwo',
	spans: [
		{ node: { data: 'one' }, start: 0 },
		{ node: { data: 'two' }, start: 4 }
	]
});

describe('placing an offset back into the tree', () => {
	it('finds the first character', () => {
		expect(locate(flat('abc', 'def'), 0)).toEqual({ node: { data: 'abc' }, offset: 0 });
	});

	it('finds a character inside the first node', () => {
		expect(locate(flat('abc', 'def'), 2)).toEqual({ node: { data: 'abc' }, offset: 2 });
	});

	it('finds the first character of the second node', () => {
		expect(locate(flat('abc', 'def'), 3)).toEqual({ node: { data: 'def' }, offset: 0 });
	});

	it('finds the very end, which is where a match may finish', () => {
		expect(locate(flat('abc', 'def'), 6)).toEqual({ node: { data: 'def' }, offset: 3 });
	});

	it('lands on the right node across many of them', () => {
		// Binary search, so an off-by-one only shows up with more than two nodes.
		const tree = flat('aa', 'bb', 'cc', 'dd', 'ee');
		expect(locate(tree, 5)).toEqual({ node: { data: 'cc' }, offset: 1 });
		expect(locate(tree, 6)).toEqual({ node: { data: 'dd' }, offset: 0 });
	});

	it('clamps an offset that fell on a block separator', () => {
		// The newline between two blocks belongs to no node. A match that ends
		// there has to resolve to the end of the block before it, not be refused.
		expect(locate(withSeparator(), 3)).toEqual({ node: { data: 'one' }, offset: 3 });
	});

	it('still finds the node after a separator', () => {
		expect(locate(withSeparator(), 4)).toEqual({ node: { data: 'two' }, offset: 0 });
	});

	it('has no answer for an empty tree', () => {
		expect(locate({ text: '', spans: [] }, 0)).toBeNull();
	});

	it('has no answer for a negative offset', () => {
		expect(locate(flat('abc'), -1)).toBeNull();
	});

	it('skips empty nodes rather than mislaying an offset in one', () => {
		// `flatten` never emits an empty node; if one arrived anyway, the offset
		// still has to resolve to real text.
		const tree: FlatText = {
			text: 'abcdef',
			spans: [
				{ node: { data: 'abc' }, start: 0 },
				{ node: { data: 'def' }, start: 3 }
			]
		};
		expect(locate(tree, 4)).toEqual({ node: { data: 'def' }, offset: 1 });
	});
});
