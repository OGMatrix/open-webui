<script lang="ts">
	import { createEventDispatcher, getContext, onDestroy, tick } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { marked } from 'marked';
	import { fly } from 'svelte/transition';

	import MarkdownInlineTokens from '$lib/components/chat/Messages/Markdown/MarkdownInlineTokens.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Check from '$lib/components/icons/Check.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');
	const dispatch = createEventDispatcher();

	type AskUserOption = { label: string; description?: string; value?: string };

	type AskUserQuestion = {
		id: string;
		type?: 'select' | 'multiselect' | 'text' | 'number' | 'boolean';
		header: string;
		question: string;
		hint?: string;
		required?: boolean;
		options?: AskUserOption[];
		allow_other?: boolean;
		default?: unknown;
		// multiselect
		min_select?: number;
		max_select?: number;
		// text
		multiline?: boolean;
		placeholder?: string;
		format?: 'email' | 'uri' | 'date' | 'date-time';
		min_length?: number;
		max_length?: number;
		// number
		integer?: boolean;
		minimum?: number;
		maximum?: number;
		unit?: string;
		// boolean
		true_label?: string;
		false_label?: string;
	};

	type DraftAnswer =
		| { type: 'option'; option_index: number }
		| { type: 'options'; option_indexes: number[] }
		| { type: 'other'; text: string }
		| { type: 'text'; text: string }
		| { type: 'number'; number: number }
		| { type: 'boolean'; boolean: boolean }
		| { type: 'skipped' };

	export let show = false;
	export let questions: AskUserQuestion[] = [];
	export let allowOther = true;
	export let timeoutMs: number | null = null;

	let answers: Record<string, DraftAnswer> = {};
	let questionIndex = 0;
	let wasOpen = false;
	let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
	let card: HTMLElement | null = null;

	/** A whole-number range this short reads better as a row of buttons. */
	const SCALE_MAX_STEPS = 9;

	const kindOf = (question: AskUserQuestion) => question?.type ?? 'select';
	const isRequired = (question: AskUserQuestion) => question?.required !== false;
	const allowsOther = (question: AskUserQuestion) => question?.allow_other ?? allowOther;

	/** Seeds the answer a question arrives with, so the person only changes what they disagree with. */
	const seedFromDefault = (question: AskUserQuestion): DraftAnswer | null => {
		const fallback = question.default;
		switch (kindOf(question)) {
			case 'select': {
				const index = (question.options ?? []).findIndex(
					(option) => (option.value ?? option.label) === fallback
				);
				return index >= 0 ? { type: 'option', option_index: index } : null;
			}
			case 'multiselect': {
				if (!Array.isArray(fallback)) return null;
				const indexes = (question.options ?? [])
					.map((option, index) => (fallback.includes(option.value ?? option.label) ? index : -1))
					.filter((index) => index >= 0);
				return indexes.length ? { type: 'options', option_indexes: indexes } : null;
			}
			case 'text':
				return typeof fallback === 'string' && fallback ? { type: 'text', text: fallback } : null;
			case 'number':
				return typeof fallback === 'number' ? { type: 'number', number: fallback } : null;
			case 'boolean':
				return { type: 'boolean', boolean: fallback === true };
			default:
				return null;
		}
	};

	const clearAutoCancel = () => {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
			timeoutHandle = null;
		}
	};

	const cancel = () => {
		clearAutoCancel();
		show = false;
		dispatch('cancel');
	};

	const decline = () => {
		clearAutoCancel();
		show = false;
		dispatch('confirm', { status: 'declined', answers: {} });
	};

	$: if (show && !wasOpen) {
		answers = {};
		for (const question of questions) {
			const seeded = seedFromDefault(question);
			if (seeded) answers[question.id] = seeded;
		}
		questionIndex = 0;
		wasOpen = true;
		clearAutoCancel();
		if (typeof timeoutMs === 'number' && timeoutMs > 0) {
			timeoutHandle = setTimeout(cancel, timeoutMs);
		}
		// The card takes focus so its shortcuts work without stealing the chat input.
		tick().then(() => card?.focus());
	}

	$: if (!show && wasOpen) {
		clearAutoCancel();
		wasOpen = false;
	}

	onDestroy(clearAutoCancel);

	$: question = questions[questionIndex];
	$: draft = question ? answers[question.id] : undefined;

	/** The option the model put forward, which is the default when it named one. */
	$: recommendedIndex = (() => {
		if (!question || kindOf(question) !== 'select') return -1;
		const named = (question.options ?? []).findIndex(
			(option) => (option.value ?? option.label) === question.default
		);
		return named >= 0 ? named : 0;
	})();

	$: scaleSteps = (() => {
		if (!question || kindOf(question) !== 'number' || !question.integer) return null;
		const { minimum, maximum } = question;
		if (typeof minimum !== 'number' || typeof maximum !== 'number') return null;
		const count = maximum - minimum + 1;
		return count >= 2 && count <= SCALE_MAX_STEPS
			? Array.from({ length: count }, (_, step) => minimum + step)
			: null;
	})();

	/** Why a question is not yet answerable, or an empty string when it is. */
	const problemWith = (question: AskUserQuestion, answer?: DraftAnswer): string => {
		if (!answer) {
			return isRequired(question) ? $i18n.t('An answer is needed') : '';
		}
		if (answer.type === 'skipped') return '';

		if (answer.type === 'other' || answer.type === 'text') {
			const text = answer.text.trim();
			if (!text) return $i18n.t('An answer is needed');
			if (answer.type === 'text' && question.min_length && text.length < question.min_length) {
				return $i18n.t('Minimum length: {{count}}', { count: question.min_length });
			}
			return '';
		}
		if (answer.type === 'options') {
			const count = answer.option_indexes.length;
			const least = question.min_select ?? 1;
			const most = question.max_select ?? (question.options ?? []).length;
			if (count < least) return $i18n.t('Choose at least {{count}}', { count: least });
			if (count > most) return $i18n.t('Choose at most {{count}}', { count: most });
			return '';
		}
		if (answer.type === 'number') {
			const value = answer.number;
			if (!Number.isFinite(value)) return $i18n.t('A number is needed');
			if (question.integer && !Number.isInteger(value)) return $i18n.t('Whole numbers only');
			if (typeof question.minimum === 'number' && value < question.minimum) {
				return $i18n.t('At least {{value}}', { value: question.minimum });
			}
			if (typeof question.maximum === 'number' && value > question.maximum) {
				return $i18n.t('At most {{value}}', { value: question.maximum });
			}
			return '';
		}
		return '';
	};

	$: problem = question ? problemWith(question, draft) : '';
	$: canAdvance = problem === '';
	$: allAnswered = questions.every((item) => problemWith(item, answers[item.id]) === '');
	$: isLast = questionIndex >= questions.length - 1;

	const setAnswer = (question: AskUserQuestion, answer: DraftAnswer | null) => {
		const next = { ...answers };
		if (answer) next[question.id] = answer;
		else delete next[question.id];
		answers = next;
	};

	const chooseOption = (question: AskUserQuestion, index: number) => {
		setAnswer(question, { type: 'option', option_index: index });
		// A single choice is the whole answer, so move straight on.
		tick().then(() => advance());
	};

	const toggleOption = (question: AskUserQuestion, index: number) => {
		const current = draft?.type === 'options' ? draft.option_indexes : [];
		const most = question.max_select ?? (question.options ?? []).length;
		let next: number[];
		if (current.includes(index)) {
			next = current.filter((item) => item !== index);
		} else {
			// At the ceiling the oldest pick makes way, rather than the click doing nothing.
			next = current.length >= most ? [...current.slice(1), index] : [...current, index];
		}
		setAnswer(question, next.length ? { type: 'options', option_indexes: next } : null);
	};

	const skip = (question: AskUserQuestion) => {
		setAnswer(question, { type: 'skipped' });
		tick().then(() => advance());
	};

	const submit = () => {
		if (!allAnswered) return;
		clearAutoCancel();
		show = false;
		dispatch('confirm', { status: 'answered', answers });
	};

	const advance = () => {
		if (!canAdvance) return;
		if (!isLast) questionIndex += 1;
		else submit();
	};

	const inputType = (question: AskUserQuestion) => {
		switch (question.format) {
			case 'email':
				return 'email';
			case 'uri':
				return 'url';
			case 'date':
				return 'date';
			case 'date-time':
				return 'datetime-local';
			default:
				return 'text';
		}
	};

	const inline = (text: string) => marked.Lexer.lexInline(text ?? '');

	const onKeydown = (event: KeyboardEvent) => {
		// Only while the card itself holds focus, so typing in the chat below is untouched.
		if (!question || !card?.contains(document.activeElement)) return;
		const target = event.target as HTMLElement;
		const typing =
			target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

		if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
			return;
		}

		if (event.key === 'Enter' && (!typing || event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			advance();
			return;
		}

		if (typing) return;

		const kind = kindOf(question);
		if (/^[1-9]$/.test(event.key) && (kind === 'select' || kind === 'multiselect')) {
			const index = Number(event.key) - 1;
			if (index < (question.options ?? []).length) {
				event.preventDefault();
				if (kind === 'select') chooseOption(question, index);
				else toggleOption(question, index);
			}
		}
	};

	const optionSelected = (question: AskUserQuestion, index: number) => {
		if (draft?.type === 'option') return draft.option_index === index;
		if (draft?.type === 'options') return draft.option_indexes.includes(index);
		return false;
	};

	const otherText = () => (draft?.type === 'other' ? draft.text : '');
	const textValue = () => (draft?.type === 'text' ? draft.text : '');
	const numberValue = () => (draft?.type === 'number' ? draft.number : undefined);
</script>

<!-- Shortcuts live on the window so any child of the card can hold focus;
     the handler is inert while the card is closed. -->
<svelte:window on:keydown={onKeydown} />

{#if show}
	<section
		bind:this={card}
		tabindex="-1"
		role="group"
		aria-label={question?.header ?? $i18n.t('Question')}
		class="ask-card my-1 rounded-2xl bg-gray-50/80 px-4 py-3.5 outline-hidden ring-1 ring-gray-100 dark:bg-white/[0.04] dark:ring-white/[0.06]"
	>
		{#if question}
			{#key question.id}
				<div in:fly={{ y: 6, duration: 140 }}>
					<div class="mb-2.5 flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex items-center gap-1.5">
								<span class="size-1.5 shrink-0 rounded-full bg-gray-400 dark:bg-gray-500"></span>
								<span class="truncate text-xs font-medium text-gray-500 dark:text-gray-400">
									{question.header}
								</span>
							</div>
							<div
								class="mt-1 text-sm leading-relaxed font-medium text-gray-900 dark:text-gray-100"
							>
								<MarkdownInlineTokens
									id={`ask-${question.id}`}
									tokens={inline(question.question)}
								/>
							</div>
							{#if question.hint}
								<div class="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
									{question.hint}
								</div>
							{/if}
						</div>

						{#if questions.length > 1}
							<!-- One dot per question, so the length of the ask is visible up front. -->
							<div class="flex shrink-0 items-center gap-1 pt-1" aria-hidden="true">
								{#each questions as item, index}
									<span
										class="size-1.5 rounded-full transition-colors {index === questionIndex
											? 'bg-gray-800 dark:bg-gray-200'
											: problemWith(item, answers[item.id]) === ''
												? 'bg-gray-400 dark:bg-gray-500'
												: 'bg-gray-200 dark:bg-gray-700'}"
									></span>
								{/each}
							</div>
						{/if}
					</div>

					{#if kindOf(question) === 'select' || kindOf(question) === 'multiselect'}
						{@const multiple = kindOf(question) === 'multiselect'}
						<div class="space-y-1" role={multiple ? 'group' : 'radiogroup'}>
							{#each question.options ?? [] as option, index}
								{@const selected = optionSelected(question, index)}
								<button
									type="button"
									role={multiple ? 'checkbox' : 'radio'}
									aria-checked={selected}
									class="group flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition {selected
										? 'bg-white ring-1 ring-gray-200 dark:bg-white/[0.07] dark:ring-white/10'
										: 'hover:bg-white/70 dark:hover:bg-white/[0.04]'}"
									on:click={() =>
										multiple ? toggleOption(question, index) : chooseOption(question, index)}
								>
									<span
										class="mt-0.5 flex size-4 shrink-0 items-center justify-center border transition {multiple
											? 'rounded-[0.3rem]'
											: 'rounded-full'} {selected
											? 'border-gray-800 bg-gray-800 text-white dark:border-gray-200 dark:bg-gray-200 dark:text-black'
											: 'border-gray-300 dark:border-gray-600'}"
									>
										{#if selected}
											<Check className="size-2.5" strokeWidth="3.5" />
										{/if}
									</span>

									<span class="min-w-0 flex-1">
										<span class="flex items-center gap-1.5">
											<span class="text-sm text-gray-900 dark:text-gray-100">{option.label}</span>
											{#if !multiple && index === recommendedIndex}
												<span
													class="rounded-full bg-gray-200/80 px-1.5 py-px text-[0.625rem] text-gray-600 dark:bg-white/10 dark:text-gray-300"
												>
													{$i18n.t('Recommended')}
												</span>
											{/if}
										</span>
										{#if option.description}
											<span
												class="mt-0.5 block text-xs leading-relaxed text-gray-500 dark:text-gray-400"
											>
												{option.description}
											</span>
										{/if}
									</span>

									<!-- The shortcut is shown rather than hidden in a help text. -->
									{#if index < 9}
										<kbd
											class="mt-0.5 block shrink-0 rounded border border-gray-200 px-1 font-mono text-[0.625rem] text-gray-400 opacity-60 transition-opacity group-hover:opacity-100 dark:border-gray-700 dark:text-gray-500"
										>
											{index + 1}
										</kbd>
									{/if}
								</button>
							{/each}

							{#if allowsOther(question)}
								<div
									class="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition focus-within:bg-white dark:focus-within:bg-white/[0.07]"
								>
									<span
										class="size-4 shrink-0 rounded-full border border-dashed border-gray-300 dark:border-gray-600"
									></span>
									<input
										class="min-w-0 flex-1 bg-transparent text-sm text-gray-900 outline-hidden placeholder:text-gray-400 dark:text-gray-100 dark:placeholder:text-gray-500"
										placeholder={$i18n.t('Something else…')}
										value={otherText()}
										on:input={(event) =>
											setAnswer(question, {
												type: 'other',
												text: (event.currentTarget as HTMLInputElement).value
											})}
									/>
								</div>
							{/if}
						</div>
					{:else if kindOf(question) === 'text'}
						{#if question.multiline}
							<textarea
								rows="3"
								maxlength={question.max_length}
								class="w-full resize-none rounded-xl bg-white px-3 py-2 text-sm text-gray-900 outline-hidden ring-1 ring-gray-200 transition placeholder:text-gray-400 focus:ring-gray-300 dark:bg-white/[0.05] dark:text-gray-100 dark:ring-white/10 dark:placeholder:text-gray-500"
								placeholder={question.placeholder ?? $i18n.t('Type your answer')}
								value={textValue()}
								on:input={(event) =>
									setAnswer(question, {
										type: 'text',
										text: (event.currentTarget as HTMLTextAreaElement).value
									})}
							></textarea>
						{:else}
							<input
								type={inputType(question)}
								maxlength={question.max_length}
								class="w-full rounded-xl bg-white px-3 py-2 text-sm text-gray-900 outline-hidden ring-1 ring-gray-200 transition placeholder:text-gray-400 focus:ring-gray-300 dark:bg-white/[0.05] dark:text-gray-100 dark:ring-white/10 dark:placeholder:text-gray-500"
								placeholder={question.placeholder ?? $i18n.t('Type your answer')}
								value={textValue()}
								on:input={(event) =>
									setAnswer(question, {
										type: 'text',
										text: (event.currentTarget as HTMLInputElement).value
									})}
							/>
						{/if}
					{:else if kindOf(question) === 'number'}
						{#if scaleSteps}
							<div class="flex flex-wrap gap-1.5" role="radiogroup">
								{#each scaleSteps as step}
									{@const selected = numberValue() === step}
									<button
										type="button"
										role="radio"
										aria-checked={selected}
										class="min-w-9 rounded-xl px-3 py-1.5 text-sm tabular-nums transition {selected
											? 'bg-gray-900 text-white dark:bg-white dark:text-black'
											: 'bg-white text-gray-700 ring-1 ring-gray-200 hover:ring-gray-300 dark:bg-white/[0.05] dark:text-gray-200 dark:ring-white/10'}"
										on:click={() => setAnswer(question, { type: 'number', number: step })}
									>
										{step}
									</button>
								{/each}
							</div>
						{:else}
							<div class="flex items-center gap-2">
								<input
									type="number"
									inputmode={question.integer ? 'numeric' : 'decimal'}
									step={question.integer ? 1 : 'any'}
									min={question.minimum}
									max={question.maximum}
									class="w-36 rounded-xl bg-white px-3 py-2 text-sm tabular-nums text-gray-900 outline-hidden ring-1 ring-gray-200 transition focus:ring-gray-300 dark:bg-white/[0.05] dark:text-gray-100 dark:ring-white/10"
									value={numberValue() ?? ''}
									on:input={(event) => {
										const raw = (event.currentTarget as HTMLInputElement).value;
										setAnswer(
											question,
											raw === '' ? null : { type: 'number', number: Number(raw) }
										);
									}}
								/>
								{#if question.unit}
									<span class="text-sm text-gray-500 dark:text-gray-400">{question.unit}</span>
								{/if}
							</div>
						{/if}
					{:else}
						<div class="flex gap-1.5" role="radiogroup">
							{#each [true, false] as value}
								{@const selected = draft?.type === 'boolean' && draft.boolean === value}
								<button
									type="button"
									role="radio"
									aria-checked={selected}
									class="rounded-xl px-4 py-1.5 text-sm transition {selected
										? 'bg-gray-900 text-white dark:bg-white dark:text-black'
										: 'bg-white text-gray-700 ring-1 ring-gray-200 hover:ring-gray-300 dark:bg-white/[0.05] dark:text-gray-200 dark:ring-white/10'}"
									on:click={() => {
										setAnswer(question, { type: 'boolean', boolean: value });
										tick().then(() => advance());
									}}
								>
									{value
										? question.true_label || $i18n.t('Yes')
										: question.false_label || $i18n.t('No')}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/key}
		{/if}

		<div class="mt-3 flex items-center justify-between gap-2">
			<div class="flex items-center gap-0.5">
				<Tooltip content={$i18n.t('Esc')} placement="top">
					<button
						type="button"
						class="rounded-full px-2 py-1 text-xs text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
						on:click={cancel}
					>
						{$i18n.t('Cancel')}
					</button>
				</Tooltip>
				<Tooltip content={$i18n.t('Continue without answering')} placement="top">
					<button
						type="button"
						class="rounded-full px-2 py-1 text-xs text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
						on:click={decline}
					>
						{$i18n.t("I'd rather not say")}
					</button>
				</Tooltip>
				{#if questionIndex > 0}
					<button
						type="button"
						class="rounded-full px-2 py-1 text-xs text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
						on:click={() => (questionIndex -= 1)}
					>
						{$i18n.t('Back')}
					</button>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				{#if problem && draft}
					<span class="text-xs text-gray-500 dark:text-gray-400">{problem}</span>
				{/if}
				{#if question && !isRequired(question)}
					<button
						type="button"
						class="rounded-full px-2 py-1 text-xs text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
						on:click={() => skip(question)}
					>
						{$i18n.t('Skip')}
					</button>
				{/if}
				<button
					type="button"
					class="rounded-full bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
					disabled={isLast ? !allAnswered : !canAdvance}
					on:click={advance}
				>
					{isLast ? $i18n.t('Send answers') : $i18n.t('Next')}
				</button>
			</div>
		</div>
	</section>
{/if}
