import { describe, expect, it } from 'vitest';
import {
	MAX_ITEMS,
	MAX_TEXT,
	describeValue,
	safeStringify,
	summariseArguments,
	toolHue,
	toolInitial
} from './toolCalls';

describe('describing a value by what it is', () => {
	it('reads the four kinds a tool actually returns', () => {
		expect(describeValue('Berlin')).toEqual({ kind: 'text', value: 'Berlin', truncated: false });
		expect(describeValue(12)).toEqual({ kind: 'number', value: '12' });
		expect(describeValue(true)).toEqual({ kind: 'boolean', value: true });
		expect(describeValue([1])).toMatchObject({ kind: 'list', hidden: 0 });
	});

	it('treats nothing as nothing, however it was written', () => {
		// A row reading `notes: ""` says less than no row at all.
		for (const nothing of [null, undefined, '', '   ']) {
			expect(describeValue(nothing).kind).toBe('empty');
		}
	});

	it('refuses to print a number that is not one', () => {
		// NaN and Infinity read as values when they are the absence of one.
		expect(describeValue(NaN).kind).toBe('empty');
		expect(describeValue(Infinity).kind).toBe('empty');
	});

	it('keeps the shape of nested data instead of flattening it to JSON', () => {
		const value = describeValue({ filter: { tags: ['a', 'b'] } });
		expect(value.kind).toBe('record');
		if (value.kind !== 'record') return;
		const filter = value.entries[0].value;
		expect(filter.kind).toBe('record');
		if (filter.kind !== 'record') return;
		expect(filter.entries[0].value).toMatchObject({ kind: 'list' });
	});

	it('stops before walking a whole document', () => {
		// These bound what is built, not only what is drawn: a streaming message
		// re-renders often, and a megabyte of search results is one value.
		const deep = { a: { b: { c: { d: { e: { f: 'too far' } } } } } };
		const described = JSON.stringify(describeValue(deep));
		expect(described).toContain('too far');
		expect(described.length).toBeLessThan(600);
	});

	it('caps a long list and says how many are left', () => {
		const value = describeValue(Array.from({ length: MAX_ITEMS + 7 }, (_, i) => i));
		expect(value).toMatchObject({ kind: 'list', hidden: 7 });
		if (value.kind === 'list') expect(value.items).toHaveLength(MAX_ITEMS);
	});

	it('caps a long string and marks it as cut', () => {
		const value = describeValue('x'.repeat(MAX_TEXT + 50));
		expect(value).toMatchObject({ kind: 'text', truncated: true });
		if (value.kind === 'text') expect(value.value).toHaveLength(MAX_TEXT);
	});

	it('survives what JSON refuses', () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(() => describeValue(circular)).not.toThrow();
		expect(() => safeStringify(circular)).not.toThrow();
	});
});

describe('the line that says what a tool was asked', () => {
	it('quotes a single argument on its own', () => {
		// `search_web` with one query does not need the word "query" back.
		expect(summariseArguments({ query: 'open webui tool calls' })).toBe('open webui tool calls');
	});

	it('names them once there is more than one', () => {
		expect(summariseArguments({ city: 'Berlin', days: 3 })).toBe('city: Berlin, days: 3');
	});

	it('leaves out the arguments that say nothing', () => {
		expect(summariseArguments({ query: 'rain', notes: '', extra: null })).toBe('rain');
	});

	it('has nothing to say about no arguments', () => {
		expect(summariseArguments({})).toBe('');
		expect(summariseArguments(null)).toBe('');
		expect(summariseArguments(undefined)).toBe('');
		expect(summariseArguments([] as unknown as Record<string, unknown>)).toBe('');
	});

	it('shortens rather than wrapping the row', () => {
		const summary = summariseArguments({ query: 'w'.repeat(200) }, 40);
		expect(summary).toHaveLength(40);
		expect(summary.endsWith('…')).toBe(true);
	});

	it('puts a nested argument on one line without braces everywhere', () => {
		expect(summariseArguments({ filter: { tags: ['a', 'b'] } })).toBe('{tags: [a, b]}');
	});

	it('collapses newlines, which a row cannot show anyway', () => {
		expect(summariseArguments({ text: 'first\n\nsecond' })).toBe('first second');
	});
});

describe('telling one tool from another at a glance', () => {
	it('gives the same tool the same colour every time', () => {
		expect(toolHue('search_web')).toBe(toolHue('search_web'));
	});

	it('gives different tools different colours', () => {
		const hues = new Set(['search_web', 'read_file', 'run_python', 'ask_user'].map(toolHue));
		expect(hues.size).toBe(4);
	});

	it('stays inside a hue', () => {
		for (const name of ['a', 'zzzzzzzzzzzzzzzz', '', 'a'.repeat(300)]) {
			const hue = toolHue(name);
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThan(360);
		}
	});

	it('finds a letter to show, or admits it cannot', () => {
		expect(toolInitial('search_web')).toBe('S');
		expect(toolInitial('_private')).toBe('P');
		expect(toolInitial('3d_render')).toBe('3');
		expect(toolInitial('___')).toBe('?');
		expect(toolInitial('')).toBe('?');
	});
});
