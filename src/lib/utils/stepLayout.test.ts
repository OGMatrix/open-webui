import { describe, expect, it } from 'vitest';
import {
	DEFAULT_STEP_LAYOUT,
	foldsBurstsInsideRuns,
	groupToolBursts,
	readStepLayout,
	runParts,
	type StepPart
} from './stepLayout';

type Step = { kind: 'tool' | 'thought' | 'text' | 'space'; id: string };
const tool = (id: string): Step => ({ kind: 'tool', id });
const thought = (id: string): Step => ({ kind: 'thought', id });
const text = (id: string): Step => ({ kind: 'text', id });
const space = (id: string): Step => ({ kind: 'space', id });

const isTool = (step: Step) => step.kind === 'tool';
const isSpace = (step: Step) => step.kind === 'space';

/** A readable picture of the parts: tools grouped in brackets, singles as ids. */
const shape = (parts: StepPart<Step>[]) =>
	parts.map((part) =>
		part.kind === 'tools' ? `[${part.items.map((item) => item.id).join(' ')}]` : part.item.id
	);

describe('reading the layout from settings', () => {
	it('is off unless switched on', () => {
		expect(readStepLayout({})).toEqual(DEFAULT_STEP_LAYOUT);
		expect(readStepLayout(null)).toEqual(DEFAULT_STEP_LAYOUT);
	});

	it('reads each switch', () => {
		expect(readStepLayout({ showStepsInline: true })).toEqual({ inline: true, groupTools: false });
		expect(readStepLayout({ groupToolCalls: true })).toEqual({ inline: false, groupTools: true });
	});

	it('takes nothing but true as on', () => {
		expect(readStepLayout({ showStepsInline: 'true', groupToolCalls: 1 })).toEqual(
			DEFAULT_STEP_LAYOUT
		);
	});

	it('folds bursts inside a run only when the run itself is folded', () => {
		// Laid out flat, the bursts are already the top level; folding them again
		// inside themselves would nest a group in a group of the same things.
		expect(foldsBurstsInsideRuns({ inline: false, groupTools: true })).toBe(true);
		expect(foldsBurstsInsideRuns({ inline: true, groupTools: true })).toBe(false);
		expect(foldsBurstsInsideRuns({ inline: false, groupTools: false })).toBe(false);
	});
});

describe('folding bursts of tool calls', () => {
	it('folds calls that follow one another directly', () => {
		expect(shape(groupToolBursts([tool('a'), tool('b'), tool('c')], isTool))).toEqual(['[a b c]']);
	});

	it('ends a burst at a thought', () => {
		expect(
			shape(groupToolBursts([tool('a'), tool('b'), thought('t'), tool('c'), tool('d')], isTool))
		).toEqual(['[a b]', 't', '[c d]']);
	});

	it('ends a burst at text', () => {
		expect(shape(groupToolBursts([tool('a'), tool('b'), text('x'), tool('c')], isTool))).toEqual([
			'[a b]',
			'x',
			'c'
		]);
	});

	it('leaves a lone call alone', () => {
		// A group of one is a heading with nothing under it.
		expect(shape(groupToolBursts([thought('t'), tool('a'), text('x')], isTool))).toEqual([
			't',
			'a',
			'x'
		]);
	});

	it('reproduces the reported sequence', () => {
		// The live view in the screenshot: call, thought, call, call, thought, text.
		const steps = [tool('1'), thought('g1'), tool('2'), tool('3'), thought('g2'), text('Now...')];
		expect(shape(groupToolBursts(steps, isTool))).toEqual(['1', 'g1', '[2 3]', 'g2', 'Now...']);
	});

	it('does not let spacing end a burst', () => {
		expect(shape(groupToolBursts([tool('a'), space('s'), tool('b')], isTool, isSpace))).toEqual([
			'[a s b]'
		]);
	});

	it('gives spacing after the last call back out of the burst', () => {
		expect(
			shape(groupToolBursts([tool('a'), tool('b'), space('s'), text('x')], isTool, isSpace))
		).toEqual(['[a b]', 's', 'x']);
	});

	it('leaves spacing that is not after a call where it is', () => {
		expect(shape(groupToolBursts([space('s'), tool('a'), tool('b')], isTool, isSpace))).toEqual([
			's',
			'[a b]'
		]);
	});

	it('treats spacing as a break when nothing says it is only spacing', () => {
		expect(shape(groupToolBursts([tool('a'), space('s'), tool('b')], isTool))).toEqual([
			'a',
			's',
			'b'
		]);
	});

	it('never loses or reorders an item', () => {
		const steps = [
			text('intro'),
			tool('a'),
			space('s1'),
			tool('b'),
			thought('t'),
			tool('c'),
			space('s2'),
			text('answer')
		];
		const flat = groupToolBursts(steps, isTool, isSpace).flatMap((part) =>
			part.kind === 'tools' ? part.items : [part.item]
		);
		expect(flat).toEqual(steps);
	});

	it('handles nothing at all', () => {
		expect(groupToolBursts([], isTool)).toEqual([]);
	});
});

describe('the parts of a folded run', () => {
	const steps = [tool('a'), tool('b'), thought('t'), tool('c')];

	it('keeps every step apart in the default layout', () => {
		expect(shape(runParts(steps, DEFAULT_STEP_LAYOUT, isTool))).toEqual(['a', 'b', 't', 'c']);
	});

	it('folds the bursts inside a folded run when tool grouping is on', () => {
		expect(shape(runParts(steps, { inline: false, groupTools: true }, isTool))).toEqual([
			'[a b]',
			't',
			'c'
		]);
	});

	it('does not fold again inside a burst that is already the top level', () => {
		expect(shape(runParts(steps, { inline: true, groupTools: true }, isTool))).toEqual([
			'a',
			'b',
			't',
			'c'
		]);
	});
});
