/**
 * Saying which backend a model comes from, but only when that is news.
 *
 * A connection's provider is already known to the model list; what was missing
 * is any sign of it in the picker, so an agent behind a Hermes connection reads
 * exactly like a chat model behind an OpenAI-compatible one. They behave
 * differently, and the list should say so before you pick.
 *
 * The label is withheld when every model shares one provider. A column of forty
 * rows each stamped "llama.cpp" says nothing that the single configured
 * connection did not already say, and the noise costs more than the fact. Same
 * rule as the family headings: a distinction that never varies is not one.
 */

/**
 * Providers a connection can declare, and what to call them on a row.
 *
 * Short forms on purpose. These sit beside a model name in a narrow dropdown,
 * and a badge reading "Hermes Agent" takes room from the thing being chosen.
 * The connection settings still spell them out in full.
 */
export const PROVIDER_LABELS: Record<string, string> = {
	azure: 'Azure',
	hermes: 'Hermes',
	'llama.cpp': 'llama.cpp',
	litellm: 'LiteLLM',
	lmstudio: 'LM Studio'
};

/** The spellings that reach us for one provider, folded into one key. */
export const normalizeProvider = (provider: string | null | undefined): string => {
	const value = (provider ?? '').trim().toLowerCase();
	if (value === 'lm studio' || value === 'lm-studio') return 'lmstudio';
	if (value === 'hermes agent' || value === 'hermes-agent') return 'hermes';
	if (value === 'llamacpp' || value === 'llama-cpp') return 'llama.cpp';
	return value;
};

/**
 * What to call a provider.
 *
 * An unknown one is passed through rather than dropped: a connection can be
 * given any provider string, and showing what was configured beats showing
 * nothing at all.
 */
export const providerLabel = (provider: string | null | undefined): string => {
	const key = normalizeProvider(provider);
	return PROVIDER_LABELS[key] ?? (provider ?? '').trim();
};

/**
 * Which providers in a list are worth naming on each row.
 *
 * Models with no provider count as their own kind — a mix of plain
 * OpenAI-compatible endpoints and one Hermes connection is still a mix, and it
 * is the Hermes rows that need saying. They are the ones that get a label; the
 * unset ones have nothing to be labelled with.
 */
export const namedProviders = (providers: (string | null | undefined)[]): Set<string> => {
	const kinds = new Set(providers.map(normalizeProvider));
	if (kinds.size < 2) {
		return new Set();
	}
	kinds.delete('');
	return kinds;
};
