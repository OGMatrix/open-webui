import { describe, expect, it } from 'vitest';
import {
	applyReasoningLevel,
	getReasoningMode,
	readReasoningLevel,
	type ReasoningMode
} from './reasoning';

const model = (id: string, owned_by = 'openai') => ({ id, name: id, owned_by });

describe('getReasoningMode', () => {
	it('gives OpenAI reasoning models a graded effort', () => {
		expect(getReasoningMode(model('gpt-5'))).toEqual({
			transport: 'reasoning_effort',
			levels: ['minimal', 'low', 'medium', 'high', 'xhigh']
		});
		expect(getReasoningMode(model('o3-mini'))?.levels).toContain('minimal');
	});

	it('keeps the extra-high step on the family that documents it', () => {
		expect(getReasoningMode(model('o3-mini'))?.levels).not.toContain('xhigh');
		expect(getReasoningMode(model('claude-sonnet-4'))?.levels).not.toContain('xhigh');
	});

	it('leaves "minimal" off o1, which predates it', () => {
		expect(getReasoningMode(model('o1-preview'))?.levels).toEqual(['low', 'medium', 'high']);
	});

	it('covers Anthropic and Gemini through the same parameter', () => {
		expect(getReasoningMode(model('claude-sonnet-4'))?.transport).toBe('reasoning_effort');
		expect(getReasoningMode(model('gemini-2.5-pro'))?.transport).toBe('reasoning_effort');
	});

	it('treats open-weight thinking models as a switch on the chat template', () => {
		// The local llama.cpp case.
		expect(getReasoningMode(model('qwen3.8-27b-mtp-256k'))).toEqual({
			transport: 'chat_template',
			levels: ['off', 'high']
		});
		expect(getReasoningMode(model('deepseek-r1:70b'))?.transport).toBe('chat_template');
	});

	it('routes the same models through Ollama’s own parameter', () => {
		expect(getReasoningMode(model('qwen3:32b', 'ollama'))?.transport).toBe('ollama_think');
		expect(getReasoningMode(model('gpt-oss:20b', 'ollama'))).toEqual({
			transport: 'ollama_think',
			levels: ['low', 'medium', 'high']
		});
	});

	it('returns nothing for models with no thinking mode', () => {
		expect(getReasoningMode(model('gpt-4o'))).toBeNull();
		expect(getReasoningMode(model('llama3.1:8b', 'ollama'))).toBeNull();
		expect(getReasoningMode(null)).toBeNull();
	});
});

describe('applyReasoningLevel', () => {
	const effort: ReasoningMode = { transport: 'reasoning_effort', levels: ['low', 'high'] };
	const think: ReasoningMode = { transport: 'ollama_think', levels: ['off', 'high'] };
	const graded: ReasoningMode = { transport: 'ollama_think', levels: ['low', 'medium', 'high'] };
	const template: ReasoningMode = { transport: 'chat_template', levels: ['off', 'high'] };

	it('writes the effort for OpenAI-shaped providers', () => {
		expect(applyReasoningLevel({}, effort, 'high')).toEqual({ reasoning_effort: 'high' });
	});

	it('writes a boolean for an Ollama switch and a word for a graded one', () => {
		expect(applyReasoningLevel({}, think, 'high')).toEqual({ think: true });
		expect(applyReasoningLevel({}, think, 'off')).toEqual({ think: false });
		expect(applyReasoningLevel({}, graded, 'medium')).toEqual({ think: 'medium' });
	});

	it('writes the chat template switch through custom_params', () => {
		expect(applyReasoningLevel({}, template, 'high')).toEqual({
			custom_params: { chat_template_kwargs: { enable_thinking: true } }
		});
		expect(applyReasoningLevel({}, template, 'off')).toEqual({
			custom_params: { chat_template_kwargs: { enable_thinking: false } }
		});
	});

	it('clears the other transports so switching models leaves nothing stale', () => {
		const stale = {
			reasoning_effort: 'high',
			think: true,
			custom_params: { chat_template_kwargs: { enable_thinking: true } }
		};
		expect(applyReasoningLevel(stale, effort, 'low')).toEqual({ reasoning_effort: 'low' });
		expect(applyReasoningLevel(stale, think, 'high')).toEqual({ think: true });
	});

	it('restores the provider default when set to null', () => {
		expect(applyReasoningLevel({ reasoning_effort: 'high' }, effort, null)).toEqual({});
		expect(applyReasoningLevel({ think: true }, think, null)).toEqual({});
	});

	it('keeps unrelated params and unrelated custom_params intact', () => {
		const params = {
			temperature: 0.7,
			custom_params: { chat_template_kwargs: { foo: 1 }, other: true }
		};
		expect(applyReasoningLevel(params, effort, 'high')).toEqual({
			temperature: 0.7,
			reasoning_effort: 'high',
			custom_params: { chat_template_kwargs: { foo: 1 }, other: true }
		});
	});

	it('does not mutate the params it was given', () => {
		const params = { reasoning_effort: 'high' };
		applyReasoningLevel(params, effort, 'low');
		expect(params).toEqual({ reasoning_effort: 'high' });
	});
});

describe('readReasoningLevel', () => {
	const effort: ReasoningMode = { transport: 'reasoning_effort', levels: ['low', 'high'] };
	const think: ReasoningMode = { transport: 'ollama_think', levels: ['off', 'high'] };
	const template: ReasoningMode = { transport: 'chat_template', levels: ['off', 'high'] };

	it('round-trips every transport', () => {
		for (const [mode, level] of [
			[effort, 'high'],
			[think, 'off'],
			[think, 'high'],
			[template, 'off'],
			[template, 'high']
		] as const) {
			expect(readReasoningLevel(applyReasoningLevel({}, mode, level), mode)).toBe(level);
		}
	});

	it('reports unset when nothing has been chosen', () => {
		expect(readReasoningLevel({}, effort)).toBeNull();
		expect(readReasoningLevel({ reasoning_effort: 'nonsense' }, effort)).toBeNull();
		expect(readReasoningLevel(null, effort)).toBeNull();
	});
});
