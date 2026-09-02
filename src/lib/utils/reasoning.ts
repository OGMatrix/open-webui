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

// Ascending. 'off' is our name for what gateways call 'none'.
export const REASONING_LEVELS = [
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max'
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export type ReasoningTransport =
	| 'reasoning_effort'
	| 'ollama_think'
	| 'chat_template'
	/** llama.cpp: the template switches thinking off, reasoning_effort grades it. */
	| 'llamacpp_effort';

export type ReasoningMode = {
	transport: ReasoningTransport;
	levels: ReasoningLevel[];
};

// Only the fields actually used for detection: widening this to the full Model
// type would drag in shapes that differ between providers.
type ModelLike =
	| {
			id?: string;
			name?: string;
			owned_by?: string;
			/** Gateways such as OpenRouter list what a model accepts. The backend
			    keeps the provider's raw model object, so this arrives as-is. */
			supported_parameters?: unknown;
			/** OpenRouter states the exact efforts a model takes. */
			reasoning?: unknown;
			info?: { meta?: { capabilities?: any } };
	  }
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
	/** Context window the serving process reported, where it states one. */
	contextLength?: number;
	/**
	 * The exact effort levels this model accepts, in the order it names them.
	 *
	 * A llama.cpp chat template that takes an effort has to reject the words it
	 * does not know, so it carries its own list; the backend reads it from the
	 * template rather than anyone guessing from the model's name.
	 */
	levels?: string[];
	/** The level the model falls back to when none is set. */
	defaultLevel?: string;
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

/**
 * OpenRouter carries a `reasoning` object per model stating the efforts it
 * actually accepts. That beats guessing from the name, so it is read first.
 * Verified against their public catalogue: the values in the wild are
 * none, minimal, low, medium, high, xhigh and max, listed in no fixed order.
 */
const fromDeclaredReasoning = (declared: unknown): ReasoningMode | null => {
	if (!declared || typeof declared !== 'object') {
		return null;
	}

	const payload = declared as Record<string, unknown>;
	const efforts = payload.supported_efforts;

	if (!Array.isArray(efforts) || efforts.length === 0) {
		// It says thinking is compulsory but not which efforts: offer no switch,
		// since turning it off is not on the table.
		return payload.mandatory === true ? { transport: 'reasoning_effort', levels: ['high'] } : null;
	}

	// Their order varies; ours is always ascending so the menu reads sensibly.
	const levels = REASONING_LEVELS.filter(
		(level) => efforts.includes(level) || (level === 'off' && efforts.includes('none'))
	);

	if (levels.length === 0) {
		return null;
	}

	// A model that must reason cannot be switched off, whatever it lists.
	const usable = payload.mandatory === true ? levels.filter((level) => level !== 'off') : levels;

	return usable.length > 0 ? { transport: 'reasoning_effort', levels: usable } : null;
};

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

	// What the gateway states about this exact model outranks the name patterns.
	const stated = fromDeclaredReasoning(model.reasoning);
	if (stated) {
		return stated;
	}

	// Levels the serving process reported for this model beat every guess below:
	// they come from the template that will actually reject anything else.
	const reported = (hints?.levels ?? []).filter((level): level is ReasoningLevel =>
		(REASONING_LEVELS as readonly string[]).includes(level)
	);
	if (reported.length > 0) {
		// Thinking is switched off through the template, not through an effort
		// word the template would refuse, so "off" leads and the rest follow in
		// the order the model named them.
		return {
			transport: 'llamacpp_effort',
			levels: ['off', ...reported.filter((level) => level !== 'off')]
		};
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

	// Gateways that advertise their parameters are authoritative for anything the
	// patterns above did not already pin down to a specific ladder.
	const declaredParams = model.supported_parameters;
	if (Array.isArray(declaredParams)) {
		const advertised = declaredParams.some(
			(param) => param === 'reasoning' || param === 'reasoning_effort'
		);
		if (advertised) {
			return { transport: 'reasoning_effort', levels: GRADED_LEVELS };
		}
		// It listed its parameters and reasoning was not among them.
		if (known !== true) {
			return null;
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

	if (mode.transport === 'llamacpp_effort') {
		if (params.custom_params?.chat_template_kwargs?.enable_thinking === false) {
			return 'off';
		}
		const effort = params.reasoning_effort;
		return mode.levels.includes(effort) ? effort : null;
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

	if (mode.transport === 'llamacpp_effort') {
		if (level === 'off') {
			// The effort word would be rejected; the template is what switches it off.
			customParams.chat_template_kwargs = {
				...(customParams.chat_template_kwargs ?? {}),
				enable_thinking: false
			};
		} else {
			next.reasoning_effort = level;
		}
	} else if (mode.transport === 'reasoning_effort') {
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
