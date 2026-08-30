/**
 * Which reasoning ("thinking") controls a model offers, and how its provider
 * expects the choice to be sent.
 *
 * Three transports cover the providers Open WebUI talks to today:
 *
 *  - `reasoning_effort` — OpenAI (o-series, gpt-5), Azure, Gemini and
 *    OpenAI-compatible gateways. The backend also converts it for Anthropic.
 *  - `think` — Ollama's own root parameter. A boolean for most models, and
 *    a level for the ones that accept one.
 *  - `chat_template_kwargs.enable_thinking` — llama.cpp, vLLM and friends,
 *    where thinking is a switch inside the chat template. Sent through
 *    `custom_params`, which the backend merges into the request body.
 */

export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export type ReasoningTransport = 'reasoning_effort' | 'ollama_think' | 'chat_template';

export type ReasoningMode = {
	transport: ReasoningTransport;
	levels: ReasoningLevel[];
};

// Only the fields actually used for detection: widening this to the full Model
// type would drag in shapes that differ between providers.
type ModelLike =
	| { id?: string; name?: string; owned_by?: string; info?: { meta?: { capabilities?: any } } }
	| null
	| undefined;

/**
 * What the provider itself says about the model, where it can be asked.
 * Ollama reports this on /api/show; OpenAI-shaped APIs advertise nothing, so
 * there the name patterns below remain the only signal.
 */
export type ReasoningHints = {
	/** Provider-reported support. Undefined means "was not able to ask". */
	thinking?: boolean;
};

const EFFORT_LEVELS: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high'];
// gpt-5 also takes an extra-high step. Providers reject efforts they do not
// know, so this stays on the family that documents it.
const GPT5_LEVELS: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const GRADED_LEVELS: ReasoningLevel[] = ['off', 'low', 'medium', 'high'];
const SWITCH_LEVELS: ReasoningLevel[] = ['off', 'high'];

// Families that take a graded effort on an OpenAI-shaped request.
const EFFORT_PATTERNS: { pattern: RegExp; levels: ReasoningLevel[] }[] = [
	// gpt-5 and o3/o4 accept the full range including "minimal".
	{ pattern: /(^|[/:-])gpt-5/, levels: GPT5_LEVELS },
	{ pattern: /(^|[/:-])o[34]([-.]|$)/, levels: EFFORT_LEVELS },
	// o1 predates "minimal".
	{ pattern: /(^|[/:-])o1([-.]|$)/, levels: ['low', 'medium', 'high'] },
	// Anthropic extended thinking; the backend maps effort onto it.
	{ pattern: /claude.*(3[.-]7|-4|opus-4|sonnet-4|haiku-4)/, levels: GRADED_LEVELS },
	{ pattern: /(^|[/:-])gemini-(2\.5|3)/, levels: GRADED_LEVELS },
	// Ollama's gpt-oss takes a level rather than a boolean.
	{ pattern: /(^|[/:-])gpt-oss/, levels: ['low', 'medium', 'high'] }
];

// Open-weight families that expose thinking as an on/off switch.
const SWITCH_PATTERN =
	/(qwen-?3|qwq|deepseek-?r1|deepseek-?v3\.[1-9]|magistral|glm-?4\.[5-9]|glm-?z1|minimax-?m[12]|exaone-?deep|phi-4-reasoning|granite-?3\.[2-9]|nemotron|seed-oss|hunyuan-a13b|ernie-4\.5|kimi-k2-thinking|smollm3|reka-flash-3|olmo-?3)/;

const normalize = (model: ModelLike) => `${model?.id ?? ''} ${model?.name ?? ''}`.toLowerCase();

/**
 * Returns the reasoning controls for a model, or null when it has none.
 */
export const getReasoningMode = (
	model: ModelLike,
	hints: ReasoningHints | null = null
): ReasoningMode | null => {
	if (!model) {
		return null;
	}

	const haystack = normalize(model);
	const isOllama = model.owned_by === 'ollama';

	// An explicit per-model capability wins over everything: it is the only way
	// to correct a wrong guess for a provider that cannot be asked.
	const declared = model.info?.meta?.capabilities?.reasoning;
	// Then whatever the provider reported, then the name patterns.
	const known = declared ?? hints?.thinking;

	if (known === false) {
		return null;
	}

	for (const { pattern, levels } of EFFORT_PATTERNS) {
		if (pattern.test(haystack)) {
			// Ollama carries the same choice on its own parameter.
			return {
				transport: isOllama ? 'ollama_think' : 'reasoning_effort',
				levels
			};
		}
	}

	if (known === true || SWITCH_PATTERN.test(haystack)) {
		// Nothing said which levels, so offer the switch every thinking model has.
		return {
			transport: isOllama ? 'ollama_think' : 'chat_template',
			levels: SWITCH_LEVELS
		};
	}

	return null;
};

const stripEmpty = (value: Record<string, unknown>) =>
	Object.keys(value).length > 0 ? value : undefined;

/**
 * Reads the level currently set on a chat's params, defaulting to unset (null)
 * so the provider's own default is used.
 */
export const readReasoningLevel = (
	params: Record<string, any> | null | undefined,
	mode: ReasoningMode | null
): ReasoningLevel | null => {
	if (!params || !mode) {
		return null;
	}

	if (mode.transport === 'reasoning_effort') {
		const effort = params.reasoning_effort;
		return REASONING_LEVELS.includes(effort) ? effort : null;
	}

	if (mode.transport === 'ollama_think') {
		const think = params.think;
		if (think === true) return 'high';
		if (think === false) return 'off';
		return REASONING_LEVELS.includes(think) ? think : null;
	}

	const enabled = params.custom_params?.chat_template_kwargs?.enable_thinking;
	if (enabled === true) return 'high';
	if (enabled === false) return 'off';
	return null;
};

/**
 * Writes the level onto a chat's params, clearing the keys the other
 * transports use so switching models cannot leave a stale one behind.
 * Passing null restores the provider's default.
 */
export const applyReasoningLevel = (
	params: Record<string, any> | null | undefined,
	mode: ReasoningMode | null,
	level: ReasoningLevel | null
): Record<string, any> => {
	const next: Record<string, any> = { ...(params ?? {}) };

	delete next.reasoning_effort;
	delete next.think;

	const customParams = { ...(next.custom_params ?? {}) };
	const templateKwargs = { ...(customParams.chat_template_kwargs ?? {}) };
	delete templateKwargs.enable_thinking;

	const remainingKwargs = stripEmpty(templateKwargs);
	if (remainingKwargs) {
		customParams.chat_template_kwargs = remainingKwargs;
	} else {
		delete customParams.chat_template_kwargs;
	}

	if (!mode || level === null) {
		const remaining = stripEmpty(customParams);
		if (remaining) {
			next.custom_params = remaining;
		} else {
			delete next.custom_params;
		}
		return next;
	}

	if (mode.transport === 'reasoning_effort') {
		next.reasoning_effort = level;
	} else if (mode.transport === 'ollama_think') {
		if (level === 'off') {
			next.think = false;
		} else if (mode.levels.length > 2) {
			// Models that accept a graded level (gpt-oss) take the word itself.
			next.think = level;
		} else {
			// Everything else is an on/off switch.
			next.think = true;
		}
	} else {
		customParams.chat_template_kwargs = {
			...(customParams.chat_template_kwargs ?? {}),
			enable_thinking: level !== 'off'
		};
	}

	const remaining = stripEmpty(customParams);
	if (remaining) {
		next.custom_params = remaining;
	} else {
		delete next.custom_params;
	}

	return next;
};
