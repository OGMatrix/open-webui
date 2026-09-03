import { describe, expect, it } from 'vitest';
import { loadState, reportsLoadState, unloadsAt } from './modelLoaded';

describe('reading a load state', () => {
	it('reads the two states a provider can state', () => {
		expect(loadState({ loaded: true })).toBe('loaded');
		expect(loadState({ loaded: false })).toBe('unloaded');
	});

	it('does not turn silence into a no', () => {
		// The backend omits the field for anything that has no such notion - a
		// hosted API, an agent. Reading that as "not loaded" would put a claim on
		// screen that nobody made.
		expect(loadState({})).toBe('unknown');
		expect(loadState({ loaded: null })).toBe('unknown');
		expect(loadState(null)).toBe('unknown');
		expect(loadState(undefined)).toBe('unknown');
	});

	it('knows when there is something worth drawing', () => {
		expect(reportsLoadState({ loaded: false })).toBe(true);
		expect(reportsLoadState({})).toBe(false);
	});
});

describe('when Ollama will drop the model', () => {
	const now = 1_800_000_000_000;

	it('reads a keep-alive that is still ahead', () => {
		const at = unloadsAt({ loaded: true, ollama: { expires_at: now / 1000 + 300 } }, now);
		expect(at?.getTime()).toBe(now + 300_000);
	});

	it('says nothing about one that has already passed', () => {
		// The list is only as fresh as the last fetch, and a stale expiry is the
		// value most likely to be wrong. "Unloads in -3 minutes" is worse than
		// saying nothing at all.
		expect(unloadsAt({ loaded: true, ollama: { expires_at: now / 1000 - 60 } }, now)).toBeNull();
	});

	it('says nothing when there is no keep-alive to read', () => {
		expect(unloadsAt({ loaded: true }, now)).toBeNull();
		expect(unloadsAt({ loaded: true, ollama: {} }, now)).toBeNull();
		expect(unloadsAt({ loaded: true, ollama: { expires_at: null } }, now)).toBeNull();
		expect(unloadsAt(null, now)).toBeNull();
	});

	it('survives a nonsense expiry', () => {
		expect(unloadsAt({ ollama: { expires_at: NaN } }, now)).toBeNull();
		expect(unloadsAt({ ollama: { expires_at: Infinity } }, now)).toBeNull();
	});
});
