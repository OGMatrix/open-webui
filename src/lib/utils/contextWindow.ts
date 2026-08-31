/**
 * Working out how large a model's context window is.
 *
 * Open WebUI only knows a threshold when context compaction is switched on, so
 * without this the usage bar has nothing to fill against. Every provider states
 * the size somewhere different, and the backend keeps each provider's raw model
 * object, so the numbers are already on the client:
 *
 *   num_ctx                     an explicit setting always wins
 *   context_length              OpenRouter, and most OpenAI-compatible gateways
 *   max_context_length          LM Studio
 *   meta.n_ctx_train            llama.cpp /v1/models
 *   n_ctx                       llama.cpp /props (what the server actually serves)
 *   model_info['*.context_length']  Ollama /api/show
 */

const toWindow = (value: unknown): number | null => {
	const parsed = typeof value === 'string' ? Number(value) : value;
	return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0
		? Math.trunc(parsed)
		: null;
};

const firstWindow = (...values: unknown[]): number | null => {
	for (const value of values) {
		const window = toWindow(value);
		if (window) {
			return window;
		}
	}
	return null;
};

/** Ollama reports it under an architecture-prefixed key, e.g. qwen3.context_length. */
const fromOllamaModelInfo = (modelInfo: unknown): number | null => {
	if (!modelInfo || typeof modelInfo !== 'object') {
		return null;
	}
	for (const [key, value] of Object.entries(modelInfo as Record<string, unknown>)) {
		if (key.endsWith('.context_length') || key === 'context_length') {
			const window = toWindow(value);
			if (window) {
				return window;
			}
		}
	}
	return null;
};

type ModelLike = Record<string, any> | null | undefined;

/**
 * The context window for a model, or null when nothing states it.
 *
 * `params` are the chat's own settings and outrank anything the provider says:
 * a user who pinned num_ctx means it.
 */
export const getContextWindow = (
	model: ModelLike,
	params: Record<string, any> | null = null,
	probed: number | null = null
): number | null => {
	const explicit = firstWindow(params?.num_ctx, model?.info?.params?.num_ctx);
	if (explicit) {
		return explicit;
	}

	// What the serving process reported for the model it actually loaded.
	if (probed) {
		return probed;
	}

	return firstWindow(
		model?.context_length,
		model?.max_context_length,
		model?.max_model_len,
		model?.meta?.n_ctx_train,
		model?.meta?.n_ctx,
		model?.n_ctx,
		model?.ollama?.model_info ? fromOllamaModelInfo(model.ollama.model_info) : null,
		fromOllamaModelInfo(model?.model_info),
		model?.info?.meta?.context_length
	);
};
