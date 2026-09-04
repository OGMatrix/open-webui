import { describe, expect, it } from 'vitest';
import { namedProviders, normalizeProvider, providerLabel } from './modelProviders';

describe('folding the spellings of a provider', () => {
	it('accepts the forms a connection can be given', () => {
		expect(normalizeProvider('LM Studio')).toBe('lmstudio');
		expect(normalizeProvider('lm-studio')).toBe('lmstudio');
		expect(normalizeProvider('Hermes Agent')).toBe('hermes');
		expect(normalizeProvider('llamacpp')).toBe('llama.cpp');
	});

	it('treats nothing at all as nothing', () => {
		expect(normalizeProvider('')).toBe('');
		expect(normalizeProvider('   ')).toBe('');
		expect(normalizeProvider(null)).toBe('');
		expect(normalizeProvider(undefined)).toBe('');
	});
});

describe('what to call a provider', () => {
	it('names the ones a connection can be configured with', () => {
		expect(providerLabel('hermes')).toBe('Hermes');
		expect(providerLabel('lmstudio')).toBe('LM Studio');
		expect(providerLabel('azure')).toBe('Azure');
	});

	it('passes an unknown one through instead of dropping it', () => {
		// The field takes any string. Showing what was configured beats showing
		// nothing, and a blank badge would be a bug that looks like a design.
		expect(providerLabel('vllm')).toBe('vllm');
		expect(providerLabel('')).toBe('');
	});
});

describe('which providers earn a label', () => {
	it('says nothing when every model comes from the same place', () => {
		// One connection, forty rows, forty identical badges: noise for a fact
		// the list never varies on.
		expect(namedProviders(['llama.cpp', 'llama.cpp', 'llama.cpp'])).toEqual(new Set());
		expect(namedProviders(['', '', ''])).toEqual(new Set());
		expect(namedProviders([])).toEqual(new Set());
	});

	it('names them once the list is mixed', () => {
		expect(namedProviders(['hermes', 'llama.cpp'])).toEqual(new Set(['hermes', 'llama.cpp']));
	});

	it('counts models with no provider as their own kind', () => {
		// Plain OpenAI-compatible endpoints alongside one Hermes connection is a
		// mix, and it is the Hermes rows that need saying.
		expect(namedProviders(['', '', 'hermes'])).toEqual(new Set(['hermes']));
	});

	it('does not try to label the ones that have nothing to be labelled with', () => {
		expect(namedProviders(['', 'hermes']).has('')).toBe(false);
	});

	it('folds spellings before deciding, so one provider is not read as two', () => {
		expect(namedProviders(['LM Studio', 'lmstudio'])).toEqual(new Set());
	});
});
