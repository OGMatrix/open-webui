<script lang="ts">
	import { getContext } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { formatTokenCount } from '$lib/utils/tokenUsage';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
	import ArchiveBox from '$lib/components/icons/ArchiveBox.svelte';
	import Markdown from './Markdown.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	/**
	 * Where the history above this point was replaced by a note.
	 *
	 * Compaction is invisible otherwise: the chat stops remembering things it
	 * was told, and the user is left to work out why. It reads like a tool call
	 * because that is what it is -- something the assistant did to the
	 * conversation, with a result worth opening.
	 */
	export let summary: string;
	export let id: string;

	/**
	 * What it cost, as recorded when it happened. Older chats were compacted
	 * before this was kept, so everything here is optional and the row degrades
	 * to the note alone rather than showing zeroes.
	 */
	export let detail: {
		droppedMessages?: number;
		keptMessages?: number;
		tokensBefore?: number;
		tokensAfter?: number;
		tokensFreed?: number;
		window?: number;
		windowSource?: string;
		model?: string;
		at?: number;
	} | null = null;

	let open = false;

	const count = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

	$: freed = count(detail?.tokensFreed);
	$: dropped = count(detail?.droppedMessages);

	// The one line the row can afford, in the order someone reads it: how much
	// room this bought, then what it cost to buy.
	$: parts = [
		freed ? $i18n.t('{{tokens}} freed', { tokens: formatTokenCount(freed) }) : null,
		dropped ? $i18n.t('{{count}} messages summarized', { count: dropped }) : null
	].filter(Boolean) as string[];

	$: when = detail?.at ? new Date(detail.at * 1000).toLocaleString() : '';

	$: rows = [
		[$i18n.t('Summarized'), dropped !== null ? `${dropped}` : ''],
		[
			$i18n.t('Kept in context'),
			count(detail?.keptMessages) !== null ? `${detail?.keptMessages}` : ''
		],
		[
			$i18n.t('Context size'),
			count(detail?.tokensBefore) !== null && count(detail?.tokensAfter) !== null
				? `${formatTokenCount(detail?.tokensBefore as number)} → ${formatTokenCount(detail?.tokensAfter as number)}`
				: ''
		],
		[$i18n.t('Window'), count(detail?.window) ? formatTokenCount(detail?.window as number) : ''],
		[$i18n.t('Model'), detail?.model ?? ''],
		[$i18n.t('When'), when]
	].filter(([, value]) => value !== '') as [string, string][];
</script>

<div class="my-2 w-full" data-context-compacted={id}>
	<button
		type="button"
		class="flex w-full min-w-0 items-center gap-1.5 py-1 text-left text-sm"
		aria-expanded={open}
		on:click={() => (open = !open)}
	>
		<span class="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true">
			<ArchiveBox className="size-4" strokeWidth="2" />
		</span>
		<!-- A colour of its own, so a compaction is not mistaken for a tool. -->
		<span class="size-1.5 shrink-0 rounded-full bg-amber-500/70" aria-hidden="true"></span>
		<div class="line-clamp-1 min-w-0 flex-1">
			<span class="text-black dark:text-white">{$i18n.t('Context compacted')}</span>
			{#if parts.length}
				<span class="text-gray-400 dark:text-gray-500">· {parts.join(', ')}</span>
			{/if}
		</div>
		<ChevronDown
			className="size-3 shrink-0 self-center transition-transform duration-200 {open
				? 'rotate-180'
				: ''}"
			strokeWidth="3.5"
		/>
	</button>

	{#if open}
		<div
			transition:slide={{ duration: 150 }}
			class="my-1.5 space-y-2 rounded-2xl border border-gray-50 p-2.5 dark:border-gray-850/60"
		>
			{#if rows.length}
				<div>
					<div
						class="mb-1.5 px-1 text-[0.625rem] font-normal tracking-wider text-gray-400 uppercase dark:text-gray-500"
					>
						{$i18n.t('What happened')}
					</div>
					<div class="space-y-0.5 px-1 text-xs">
						{#each rows as [label, value] (label)}
							<div class="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
								<span class="shrink-0 text-gray-500 dark:text-gray-400">{label}</span>
								<div class="min-w-0 flex-1 text-gray-800 dark:text-gray-200">{value}</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<div>
				<div
					class="mb-1.5 px-1 text-[0.625rem] font-normal tracking-wider text-gray-400 uppercase dark:text-gray-500"
				>
					{$i18n.t('The note that replaced them')}
				</div>
				<div class="markdown-prose-xs px-1">
					<Markdown id={`${id}-context-summary`} content={summary} />
				</div>
			</div>
		</div>
	{/if}
</div>
