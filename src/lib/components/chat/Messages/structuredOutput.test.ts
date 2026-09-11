import { describe, expect, it } from 'vitest';
import {
	buildOutputDisplayItems,
	getGeneratedText,
	getOutputText,
	type OutputItem
} from './structuredOutput';

const reasoning = (text: string): OutputItem => ({
	type: 'reasoning',
	content: [{ type: 'reasoning_text', text }]
});

const message = (text: string): OutputItem => ({
	type: 'message',
	content: [{ type: 'output_text', text }]
});

describe('getGeneratedText', () => {
	it('includes reasoning text that getOutputText leaves out', () => {
		const output = [reasoning('thinking hard'), message('Hello!')];

		// The visible answer only
		// what belongs in message.content
		expect(getOutputText(output)).toBe('Hello!');
		// Everything the model produced
		// what generation stats must measure
		expect(getGeneratedText(output)).toBe('thinking hard\nHello!');
	});

	it('measures a response that is still mid-reasoning', () => {
		// The case that reported 0 tokens:
		// reasoning has started, no answer yet
		const output = [reasoning('still working on it')];

		expect(getOutputText(output)).toBe('');
		expect(getGeneratedText(output)).toBe('still working on it');
	});

	it('prefers a reasoning summary when the provider sends one', () => {
		const output: OutputItem[] = [
			{
				type: 'reasoning',
				summary: [{ type: 'summary_text', text: 'summarised' }],
				content: [{ type: 'reasoning_text', text: 'raw' }]
			}
		];
		expect(getGeneratedText(output)).toBe('summarised');
	});

	it('ignores non-generated items such as tool calls', () => {
		const output: OutputItem[] = [
			{ type: 'function_call', name: 'search', arguments: '{"q":"x"}' },
			message('done')
		];
		expect(getGeneratedText(output)).toBe('done');
	});

	it('handles empty and missing output', () => {
		expect(getGeneratedText([])).toBe('');
		expect(getGeneratedText(null)).toBe('');
		expect(getGeneratedText(undefined)).toBe('');
	});
});

describe('buildOutputDisplayItems', () => {
	// A reasoning item with no status and no duration
	// sitting last in the array
	const inProgressReasoning: OutputItem[] = [
		{ type: 'reasoning', content: [{ type: 'reasoning_text', text: 'hmm' }] }
	];

	const summaryOf = (items: OutputItem[], done: boolean) => {
		const built = buildOutputDisplayItems(items, done);
		const first = built[0] as { token?: { summary?: string } };
		return first?.token?.summary;
	};

	it('shows the in-progress label while the message is still streaming', () => {
		expect(summaryOf(inProgressReasoning, false)).toBe('Thinking...');
	});

	it('never shows the in-progress label once the message is done', () => {
		expect(summaryOf(inProgressReasoning, true)).not.toBe('Thinking...');
	});

	it('defaults to streaming behaviour when no done flag is passed', () => {
		expect(summaryOf(inProgressReasoning, undefined as unknown as boolean)).toBe('Thinking...');
	});

	it('keeps reasoning ahead of the answer it preceded', () => {
		const items: OutputItem[] = [
			{ type: 'reasoning', status: 'completed', content: [{ type: 'reasoning_text', text: 'r' }] },
			{ type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'answer' }] }
		];
		expect(buildOutputDisplayItems(items, true).map((i) => i.type)).toEqual([
			'detail_single',
			'message'
		]);
	});
});

describe('folding a turn that talks between its tool calls', () => {
	const call = (name: string, id: string): OutputItem => ({
		type: 'function_call',
		name,
		call_id: id,
		status: 'completed'
	});
	const result = (id: string): OutputItem => ({
		type: 'function_call_output',
		call_id: id,
		output: [{ type: 'output_text', text: 'ok' }]
	});
	const says = (text: string, id = text): OutputItem => ({
		type: 'message',
		id,
		status: 'completed',
		content: [{ type: 'output_text', text }]
	});

	const types = (items: OutputItem[]) => buildOutputDisplayItems(items, true).map((i) => i.type);

	it('groups across the sentences that used to break the run', () => {
		// Twenty tool calls with a sentence between each rendered as twenty
		// separate groups, because a message flushed the run.
		const items = [
			call('a', '1'),
			result('1'),
			says('now the client'),
			call('b', '2'),
			result('2'),
			says('now the tests'),
			call('c', '3'),
			result('3')
		];
		expect(types(items)).toEqual(['detail_group']);
	});

	it('keeps the notes inside the group, in order, marked as notes', () => {
		const built = buildOutputDisplayItems(
			[call('a', '1'), result('1'), says('between'), call('b', '2'), result('2')],
			true
		);
		const tokens = (built[0] as { tokens: { attributes: { type: string }; text: string }[] })
			.tokens;
		expect(tokens.map((t) => t.attributes.type)).toEqual(['tool_calls', 'note', 'tool_calls']);
		expect(tokens[1].text).toBe('between');
	});

	it('leaves the answer outside', () => {
		const items = [
			call('a', '1'),
			result('1'),
			says('working'),
			call('b', '2'),
			result('2'),
			says('Here is the result.')
		];
		expect(types(items)).toEqual(['detail_group', 'message']);
	});

	it('leaves a message that came before the run outside it', () => {
		const items = [says('let me look'), call('a', '1'), result('1'), call('b', '2'), result('2')];
		expect(types(items)).toEqual(['message', 'detail_group']);
	});

	it('does not turn one tool call plus a note into a group', () => {
		// A group of one detail is a heading with nothing under it.
		expect(types([call('a', '1'), result('1'), says('done')])).toEqual([
			'detail_single',
			'message'
		]);
	});

	it('never loses a message', () => {
		const items = [
			says('one'),
			call('a', '1'),
			result('1'),
			says('two'),
			call('b', '2'),
			result('2'),
			says('three')
		];
		const built = buildOutputDisplayItems(items, true);
		const texts = built.flatMap((item: any) =>
			item.type === 'message'
				? [item.text]
				: item.type === 'detail_group'
					? item.tokens.filter((t: any) => t.attributes.type === 'note').map((t: any) => t.text)
					: []
		);
		expect(texts).toEqual(['one', 'two', 'three']);
	});
});

describe('laying the steps out one below another', () => {
	const call = (name: string, id: string): OutputItem => ({
		type: 'function_call',
		name,
		call_id: id,
		status: 'completed'
	});
	const result = (id: string): OutputItem => ({
		type: 'function_call_output',
		call_id: id,
		output: [{ type: 'output_text', text: 'ok' }]
	});
	const says = (text: string, id = text): OutputItem => ({
		type: 'message',
		id,
		status: 'completed',
		content: [{ type: 'output_text', text }]
	});
	const think = (text: string, id = text): OutputItem => ({
		type: 'reasoning',
		id,
		content: [{ type: 'reasoning_text', text }]
	});

	const inline = { inline: true, groupTools: false };
	const inlineGrouped = { inline: true, groupTools: true };

	/** Each display item as one word: a group lists what it holds. */
	const picture = (items: OutputItem[], layout = inline) =>
		buildOutputDisplayItems(items, true, layout).map((item: any) =>
			item.type === 'detail_group'
				? `group(${item.tokens.map((t: any) => t.attributes.name ?? t.attributes.type).join(',')})`
				: item.type === 'detail_single'
					? (item.token.attributes.name ?? item.token.attributes.type)
					: item.type === 'message'
						? `"${item.text}"`
						: item.type
		);

	// The live view in the report: a call, a thought, two calls, a thought, text.
	const reported = [
		call('shell', '1'),
		result('1'),
		think('first'),
		call('shell', '2'),
		result('2'),
		call('github', '3'),
		result('3'),
		think('second'),
		says('Now let me look at the actual state.')
	];

	it('folds nothing when laid out flat', () => {
		expect(picture(reported)).toEqual([
			'shell',
			'reasoning',
			'shell',
			'github',
			'reasoning',
			'"Now let me look at the actual state."'
		]);
	});

	it('puts the notes between calls where they were written, as text', () => {
		const items = [call('a', '1'), result('1'), says('between'), call('b', '2'), result('2')];
		expect(picture(items)).toEqual(['a', '"between"', 'b']);
	});

	it('folds the burst of back-to-back calls and leaves the thoughts and text in view', () => {
		expect(picture(reported, inlineGrouped)).toEqual([
			'shell',
			'reasoning',
			'group(shell,github)',
			'reasoning',
			'"Now let me look at the actual state."'
		]);
	});

	it('ends a burst at text as well as at a thought', () => {
		const items = [
			call('a', '1'),
			result('1'),
			call('b', '2'),
			result('2'),
			says('checking'),
			call('c', '3'),
			result('3'),
			call('d', '4'),
			result('4')
		];
		expect(picture(items, inlineGrouped)).toEqual(['group(a,b)', '"checking"', 'group(c,d)']);
	});

	it('keeps a burst on the same row while it grows', () => {
		// Keyed by its first call, so the third call streaming in does not
		// replace the row the first two were already in.
		const two = buildOutputDisplayItems(
			[call('a', '1'), result('1'), call('b', '2'), result('2')],
			false,
			inlineGrouped
		);
		const three = buildOutputDisplayItems(
			[call('a', '1'), result('1'), call('b', '2'), result('2'), call('c', '3')],
			false,
			inlineGrouped
		);
		expect(two).toHaveLength(1);
		expect(three).toHaveLength(1);
		expect(three[0].id).toBe(two[0].id);
	});

	it('leaves the folded layout exactly as it was when both switches are off', () => {
		expect(buildOutputDisplayItems(reported, true)).toEqual(
			buildOutputDisplayItems(reported, true, { inline: false, groupTools: false })
		);
		expect(buildOutputDisplayItems(reported, true).map((item) => item.type)).toEqual([
			'detail_group',
			'message'
		]);
	});

	it('never loses a message or a step', () => {
		const built = buildOutputDisplayItems(reported, true, inlineGrouped);
		const steps = built.flatMap((item: any) =>
			item.type === 'detail_group' ? item.tokens : item.type === 'detail_single' ? [item.token] : []
		);
		const texts = built
			.filter((item: any) => item.type === 'message')
			.map((item: any) => item.text);
		expect(steps).toHaveLength(5);
		expect(texts).toEqual(['Now let me look at the actual state.']);
	});
});
