import { describe, expect, it } from 'vitest';
import { getContextWindow } from './contextWindow';

describe('getContextWindow', () => {
	it('lets an explicit chat setting win over everything', () => {
		expect(getContextWindow({ context_length: 8192 }, { num_ctx: 4096 }, 131072)).toBe(4096);
	});

	it('falls back to a model-level num_ctx', () => {
		expect(getContextWindow({ info: { params: { num_ctx: 16384 } }, context_length: 8192 })).toBe(
			16384
		);
	});

	it('prefers what the server reported over catalogue metadata', () => {
		// llama.cpp trained at 32k but started with -c 262144.
		expect(getContextWindow({ meta: { n_ctx_train: 32768 } }, null, 262144)).toBe(262144);
	});

	it('reads the gateway and provider shapes', () => {
		expect(getContextWindow({ context_length: 200000 })).toBe(200000);
		expect(getContextWindow({ max_context_length: 8192 })).toBe(8192);
		expect(getContextWindow({ max_model_len: 65536 })).toBe(65536);
		expect(getContextWindow({ meta: { n_ctx_train: 32768 } })).toBe(32768);
	});

	it('digs the architecture-prefixed key out of Ollama model info', () => {
		expect(
			getContextWindow({
				ollama: { model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 40960 } }
			})
		).toBe(40960);
	});

	it('reads --ctx-size from a llama.cpp router model entry', () => {
		// Shortened from a live router response.
		const model = {
			id: 'qwen3.8-27b-mtp-256k',
			owned_by: 'llamacpp',
			status: {
				value: 'loaded',
				args: [
					'llama-server',
					'--alias',
					'qwen3.8-27b-mtp-256k',
					'--batch-size',
					'4096',
					'--ctx-size',
					'262144',
					'--flash-attn',
					'on'
				]
			}
		};
		expect(getContextWindow(model)).toBe(262144);
	});

	it('accepts the short -c form', () => {
		expect(getContextWindow({ status: { args: ['llama-server', '-c', '32768'] } })).toBe(32768);
	});

	it('is unbothered by a trailing --ctx-size with no value', () => {
		expect(getContextWindow({ status: { args: ['llama-server', '--ctx-size'] } })).toBeNull();
	});

	it('still lets an explicit setting win over the command line', () => {
		const model = { status: { args: ['llama-server', '--ctx-size', '262144'] } };
		expect(getContextWindow(model, { num_ctx: 8192 })).toBe(8192);
	});

	it('reports nothing when no source states a size', () => {
		expect(getContextWindow({ id: 'gpt-4o' })).toBeNull();
		expect(getContextWindow(null)).toBeNull();
		expect(getContextWindow({}, {})).toBeNull();
	});

	it('ignores values that are not usable sizes', () => {
		expect(getContextWindow({ context_length: 0 })).toBeNull();
		expect(getContextWindow({ context_length: -1 })).toBeNull();
		expect(getContextWindow({ context_length: 'lots' })).toBeNull();
		expect(getContextWindow({}, { num_ctx: '' })).toBeNull();
	});

	it('accepts a numeric string, which is how settings arrive', () => {
		expect(getContextWindow({}, { num_ctx: '8192' })).toBe(8192);
	});
});
