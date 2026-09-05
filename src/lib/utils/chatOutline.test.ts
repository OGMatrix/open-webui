import { describe, expect, it } from 'vitest';
import { buildOutline, entryForTurn, labelFor, stepOutline } from './chatOutline';

const toolCall = (name: string) =>
	`<details type="tool_calls" done="true" name="${name}">\n<summary>${name}</summary>\nresult\n</details>`;

const reasoning =
	'<details type="reasoning" done="true">\n<summary>Thought</summary>\nwhy\n</details>';

const run = [
	{ id: 'u1', role: 'user', content: 'How does **compaction** work?' },
	{
		id: 'a1',
		role: 'assistant',
		content: `${reasoning}\n${toolCall('read')}\n${toolCall('grep')}\nIt clears tool results.`
	},
	{ id: 'u2', role: 'user', content: 'And after that?' },
	{ id: 'a2', role: 'assistant', content: `${toolCall('write')}\nThen it summarises.` }
];

describe('naming a turn', () => {
	it('uses the first line of the readable text, not the markdown', () => {
		expect(labelFor('How does **compaction** work?')).toBe('How does compaction work?');
	});

	it('skips leading blank lines', () => {
		expect(labelFor('\n\nthe real question')).toBe('the real question');
	});

	it('takes only the first line', () => {
		expect(labelFor('first line\nsecond line')).toBe('first line');
	});

	it('shortens a line too long to fit', () => {
		const label = labelFor('x'.repeat(200));
		expect(label.length).toBeLessThanOrEqual(90);
		expect(label.endsWith('…')).toBe(true);
	});

	it('is empty for a message with nothing in it', () => {
		expect(labelFor('')).toBe('');
	});
});

describe('building the outline', () => {
	const outline = buildOutline(run);

	it('lists the questions and not the answers', () => {
		// The point of the outline: twenty tool calls are one entry, not twenty.
		expect(outline.map((entry) => entry.id)).toEqual(['u1', 'u2']);
	});

	it('counts the tool calls of the answer onto the question', () => {
		expect(outline[0].toolCalls).toBe(2);
		expect(outline[1].toolCalls).toBe(1);
	});

	it('counts reasoning blocks separately', () => {
		expect(outline[0].reasoning).toBe(1);
		expect(outline[1].reasoning).toBe(0);
	});

	it('counts how many answers a question drew', () => {
		expect(outline[0].replies).toBe(1);
	});

	it('gathers several answers under one question', () => {
		const merged = buildOutline([
			{ id: 'u', role: 'user', content: 'go' },
			{ id: 'a', role: 'assistant', content: toolCall('one') },
			{ id: 'b', role: 'assistant', content: toolCall('two') }
		]);
		expect(merged[0].replies).toBe(2);
		expect(merged[0].toolCalls).toBe(2);
	});

	it('does not mistake a reasoning block for a tool call', () => {
		const only = buildOutline([
			{ id: 'u', role: 'user', content: 'go' },
			{ id: 'a', role: 'assistant', content: reasoning }
		]);
		expect(only[0].toolCalls).toBe(0);
	});

	it('lists a compaction as a landmark of its own', () => {
		const compacted = buildOutline([
			{ id: 'u1', role: 'user', content: 'first' },
			{ id: 'a1', role: 'assistant', content: 'answer' },
			{ id: 'u2', role: 'user', content: 'second', contextSummary: 'we discussed X' }
		]);
		expect(compacted.map((entry) => entry.kind)).toEqual(['user', 'compaction', 'user']);
	});

	it('accepts the snake_case spelling the server uses', () => {
		const compacted = buildOutline([
			{ id: 'u1', role: 'user', content: 'first', context_summary: 'we discussed X' }
		]);
		expect(compacted[0].kind).toBe('compaction');
	});

	it('survives an empty branch', () => {
		expect(buildOutline([])).toEqual([]);
	});

	it('ignores an answer that arrived before any question', () => {
		// A branch can start on an assistant message after a fork.
		expect(buildOutline([{ id: 'a', role: 'assistant', content: toolCall('x') }])).toEqual([]);
	});
});

describe('stepping through turns', () => {
	const outline = buildOutline(run);

	it('moves to the next question', () => {
		expect(stepOutline(outline, 'u1', 1)?.id).toBe('u2');
	});

	it('moves to the previous question', () => {
		expect(stepOutline(outline, 'u2', -1)?.id).toBe('u1');
	});

	it('stops at the end rather than wrapping', () => {
		// Wrapping from the last question to the first would throw the reader to
		// the top of a long chat with no way to tell what happened.
		expect(stepOutline(outline, 'u2', 1)).toBeNull();
	});

	it('stops at the start rather than wrapping', () => {
		expect(stepOutline(outline, 'u1', -1)).toBeNull();
	});

	it('starts at the first question when nowhere in particular', () => {
		expect(stepOutline(outline, null, 1)?.id).toBe('u1');
	});

	it('starts at the last question when moving backwards from nowhere', () => {
		expect(stepOutline(outline, null, -1)?.id).toBe('u2');
	});

	it('has nowhere to go in an empty conversation', () => {
		expect(stepOutline([], null, 1)).toBeNull();
	});
});

describe('knowing which turn is being read', () => {
	const outline = buildOutline(run);

	it('is the question itself', () => {
		expect(entryForTurn(outline, 0)?.id).toBe('u1');
	});

	it('is still the question while reading its answer', () => {
		// The failure this exists for: the outline losing its highlight the
		// moment the reader scrolls off the question and into the answer.
		expect(entryForTurn(outline, 1)?.id).toBe('u1');
	});

	it('moves on at the next question', () => {
		expect(entryForTurn(outline, 2)?.id).toBe('u2');
	});

	it('is nothing above the first question', () => {
		expect(entryForTurn(buildOutline(run.slice(1)), 0)).toBeNull();
	});
});
