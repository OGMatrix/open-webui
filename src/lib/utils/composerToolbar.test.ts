import { describe, expect, it } from 'vitest';
import {
	DENSITIES,
	chipsFit,
	countLabel,
	fitDensity,
	isCompact,
	isStacked,
	levelMeter,
	splitModelName,
	type ChipBox,
	type ToolbarDensity
} from './composerToolbar';

describe('settling on a layout', () => {
	it('keeps the words when everything fits on one line', async () => {
		expect(await fitDensity(() => true)).toBe('full');
	});

	it('drops to icons before it gives up a line', async () => {
		const tried: ToolbarDensity[] = [];
		const result = await fitDensity((density) => {
			tried.push(density);
			return density === 'compact';
		});
		expect(result).toBe('compact');
		expect(tried).toEqual(['full', 'compact']);
	});

	it('stacks with words when the words fit on a line of their own', async () => {
		expect(await fitDensity((density) => density === 'stacked')).toBe('stacked');
	});

	it('stacks as icons when not even a line of their own holds the words', async () => {
		expect(await fitDensity(() => false)).toBe('stacked-compact');
	});

	it('never tries the last layout, which wraps rather than overflows', async () => {
		const tried: ToolbarDensity[] = [];
		await fitDensity((density) => {
			tried.push(density);
			return false;
		});
		expect(tried).toEqual(['full', 'compact', 'stacked']);
	});

	it('reads each layout as stacked or not, compact or not', () => {
		expect(DENSITIES.map((density) => [isStacked(density), isCompact(density)])).toEqual([
			[false, false],
			[false, true],
			[true, false],
			[true, true]
		]);
	});

	it('waits for a layout that takes a moment to apply', async () => {
		const result = await fitDensity(async (density) => {
			await Promise.resolve();
			return density === 'full';
		});
		expect(result).toBe('full');
	});

	it('orders the layouts richest first', () => {
		expect(DENSITIES).toEqual(['full', 'compact', 'stacked', 'stacked-compact']);
	});
});

describe('whether the chips fit', () => {
	const box = (left: number, width: number, top = 0): ChipBox => ({
		left,
		right: left + width,
		top,
		width
	});

	it('fits when every chip ends inside the edge', () => {
		expect(chipsFit([box(0, 40), box(46, 60)], 200)).toBe(true);
	});

	it('does not fit when a chip runs past the edge', () => {
		expect(chipsFit([box(0, 40), box(46, 180)], 200)).toBe(false);
	});

	it('ignores wrappers that draw nothing', () => {
		// The gauge sits in a `display: contents` wrapper whose box is all zeros.
		expect(chipsFit([box(0, 0), box(10, 50)], 100)).toBe(true);
	});

	it('does not fit when a chip has wrapped onto a second line', () => {
		expect(chipsFit([box(0, 40), box(0, 40, 30)], 400)).toBe(false);
	});

	it('forgives a pixel of rounding', () => {
		expect(chipsFit([box(0, 100.4)], 100)).toBe(true);
	});

	it('fits when there are no chips at all', () => {
		expect(chipsFit([], 0)).toBe(true);
	});
});

describe('a count in a pill', () => {
	it('shows small counts as they are', () => {
		expect(countLabel(3)).toBe('3');
		expect(countLabel(99)).toBe('99');
	});

	it('caps what would stretch the pill', () => {
		expect(countLabel(100)).toBe('99+');
		expect(countLabel(12, 9)).toBe('9+');
	});

	it('says nothing for nothing', () => {
		// An empty pill would be a pill with nothing to report.
		expect(countLabel(0)).toBe('');
		expect(countLabel(-2)).toBe('');
		expect(countLabel(Number.NaN)).toBe('');
	});
});

describe('cutting a model name', () => {
	it('leaves a short name alone', () => {
		expect(splitModelName('gpt-5')).toEqual({ head: 'gpt-5', tail: '' });
	});

	it('keeps the context length at the end of an identifier', () => {
		// Two of these differ only at the end; cutting the end makes them the same.
		expect(splitModelName('qwen3.8-27b-mtp-256k')).toEqual({
			head: 'qwen3.8-27b-mtp',
			tail: '-256k'
		});
	});

	it('keeps a whole quantisation rather than its last fragment', () => {
		expect(splitModelName('llama3.1:8b-instruct-q4_K_M')).toEqual({
			head: 'llama3.1:8b-instruct',
			tail: '-q4_K_M'
		});
	});

	it('keeps a tag', () => {
		expect(splitModelName('deepseek-r1-distill:latest')).toEqual({
			head: 'deepseek-r1-distill',
			tail: ':latest'
		});
	});

	it('leaves prose to be cut at the end', () => {
		// "Pruefmodell…zeugen" reads worse than "Pruefmodell mit W…".
		expect(splitModelName('Pruefmodell mit Werkzeugen')).toEqual({
			head: 'Pruefmodell mit Werkzeugen',
			tail: ''
		});
	});

	it('leaves an identifier alone when no ending is short enough', () => {
		expect(splitModelName('averyveryverylongmodelname')).toEqual({
			head: 'averyveryverylongmodelname',
			tail: ''
		});
	});

	it('never leaves the front empty', () => {
		const { head, tail } = splitModelName('-abcdefghijklmnopq');
		expect(head.length).toBeGreaterThan(0);
		expect(head + tail).toBe('-abcdefghijklmnopq');
	});

	it('puts the name back together exactly', () => {
		for (const name of [
			'qwen3.8-27b-mtp-256k',
			'llama3.1:8b-instruct-q4_K_M',
			'org/model-name@v2.1'
		]) {
			const { head, tail } = splitModelName(name);
			expect(head + tail).toBe(name);
		}
	});

	it('survives nonsense', () => {
		expect(splitModelName(undefined as unknown as string)).toEqual({ head: '', tail: '' });
	});
});

describe('a level as bars', () => {
	const threeLevels = ['off', 'low', 'medium', 'high'];
	const allLevels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

	it('counts against the model own levels', () => {
		expect(levelMeter(threeLevels, 'medium')).toEqual({ total: 3, filled: 2 });
		expect(levelMeter(threeLevels, 'high')).toEqual({ total: 3, filled: 3 });
	});

	it('gives every level of the longest scale its own bar count', () => {
		const counts = allLevels.slice(1).map((level) => levelMeter(allLevels, level)?.filled);
		expect(counts).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('draws nothing for off, for no level, or for a level the model does not have', () => {
		expect(levelMeter(threeLevels, 'off')).toBe(null);
		expect(levelMeter(threeLevels, null)).toBe(null);
		expect(levelMeter(threeLevels, 'xhigh')).toBe(null);
	});

	it('draws nothing for a plain switch, which is not a scale', () => {
		expect(levelMeter(['off', 'high'], 'high')).toBe(null);
	});

	it('scales a scale longer than a meter can carry', () => {
		const long = ['off', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
		expect(levelMeter(long, 'h')).toEqual({ total: 6, filled: 6 });
		expect(levelMeter(long, 'a')).toEqual({ total: 6, filled: 1 });
	});
});
