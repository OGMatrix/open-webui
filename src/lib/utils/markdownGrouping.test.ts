import { describe, expect, it } from 'vitest';
import { countToolCalls, getDisplayTokens, isGroupableDetailToken } from './markdownGrouping';

const tool = (name = 'gh_get_file_contents') => ({
	type: 'details',
	attributes: { type: 'tool_calls', name },
	text: 'result'
});

const reasoning = () => ({ type: 'details', attributes: { type: 'reasoning' }, text: 'thinking' });
const note = (text = 'Jetzt der Client.') => ({ type: 'paragraph', raw: text, text });
const code = () => ({ type: 'code', lang: 'ts', text: 'const x = 1;' });
const heading = () => ({ type: 'heading', depth: 2, text: 'Ergebnis' });
const blank = () => ({ type: 'space', raw: '\n\n' });

const kinds = (tokens: ReturnType<typeof getDisplayTokens>) => tokens.map((token) => token.type);

describe('what counts as process', () => {
	it('recognises the three detail kinds that are process', () => {
		expect(isGroupableDetailToken(tool())).toBe(true);
		expect(isGroupableDetailToken(reasoning())).toBe(true);
		expect(
			isGroupableDetailToken({ type: 'details', attributes: { type: 'code_interpreter' } })
		).toBe(true);
	});

	it('leaves other details alone', () => {
		// A citation or an arbitrary <details> the model wrote is content.
		expect(isGroupableDetailToken({ type: 'details', attributes: { type: 'citation' } })).toBe(
			false
		);
		expect(isGroupableDetailToken({ type: 'details' })).toBe(false);
		expect(isGroupableDetailToken(note())).toBe(false);
		expect(isGroupableDetailToken(undefined)).toBe(false);
	});
});

describe('folding a turn that talks between its tool calls', () => {
	it('groups across the sentences that used to break the run', () => {
		// The failure this exists for: twenty tool calls with one sentence
		// between each rendered as twenty loose rows, because grouping only
		// joined details that were adjacent.
		const tokens = [tool(), note(), tool(), note(), tool()];
		const display = getDisplayTokens(tokens);

		expect(display).toHaveLength(1);
		expect(display[0].type).toBe('detail_group');
		expect(countToolCalls((display[0] as any).items)).toBe(3);
	});

	it('keeps the working notes inside the group, in order', () => {
		const display = getDisplayTokens([tool(), note('erst dies'), tool(), note('dann das'), tool()]);
		const items = (display[0] as any).items;
		expect(items.map((item: any) => item.text)).toEqual([
			'result',
			'erst dies',
			'result',
			'dann das',
			'result'
		]);
	});

	it('leaves the answer outside', () => {
		// Prose after the last tool call is what the assistant concluded, and
		// folding it away would hide the reply behind a disclosure triangle.
		const display = getDisplayTokens([
			tool(),
			note('working'),
			tool(),
			note('Hier ist das Ergebnis.')
		]);

		expect(kinds(display)).toEqual(['detail_group', 'paragraph']);
		expect((display[1] as any).text).toBe('Hier ist das Ergebnis.');
	});

	it('gives back every trailing note, not just the last', () => {
		const display = getDisplayTokens([tool(), tool(), note('a'), blank(), note('b')]);
		expect(kinds(display)).toEqual(['detail_group', 'paragraph', 'space', 'paragraph']);
	});

	it('mixes reasoning and tool calls into the same run', () => {
		const display = getDisplayTokens([reasoning(), note(), tool(), note(), reasoning()]);
		expect(display).toHaveLength(1);
		expect((display[0] as any).items).toHaveLength(5);
	});
});

describe('what must not be folded away', () => {
	it('stops at a code block rather than hiding produced output', () => {
		// A code block mid-run is something the assistant wrote, not a note
		// about writing it.
		const display = getDisplayTokens([tool(), note(), tool(), code(), tool()]);
		expect(kinds(display)).toEqual(['detail_group', 'code', 'details']);
	});

	it('stops at a heading', () => {
		const display = getDisplayTokens([tool(), tool(), heading(), tool(), tool()]);
		expect(kinds(display)).toEqual(['detail_group', 'heading', 'detail_group']);
	});

	it('does not wrap a lone tool call in a group', () => {
		// A group of one is a heading with nothing under it.
		expect(kinds(getDisplayTokens([tool()]))).toEqual(['details']);
		expect(kinds(getDisplayTokens([note(), tool(), note()]))).toEqual([
			'paragraph',
			'details',
			'paragraph'
		]);
	});

	it('never loses or reorders a token', () => {
		const tokens = [note('one'), tool(), note('two'), tool(), code(), tool(), note('three')];
		const display = getDisplayTokens(tokens);

		const flattened = display.flatMap((item: any) =>
			item.type === 'detail_group' ? item.items : [item]
		);
		expect(flattened).toEqual(tokens);
	});
});

describe('the shapes that turn up while streaming', () => {
	it('keeps the newest note visible under a folded summary', () => {
		// Mid-run, the answer has not arrived yet, so the trailing note is the
		// most recent thing the assistant said and should stay readable.
		const display = getDisplayTokens([tool(), note('a'), tool(), note('gerade dabei')]);
		expect(kinds(display)).toEqual(['detail_group', 'paragraph']);
		expect((display[1] as any).text).toBe('gerade dabei');
	});

	it('handles a turn that has only just started', () => {
		expect(kinds(getDisplayTokens([note('Ich sehe mir das an.')]))).toEqual(['paragraph']);
		expect(kinds(getDisplayTokens([]))).toEqual([]);
		expect(getDisplayTokens()).toEqual([]);
	});

	it('handles blank tokens between calls without breaking the run', () => {
		const display = getDisplayTokens([tool(), blank(), tool(), blank(), tool()]);
		expect(display).toHaveLength(1);
		expect(countToolCalls((display[0] as any).items)).toBe(3);
	});
});

describe('counting what is in a group', () => {
	it('counts only the tool calls', () => {
		expect(countToolCalls([tool(), note(), reasoning(), tool()])).toBe(2);
		expect(countToolCalls([])).toBe(0);
		expect(countToolCalls()).toBe(0);
	});
});
