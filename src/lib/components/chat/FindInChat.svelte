<script lang="ts">
	import { getContext, onDestroy, tick } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { settings } from '$lib/stores';
	import { createMessagesList } from '$lib/utils';
	import {
		createIndexer,
		findMatches,
		hitsByMessage,
		isQueryValid,
		searchIndex,
		stepHit,
		type IndexedMessage,
		type RoleFilter,
		type SearchHit
	} from '$lib/utils/chatSearch';
	import {
		HIGHLIGHT_ALL,
		HIGHLIGHT_CURRENT,
		clearPaint,
		collapsedTriggers,
		flatten,
		paint,
		rangeFor,
		supportsHighlights
	} from '$lib/utils/domHighlight';

	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Search from '$lib/components/icons/Search.svelte';
	import ChevronUp from '$lib/components/icons/ChevronUp.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import ListBullet from '$lib/components/icons/ListBullet.svelte';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let show = false;
	export let history: { messages?: Record<string, any>; currentId?: string | null } = {};
	export let messagesContainerId = 'messages-container';
	/** Renders the whole branch, so a hit in an old message can be reached. */
	export let renderAll: () => Promise<void> = async () => {};
	/** Called before jumping, so the view stops following a streaming answer. */
	export let onNavigate: () => void = () => {};
	export let className = '';

	let query = '';
	let caseSensitive = false;
	let wholeWord = false;
	let regex = false;
	let role: RoleFilter = 'all';

	let hits: SearchHit[] = [];
	let current = -1;
	let showList = false;
	let inputElement: HTMLInputElement | null = null;

	const indexer = createIndexer();
	let index: IndexedMessage[] = [];

	$: options = { caseSensitive, wholeWord, regex, role };
	$: valid = isQueryValid(query, options);

	// Only index while the bar is open: lexing a long conversation is not worth
	// doing for a panel nobody has asked for.
	$: if (show) {
		index = indexer(createMessagesList(history, history?.currentId ?? null) ?? []);
	}

	$: hits = show && valid ? searchIndex(index, query, options) : [];

	// A changed query means the old position means nothing. Landing on the first
	// hit rather than nowhere is what every find bar does.
	$: if (hits.length === 0) {
		current = -1;
	} else if (current >= hits.length || current < 0) {
		current = 0;
	}

	$: counts = hitsByMessage(hits);
	$: currentHit = current >= 0 ? (hits[current] ?? null) : null;

	// Repaint whenever the set of hits or the position within it changes.
	$: void repaint(hits, current);

	const messageElement = (id: string) => document.getElementById(`message-${id}`);

	/**
	 * The ranges for one message, opening anything collapsed that hides a hit.
	 *
	 * The index sees the text of a closed tool call; the page does not, because
	 * a closed block renders none of its content. When the two disagree the
	 * block is opened, which is what the reader would have done by hand.
	 */
	const rangesIn = async (id: string, expected: number, mayExpand: boolean): Promise<Range[]> => {
		let element = messageElement(id);
		if (!element) return [];

		const build = () => {
			const flat = flatten(element);
			return findMatches(flat.text, query, options)
				.map((match) => rangeFor(flat, match.start, match.end))
				.filter((range): range is Range => range !== null);
		};

		let ranges = build();

		if (mayExpand && ranges.length < expected) {
			const triggers = collapsedTriggers(element);
			if (triggers.length > 0) {
				for (const trigger of triggers) trigger.click();
				await tick();
				// The block slides open, so the text is not laid out on this frame.
				await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
				element = messageElement(id);
				if (element) ranges = build();
			}
		}

		return ranges;
	};

	const scrollRangeIntoView = (range: Range) => {
		const container = document.getElementById(messagesContainerId);
		const rect = range.getBoundingClientRect();

		if (!container || (rect.width === 0 && rect.height === 0)) {
			(range.startContainer.parentElement as HTMLElement | null)?.scrollIntoView({
				block: 'center',
				behavior: 'smooth'
			});
			return;
		}

		const bounds = container.getBoundingClientRect();
		const top = container.scrollTop + (rect.top - bounds.top) - bounds.height / 2 + rect.height / 2;
		container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
	};

	let repainting = false;
	let repaintQueued = false;

	/** Every painted range on the page right now, current one excluded. */
	const paintAll = async () => {
		const all: Range[] = [];
		for (const [id, expected] of counts) {
			// Never expand during a repaint: opening every collapsed block in the
			// conversation because somebody typed a letter would be violent.
			all.push(...(await rangesIn(id, expected, false)));
		}
		paint(HIGHLIGHT_ALL, all);
	};

	/**
	 * Paint every hit that is on the page, and single out the current one.
	 *
	 * Messages that are not rendered are simply skipped; the counter still knows
	 * about them, and stepping onto one loads it first.
	 */
	const repaint = async (_hits: SearchHit[], _current: number) => {
		if (!show || !supportsHighlights()) return;

		// Typing is faster than painting. Dropping the request outright would
		// leave the last keystroke unpainted, so the newest one is remembered and
		// runs when the one in flight finishes.
		if (repainting) {
			repaintQueued = true;
			return;
		}
		repainting = true;

		try {
			await tick();
			await paintAll();

			if (!currentHit) {
				clearPaint(HIGHLIGHT_CURRENT);
				return;
			}

			const inMessage = await rangesIn(
				currentHit.messageId,
				counts.get(currentHit.messageId) ?? 0,
				false
			);
			paint(
				HIGHLIGHT_CURRENT,
				inMessage[currentHit.occurrence] ? [inMessage[currentHit.occurrence]] : []
			);
		} finally {
			repainting = false;
			if (repaintQueued) {
				repaintQueued = false;
				void repaint(hits, current);
			}
		}
	};

	/** Move to a hit by index, loading and opening whatever hides it. */
	const goTo = async (position: number) => {
		if (position < 0 || position >= hits.length) return;
		current = position;

		const hit = hits[position];
		onNavigate();

		if (!messageElement(hit.messageId)) {
			// Older messages are paged in on scroll, so the target may not exist
			// yet. This is the moment to stop paging and render the whole branch.
			await renderAll();
			await tick();
		}

		const ranges = await rangesIn(hit.messageId, counts.get(hit.messageId) ?? 0, true);
		const range = ranges[hit.occurrence] ?? ranges[0] ?? null;

		if (range) {
			scrollRangeIntoView(range);
			paint(HIGHLIGHT_CURRENT, [range]);
			// Expanding a block put new text on the page, so the rest of the hits
			// have to be painted again to include it.
			await paintAll();
		} else {
			messageElement(hit.messageId)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	};

	const step = (direction: 1 | -1) => goTo(stepHit(current, hits.length, direction));

	export const open = async (initial = '') => {
		show = true;
		if (initial) query = initial;
		await tick();
		inputElement?.focus();
		inputElement?.select();
	};

	export const close = () => {
		show = false;
		clearPaint();
	};

	$: if (!show) clearPaint();

	onDestroy(() => clearPaint());

	const onKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			step(event.shiftKey ? -1 : 1);
		}
	};

	const TOGGLE =
		'flex size-6 shrink-0 items-center justify-center rounded-md text-[0.6875rem] font-medium transition-colors';
	$: TOGGLE_FOCUS = ($settings?.highContrastMode ?? false) ? '' : 'focus:outline-hidden';
	const TOGGLE_ON = 'bg-sky-100 text-sky-700 dark:bg-sky-400/20 dark:text-sky-200';
	const TOGGLE_OFF =
		'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200';

	const ROLES: { value: RoleFilter; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'user', label: 'You' },
		{ value: 'assistant', label: 'Assistant' }
	];

	/** Enough to scan; a query matching thousands is a query to narrow. */
	const LIST_LIMIT = 100;
	$: listed = hits.slice(0, LIST_LIMIT);
</script>

{#if show}
	<div
		class="pointer-events-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-gray-100 bg-white shadow-lg dark:border-gray-850 dark:bg-gray-900 {className}"
		role="search"
		aria-label={$i18n.t('Find in Chat')}
	>
		<div class="flex items-center gap-1.5 px-2 py-1.5">
			<Search className="size-4 shrink-0 text-gray-400" strokeWidth="2" />

			<input
				bind:this={inputElement}
				bind:value={query}
				on:keydown={onKeydown}
				id="find-in-chat-input"
				type="text"
				autocomplete="off"
				spellcheck="false"
				class="min-w-0 flex-1 bg-transparent text-sm outline-hidden placeholder:text-gray-400 dark:placeholder:text-gray-600 {valid
					? ''
					: 'text-red-500 dark:text-red-400'}"
				placeholder={$i18n.t('Find in Chat')}
				aria-label={$i18n.t('Find in Chat')}
			/>

			<!--
				The three modifiers every find bar has, in the order every find bar
				has them. Their state is colour and aria-pressed, not colour alone.
			-->
			<Tooltip content={$i18n.t('Match case')} placement="bottom">
				<button
					type="button"
					aria-pressed={caseSensitive}
					aria-label={$i18n.t('Match case')}
					class="{TOGGLE} {TOGGLE_FOCUS} {caseSensitive ? TOGGLE_ON : TOGGLE_OFF}"
					on:click={() => (caseSensitive = !caseSensitive)}
				>
					Aa
				</button>
			</Tooltip>

			<Tooltip content={$i18n.t('Match whole word')} placement="bottom">
				<button
					type="button"
					aria-pressed={wholeWord}
					aria-label={$i18n.t('Match whole word')}
					class="{TOGGLE} {TOGGLE_FOCUS} {wholeWord ? TOGGLE_ON : TOGGLE_OFF}"
					on:click={() => (wholeWord = !wholeWord)}
				>
					<span class="underline">ab</span>
				</button>
			</Tooltip>

			<Tooltip content={$i18n.t('Use regular expression')} placement="bottom">
				<button
					type="button"
					aria-pressed={regex}
					aria-label={$i18n.t('Use regular expression')}
					class="{TOGGLE} {TOGGLE_FOCUS} {regex ? TOGGLE_ON : TOGGLE_OFF}"
					on:click={() => (regex = !regex)}
				>
					.*
				</button>
			</Tooltip>

			<div
				class="mx-0.5 h-4 w-px shrink-0 bg-gray-200/70 dark:bg-white/10"
				aria-hidden="true"
			></div>

			<!--
				A live region, because the count is the answer to what was typed and
				a screen reader would otherwise hear nothing come back.
			-->
			<div
				class="min-w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-gray-500 dark:text-gray-400"
				aria-live="polite"
				aria-atomic="true"
			>
				{#if !valid}
					<span class="text-red-500 dark:text-red-400">{$i18n.t('Invalid pattern')}</span>
				{:else if query === ''}
					&nbsp;
				{:else if hits.length === 0}
					{$i18n.t('No results')}
				{:else}
					{$i18n.t('{{current}} of {{total}}', { current: current + 1, total: hits.length })}
				{/if}
			</div>

			<Tooltip content={$i18n.t('Previous match')} placement="bottom">
				<button
					type="button"
					aria-label={$i18n.t('Previous match')}
					disabled={hits.length === 0}
					class="{TOGGLE} {TOGGLE_FOCUS} {TOGGLE_OFF} disabled:opacity-30"
					on:click={() => step(-1)}
				>
					<ChevronUp className="size-3.5" strokeWidth="2.5" />
				</button>
			</Tooltip>

			<Tooltip content={$i18n.t('Next match')} placement="bottom">
				<button
					type="button"
					aria-label={$i18n.t('Next match')}
					disabled={hits.length === 0}
					class="{TOGGLE} {TOGGLE_FOCUS} {TOGGLE_OFF} disabled:opacity-30"
					on:click={() => step(1)}
				>
					<ChevronDown className="size-3.5" strokeWidth="2.5" />
				</button>
			</Tooltip>

			<Tooltip content={$i18n.t('Show all matches')} placement="bottom">
				<button
					type="button"
					aria-pressed={showList}
					aria-label={$i18n.t('Show all matches')}
					class="{TOGGLE} {TOGGLE_FOCUS} {showList ? TOGGLE_ON : TOGGLE_OFF}"
					on:click={() => (showList = !showList)}
				>
					<ListBullet className="size-3.5" strokeWidth="2" />
				</button>
			</Tooltip>

			<Tooltip content={$i18n.t('Close')} placement="bottom">
				<button
					type="button"
					aria-label={$i18n.t('Close')}
					class="{TOGGLE} {TOGGLE_FOCUS} {TOGGLE_OFF}"
					on:click={close}
				>
					<XMark className="size-3.5" strokeWidth="2.5" />
				</button>
			</Tooltip>
		</div>

		{#if showList}
			<div class="border-t border-gray-100 dark:border-gray-850">
				<div class="flex items-center gap-1 px-2 py-1.5">
					{#each ROLES as option (option.value)}
						<button
							type="button"
							aria-pressed={role === option.value}
							class="rounded-full px-2 py-0.5 text-xs transition-colors {TOGGLE_FOCUS} {role ===
							option.value
								? TOGGLE_ON
								: TOGGLE_OFF}"
							on:click={() => (role = option.value)}
						>
							{$i18n.t(option.label)}
						</button>
					{/each}
				</div>

				<div class="max-h-72 overflow-y-auto px-1 pb-1">
					{#each listed as hit, position (`${hit.messageId}-${hit.occurrence}`)}
						<button
							type="button"
							aria-current={position === current}
							class="flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors {TOGGLE_FOCUS} {position ===
							current
								? 'bg-gray-100 dark:bg-gray-850'
								: 'hover:bg-gray-50 dark:hover:bg-gray-850/60'}"
							on:click={() => goTo(position)}
						>
							<span class="text-[0.6875rem] uppercase tracking-wide text-gray-400">
								{hit.role === 'user' ? $i18n.t('You') : $i18n.t('Assistant')}
							</span>
							<span class="line-clamp-2 text-xs text-gray-600 dark:text-gray-300">
								{hit.snippet.before}<mark
									class="rounded bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-500/30"
									>{hit.snippet.match}</mark
								>{hit.snippet.after}
							</span>
						</button>
					{/each}

					{#if hits.length > LIST_LIMIT}
						<div class="px-2 py-1.5 text-xs text-gray-400">
							{$i18n.t('and {{COUNT}} more', { COUNT: hits.length - LIST_LIMIT })}
						</div>
					{/if}

					{#if hits.length === 0 && query !== '' && valid}
						<div class="px-2 py-3 text-center text-xs text-gray-400">{$i18n.t('No results')}</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
