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

	it('prefers what the provider reported over the name patterns', () => {
		// A thinking model Ollama does not advertise as one.
		expect(getReasoningMode(model('qwen3:32b', 'ollama'), { thinking: false })).toBeNull();
		// And one whose name gives nothing away.
		expect(getReasoningMode(model('my-custom-model', 'ollama'), { thinking: true })).toEqual({
			transport: 'ollama_think',
			levels: ['off', 'high']
		});
	});

	it('lets an explicit model capability override everything', () => {
		const forcedOn = {
			id: 'mystery-model',
			owned_by: 'openai',
			info: { meta: { capabilities: { reasoning: true } } }
		};
		expect(getReasoningMode(forcedOn)?.transport).toBe('chat_template');

		const forcedOff = {
			id: 'gpt-5',
			owned_by: 'openai',
			info: { meta: { capabilities: { reasoning: false } } }
		};
		expect(getReasoningMode(forcedOff)).toBeNull();

		// An explicit capability beats a provider report that disagrees.
		expect(getReasoningMode(forcedOn, { thinking: false })).not.toBeNull();
	});

	it('uses the exact efforts a gateway states for a model', () => {
		// Shapes taken verbatim from OpenRouter's public catalogue.
		expect(
			getReasoningMode({
				id: 'tencent/hy4-preview',
				reasoning: {
					mandatory: false,
					default_enabled: true,
					supported_efforts: ['high', 'low', 'none'],
					default_effort: 'high'
				}
			})
		).toEqual({ transport: 'reasoning_effort', levels: ['off', 'low', 'high'] });
	});

	it('sorts the stated efforts ascending whatever order they arrive in', () => {
		expect(
			getReasoningMode({
				id: 'some/model',
				reasoning: { supported_efforts: ['max', 'xhigh', 'high', 'medium', 'low'] }
			})?.levels
		).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
	});

	it('drops the off option for a model that must reason', () => {
		expect(
			getReasoningMode({
				id: 'some/model',
				reasoning: { mandatory: true, supported_efforts: ['none', 'low', 'high'] }
			})?.levels
		).toEqual(['low', 'high']);
	});

	it('still offers a control when reasoning is compulsory but unspecified', () => {
		// 33 models in the catalogue look like this.
		expect(
			getReasoningMode({ id: 'liquid/lfm-2.5-2.6b:free', reasoning: { mandatory: true } })
		).toEqual({ transport: 'reasoning_effort', levels: ['high'] });
	});

	it('ignores a reasoning object that states nothing useful', () => {
		expect(getReasoningMode({ id: 'plain/model', reasoning: { mandatory: false } })).toBeNull();
		expect(getReasoningMode({ id: 'plain/model', reasoning: null })).toBeNull();
	});

	it('lets stated efforts beat the name patterns', () => {
		// The pattern would give gpt-5 its own ladder; the gateway knows better.
		expect(
			getReasoningMode({
				id: 'openai/gpt-5',
				reasoning: { supported_efforts: ['low', 'high'] }
			})?.levels
		).toEqual(['low', 'high']);
	});

	it('believes a gateway that lists its supported parameters', () => {
		// OpenRouter ships this on every model in its catalogue.
		const withReasoning = {
			id: 'z-ai/glm-4.6',
			owned_by: 'openai',
			supported_parameters: ['temperature', 'top_p', 'reasoning', 'tools']
		};
		expect(getReasoningMode(withReasoning)).toEqual({
			transport: 'reasoning_effort',
			levels: ['off', 'low', 'medium', 'high']
		});

		// Listed its parameters, and reasoning was not one of them.
		const without = {
			id: 'meta-llama/llama-3.3-70b-instruct',
			owned_by: 'openai',
			supported_parameters: ['temperature', 'top_p', 'tools']
		};
		expect(getReasoningMode(without)).toBeNull();
	});

	it('keeps a specific ladder over the gateway’s generic one', () => {
		const gpt5 = {
			id: 'openai/gpt-5',
			owned_by: 'openai',
			supported_parameters: ['reasoning']
		};
		expect(getReasoningMode(gpt5)?.levels).toContain('xhigh');
	});

	it('still lets an explicit capability force it on', () => {
		const forced = {
			id: 'some/model',
			owned_by: 'openai',
			supported_parameters: ['temperature'],
			info: { meta: { capabilities: { reasoning: true } } }
		};
		expect(getReasoningMode(forced)).not.toBeNull();
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
