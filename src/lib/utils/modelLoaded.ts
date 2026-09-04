/**
 * Whether a model is loaded, as far as its provider will say.
 *
 * Three states, not two, and the third is the point. Ollama always answers,
 * because a running model has an expiry; llama.cpp and LM Studio answer when
 * they know; every hosted API and every agent answers not at all, and there is
 * nothing to be loaded there in the first place.
 *
 * The backend already keeps that distinction — it omits the field rather than
 * guessing false — so anything reading it has to keep it too. A grey "not
 * loaded" dot on an OpenAI model would be a claim nobody made.
 */

export type LoadState = 'loaded' | 'unloaded' | 'unknown';

type MaybeModel =
	| {
			loaded?: boolean | null;
			ollama?: { expires_at?: number | null } | null;
	  }
	| null
	| undefined;

export const loadState = (model: MaybeModel): LoadState => {
	if (model?.loaded === true) {
		return 'loaded';
	}
	if (model?.loaded === false) {
		return 'unloaded';
	}
	return 'unknown';
};

/** True when the state is worth drawing at all. */
export const reportsLoadState = (model: MaybeModel): boolean => loadState(model) !== 'unknown';

/**
 * When Ollama intends to drop the model, if it said so and it has not passed.
 *
 * A keep-alive that has already expired is not a future event, and showing it
 * as one ("unloads in -3 minutes") is worse than showing nothing: the list is
 * only as fresh as the last fetch, and a stale expiry is exactly the value
 * most likely to be wrong.
 */
export const unloadsAt = (model: MaybeModel, now: number = Date.now()): Date | null => {
	const seconds = model?.ollama?.expires_at;
	if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
		return null;
	}
	const at = seconds * 1000;
	return at > now ? new Date(at) : null;
};
