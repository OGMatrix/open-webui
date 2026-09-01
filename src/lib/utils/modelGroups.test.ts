import { describe, expect, it } from 'vitest';
import { groupModels } from './modelGroups';

/** The rendered list, written as "= Header" and "- model". */
const render = (names: string[]) =>
	groupModels(names, (name) => name).rows.map((row) =>
		row.kind === 'header' ? `= ${row.label}` : `- ${row.item}`
	);

describe('groupModels', () => {
	it('names a family once instead of on every line', () => {
		expect(
			render([
				'nemotron-3-nano-30b-q8-max',
				'nomic-embed-text-v1.5-32k',
				'qwen3.8-27b-128k',
				'qwen3.8-27b-256k',
				'qwen3.8-27b-32k',
				'qwen3.8-27b-64k',
				'qwen3.8-27b-mtp-256k',
				'qwen3.8-flash-next-256k'
			])
		).toEqual([
			'- nemotron-3-nano-30b-q8-max',
			'- nomic-embed-text-v1.5-32k',
			'= qwen3.8',
			'- qwen3.8-27b-128k',
			'- qwen3.8-27b-256k',
			'- qwen3.8-27b-32k',
			'- qwen3.8-27b-64k',
			'- qwen3.8-27b-mtp-256k',
			'- qwen3.8-flash-next-256k'
		]);
	});

	it('leaves a list with no families untouched', () => {
		expect(render(['llama-3-70b', 'mistral-large', 'gemma-2'])).toEqual([
			'- llama-3-70b',
			'- mistral-large',
			'- gemma-2'
		]);
	});

	it('does not call a pair of one a family', () => {
		expect(render(['solo-model'])).toEqual(['- solo-model']);
	});

	it('keeps the order it was given', () => {
		const names = ['zeta-1', 'zeta-2', 'alpha-1', 'alpha-2'];
		const models = render(names).filter((row) => row.startsWith('- '));
		expect(models).toEqual(['- zeta-1', '- zeta-2', '- alpha-1', '- alpha-2']);
	});

	it('only groups models that sit next to each other', () => {
		// A family split by an unrelated model is two runs, not one.
		expect(render(['qwen-a', 'llama-x', 'qwen-b', 'qwen-c'])).toEqual([
			'- qwen-a',
			'- llama-x',
			'= qwen',
			'- qwen-b',
			'- qwen-c'
		]);
	});

	it('trims a separator off the end of a heading', () => {
		const [header] = render(['gpt-4o-mini', 'gpt-4o-turbo']);
		expect(header).toBe('= gpt-4o');
	});

	it('reports where each model sits, headers counted', () => {
		const { rowIndexOfModel } = groupModels(['solo', 'qwen-a', 'qwen-b'], (name) => name);
		// solo at row 0, header at row 1, then the two qwen models.
		expect(rowIndexOfModel).toEqual([0, 2, 3]);
	});

	it('every model appears exactly once', () => {
		const names = ['a-1', 'a-2', 'b-1', 'c', 'd-1', 'd-2', 'd-3'];
		const { rows, rowIndexOfModel } = groupModels(names, (name) => name);
		const models = rows.filter((row) => row.kind === 'model');
		expect(models).toHaveLength(names.length);
		expect(rowIndexOfModel).toHaveLength(names.length);
		rowIndexOfModel.forEach((rowIndex, modelIndex) => {
			const row = rows[rowIndex];
			expect(row.kind).toBe('model');
			expect(row.kind === 'model' && row.item).toBe(names[modelIndex]);
		});
	});

	it('survives blank names', () => {
		expect(render(['', '', 'qwen-a', 'qwen-b'])).toEqual([
			'- ',
			'- ',
			'= qwen',
			'- qwen-a',
			'- qwen-b'
		]);
	});

	it('lets the caller write the heading', () => {
		const { rows } = groupModels(
			['qwen-a', 'qwen-b'],
			(name) => name,
			(prefix) => `${prefix} family`
		);
		expect(rows[0]).toMatchObject({ kind: 'header', label: 'qwen family' });
	});

	it('drops a heading the caller declines to name', () => {
		const { rows } = groupModels(
			['qwen-a', 'qwen-b'],
			(name) => name,
			() => ''
		);
		expect(rows.every((row) => row.kind === 'model')).toBe(true);
	});

	it('copes with a long list without pathological cost', () => {
		const many = Array.from({ length: 600 }, (_, i) => `family-${Math.floor(i / 10)}-model-${i}`);
		const started = Date.now();
		const { rows } = groupModels(many, (name) => name);
		expect(rows.filter((row) => row.kind === 'model')).toHaveLength(600);
		expect(Date.now() - started).toBeLessThan(1000);
	});
});
