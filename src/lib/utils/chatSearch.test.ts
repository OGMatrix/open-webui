import { describe, expect, it } from 'vitest';
import {
	buildSearchIndex,
	createIndexer,
	findMatches,
	fold,
	hitsByMessage,
	isQueryValid,
	markdownToText,
	searchIndex,
	stepHit
} from './chatSearch';

/** The substrings a set of ranges actually covers in the original text. */
const matched = (text: string, query: string, options = {}) =>
	findMatches(text, query, options).map((range) => text.slice(range.start, range.end));

describe('folding text into a comparable form', () => {
	it('collapses a run of whitespace to one space', () => {
		expect(fold('a  \n\t b').text).toBe('a b');
	});

	it('maps every folded character back to where it came from', () => {
		const { text, offsets } = fold('a  \n\t b');
		expect(text).toBe('a b');
		// The single space stands for the whole run, so it points at the run's
		// first character; slicing [offsets[2], offsets[3]] must give back "b".
		expect('a  \n\t b'.slice(offsets[2], offsets[3])).toBe('b');
	});

	it('keeps a trailing offset so a range at the end can be mapped', () => {
		const { text, offsets } = fold('hello');
		expect(offsets).toHaveLength(text.length + 1);
		expect(offsets[text.length]).toBe(5);
	});

	it('strips accents', () => {
		expect(fold('Müller').text).toBe('muller');
	});

	it('does not lose the character an accent was attached to', () => {
		const source = 'Café';
		const { text, offsets } = fold(source);
		expect(text).toBe('cafe');
		expect(source.slice(offsets[3], offsets[4])).toBe('é');
	});

	it('expands a ligature rather than dropping it', () => {
		expect(fold('ﬁle').text).toBe('file');
	});

	it('survives characters outside the basic plane', () => {
		// The failure this exists for: iterating a string by code point emits one
		// offset for an emoji, but indexOf counts it as two, so every offset after
		// an emoji was short by one and matches landed a character to the left.
		const source = 'a😀 needle';
		const { text, offsets } = fold(source);
		expect(offsets).toHaveLength(text.length + 1);
		expect(matched(source, 'needle')).toEqual(['needle']);
	});

	it('leaves case alone when asked to', () => {
		expect(fold('Model', true).text).toBe('Model');
		expect(fold('Model', false).text).toBe('model');
	});
});

describe('matching literal text', () => {
	it('finds a plain occurrence', () => {
		expect(matched('the context window', 'context')).toEqual(['context']);
	});

	it('ignores case by default', () => {
		expect(matched('The Context Window', 'context')).toEqual(['Context']);
	});

	it('respects case when asked to', () => {
		expect(matched('The Context Window', 'context', { caseSensitive: true })).toEqual([]);
		expect(matched('The Context Window', 'Context', { caseSensitive: true })).toEqual(['Context']);
	});

	it('crosses a line break, because the reader sees one line', () => {
		// The failure this exists for: a renderer wraps a paragraph, and the
		// browser's own find gives up at the newline in the source.
		expect(matched('hello\n   world', 'hello world')).toEqual(['hello\n   world']);
	});

	it('finds a typographic apostrophe from a typed one', () => {
		expect(matched('it doesn’t compact', "doesn't")).toEqual(['doesn’t']);
	});

	it('finds an em dash from a hyphen', () => {
		expect(matched('input — output', 'input - output')).toEqual(['input — output']);
	});

	it('finds accented text from an unaccented query', () => {
		expect(matched('Müller sagte', 'muller')).toEqual(['Müller']);
	});

	it('returns nothing for an empty query', () => {
		expect(findMatches('anything', '')).toEqual([]);
	});

	it('does not overlap matches', () => {
		expect(matched('aaaa', 'aa')).toEqual(['aa', 'aa']);
	});

	it('finds every occurrence', () => {
		expect(matched('one two one two one', 'one')).toHaveLength(3);
	});
});

describe('whole word matching', () => {
	it('rejects a match inside a longer word', () => {
		expect(matched('concatenate', 'cat', { wholeWord: true })).toEqual([]);
	});

	it('accepts a match that stands alone', () => {
		expect(matched('the cat sat', 'cat', { wholeWord: true })).toEqual(['cat']);
	});

	it('keeps looking after rejecting one', () => {
		// The failure this exists for: giving up at the first embedded hit would
		// hide the real one that follows it.
		expect(matched('concatenate the cat', 'cat', { wholeWord: true })).toEqual(['cat']);
	});

	it('treats punctuation as a boundary', () => {
		expect(matched('(cat)', 'cat', { wholeWord: true })).toEqual(['cat']);
	});

	it('does not treat a digit as a boundary', () => {
		expect(matched('cat5', 'cat', { wholeWord: true })).toEqual([]);
	});
});

describe('matching by regular expression', () => {
	it('applies the pattern', () => {
		expect(matched('a1 b22 c333', '\\d+', { regex: true })).toEqual(['1', '22', '333']);
	});

	it('is case insensitive unless asked otherwise', () => {
		expect(matched('Foo foo', 'foo', { regex: true })).toEqual(['Foo', 'foo']);
		expect(matched('Foo foo', 'foo', { regex: true, caseSensitive: true })).toEqual(['foo']);
	});

	it('honours whole word', () => {
		expect(matched('cat concatenate', 'cat', { regex: true, wholeWord: true })).toEqual(['cat']);
	});

	it('does not hang on a pattern that can match nothing', () => {
		// The failure this exists for: a zero-length match never advances
		// lastIndex, so the loop runs forever on the first keystroke of `.*`.
		expect(findMatches('abc', 'x*', { regex: true })).toEqual([]);
	});

	it('yields nothing for a pattern that cannot compile', () => {
		expect(findMatches('abc', '[a', { regex: true })).toEqual([]);
	});

	it('reports whether a query can compile', () => {
		expect(isQueryValid('[a', { regex: true })).toBe(false);
		expect(isQueryValid('[a]', { regex: true })).toBe(true);
		// Literal text is never invalid, whatever it contains.
		expect(isQueryValid('[a', { regex: false })).toBe(true);
	});
});

describe('reading the text out of markdown', () => {
	it('sees through emphasis', () => {
		expect(markdownToText('**hello** world')).toContain('hello world');
	});

	it('keeps the label of a link and drops the target', () => {
		const text = markdownToText('see [the docs](https://example.com/secret)');
		expect(text).toContain('the docs');
		expect(text).not.toContain('example.com');
	});

	it('keeps code, which is read as much as prose', () => {
		expect(markdownToText('```py\nprint("hi")\n```')).toContain('print("hi")');
	});

	it('keeps inline code', () => {
		expect(markdownToText('call `enforce_context_window` first')).toContain(
			'enforce_context_window'
		);
	});

	it('keeps table cells', () => {
		const text = markdownToText('| a | b |\n| - | - |\n| one | two |');
		expect(text).toContain('one');
		expect(text).toContain('two');
	});

	it('keeps the text inside a collapsed block and drops its tags', () => {
		// Tool calls and reasoning arrive as html, and are exactly what someone
		// searching a long agentic chat is looking for.
		const text = markdownToText('<details type="tool_calls"><summary>get_weather</summary>');
		expect(text).toContain('get_weather');
		expect(text).not.toContain('<summary>');
	});

	it('does not fuse the last word of a block with the first of the next', () => {
		expect(markdownToText('# Title\n\nbody')).not.toContain('Titlebody');
	});

	it('keeps the body of a code fence that is still being written', () => {
		// Streaming means half the messages in an agentic chat are unterminated
		// at the moment someone searches them.
		expect(markdownToText('```py\nenforce_context_window(')).toContain('enforce_context_window');
	});

	it('is empty for empty input', () => {
		expect(markdownToText('')).toBe('');
	});
});

const conversation = [
	{ id: 'm1', role: 'user', content: 'How does **compaction** work?' },
	{ id: 'm2', role: 'assistant', content: 'Compaction clears tool results first.' },
	{ id: 'm3', role: 'user', content: 'And after that?' },
	{ id: 'm4', role: 'assistant', content: 'Then it summarises. Compaction is last.' }
];

describe('indexing a conversation', () => {
	it('numbers messages in reading order', () => {
		expect(buildSearchIndex(conversation).map((m) => m.turn)).toEqual([0, 1, 2, 3]);
	});

	it('indexes the readable text, not the markdown', () => {
		expect(buildSearchIndex(conversation)[0].text).toContain('compaction work');
	});

	it('includes the names of attached files', () => {
		const index = buildSearchIndex([
			{ id: 'm', role: 'user', content: 'look at this', files: [{ name: 'budget.csv' }] }
		]);
		expect(index[0].text).toContain('budget.csv');
	});

	it('includes an error, which is text the reader can see', () => {
		const index = buildSearchIndex([
			{ id: 'm', role: 'assistant', content: '', error: { content: 'context length exceeded' } }
		]);
		expect(index[0].text).toContain('context length exceeded');
	});

	it('survives a message with nothing in it', () => {
		expect(buildSearchIndex([{ id: 'm' } as never])[0].text).toBe('');
	});
});

describe('searching a conversation', () => {
	const index = buildSearchIndex(conversation);

	it('finds every occurrence across the whole branch', () => {
		expect(searchIndex(index, 'compaction')).toHaveLength(3);
	});

	it('returns them oldest first', () => {
		expect(searchIndex(index, 'compaction').map((hit) => hit.messageId)).toEqual([
			'm1',
			'm2',
			'm4'
		]);
	});

	it('can be limited to one side of the conversation', () => {
		expect(searchIndex(index, 'compaction', { role: 'user' }).map((h) => h.messageId)).toEqual([
			'm1'
		]);
		expect(searchIndex(index, 'compaction', { role: 'assistant' }).map((h) => h.messageId)).toEqual(
			['m2', 'm4']
		);
	});

	it('numbers occurrences within their own message', () => {
		const repeated = buildSearchIndex([{ id: 'm', role: 'user', content: 'go go go' }]);
		expect(searchIndex(repeated, 'go').map((hit) => hit.occurrence)).toEqual([0, 1, 2]);
	});

	it('gives each hit a snippet with the match set apart', () => {
		const [hit] = searchIndex(index, 'clears');
		expect(hit.snippet.match).toBe('clears');
		expect(hit.snippet.before).toContain('Compaction');
		expect(hit.snippet.after).toContain('tool results');
	});

	it('marks a snippet that was cut short', () => {
		const long = buildSearchIndex([
			{ id: 'm', role: 'user', content: `${'a'.repeat(200)} needle ${'b'.repeat(200)}` }
		]);
		const [hit] = searchIndex(long, 'needle');
		expect(hit.snippet.before.startsWith('…')).toBe(true);
		expect(hit.snippet.after.endsWith('…')).toBe(true);
	});

	it('finds nothing for an empty query', () => {
		expect(searchIndex(index, '')).toEqual([]);
	});

	it('counts hits per message, for deciding what to expand', () => {
		const counts = hitsByMessage(searchIndex(index, 'compaction'));
		expect(counts.get('m1')).toBe(1);
		expect(counts.get('m3')).toBeUndefined();
	});
});

describe('re-indexing only what changed', () => {
	it('reuses the entry for a message that did not change', () => {
		const indexer = createIndexer();
		const first = indexer(conversation);
		const second = indexer(conversation);
		// Identity, not equality: a fresh object would mean it was lexed again.
		expect(second[0]).toBe(first[0]);
	});

	it('re-reads a message whose content changed', () => {
		const indexer = createIndexer();
		const first = indexer([{ id: 'm', role: 'assistant', content: 'partial' }]);
		const second = indexer([{ id: 'm', role: 'assistant', content: 'partial answer' }]);
		expect(second[0]).not.toBe(first[0]);
		expect(second[0].text).toContain('partial answer');
	});

	it('re-reads when a file is attached to an otherwise unchanged message', () => {
		const indexer = createIndexer();
		indexer([{ id: 'm', role: 'user', content: 'see this' }]);
		const after = indexer([
			{ id: 'm', role: 'user', content: 'see this', files: [{ name: 'notes.md' }] }
		]);
		expect(after[0].text).toContain('notes.md');
	});

	it('renumbers a message that moved without re-reading its neighbours', () => {
		// Switching to a branch can shift every turn number below it.
		const indexer = createIndexer();
		indexer([{ id: 'a', role: 'user', content: 'one' }]);
		const moved = indexer([
			{ id: 'z', role: 'user', content: 'zero' },
			{ id: 'a', role: 'user', content: 'one' }
		]);
		expect(moved[1].turn).toBe(1);
	});

	it('forgets messages that left the branch', () => {
		const indexer = createIndexer();
		const before = indexer([{ id: 'a', role: 'user', content: 'one' }]);
		indexer([{ id: 'b', role: 'user', content: 'two' }]);
		const back = indexer([{ id: 'a', role: 'user', content: 'one' }]);
		expect(back[0]).not.toBe(before[0]);
	});
});

describe('stepping through hits', () => {
	it('starts at the first when moving forwards from nowhere', () => {
		expect(stepHit(-1, 5, 1)).toBe(0);
	});

	it('starts at the last when moving backwards from nowhere', () => {
		expect(stepHit(-1, 5, -1)).toBe(4);
	});

	it('wraps past the end', () => {
		expect(stepHit(4, 5, 1)).toBe(0);
	});

	it('wraps past the start', () => {
		expect(stepHit(0, 5, -1)).toBe(4);
	});

	it('has nowhere to go when there are no hits', () => {
		expect(stepHit(0, 0, 1)).toBe(-1);
	});
});
