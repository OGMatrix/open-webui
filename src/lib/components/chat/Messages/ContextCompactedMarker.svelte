<script lang="ts">
	import { getContext } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Markdown from './Markdown.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	/**
	 * The note that replaced everything above this point.
	 *
	 * Compaction is otherwise invisible: the chat simply stops remembering
	 * things it was told, and the user is left to work out why. A line saying
	 * where it happened, and what was kept, turns a silent loss into something
	 * that can be read and argued with.
	 */
	export let summary: string;
	export let id: string;

	let open = false;
</script>

<div class="my-3 flex w-full flex-col items-center" data-context-compacted={id}>
	<button
		type="button"
		class="group flex w-full items-center gap-2 text-left"
		aria-expanded={open}
		on:click={() => (open = !open)}
	>
		<div class="h-px flex-1 bg-gray-100 dark:bg-gray-850"></div>
		<span
			class="shrink-0 text-[0.6875rem] text-gray-400 transition group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-300"
		>
			{$i18n.t('Context compacted')} · {open
				? $i18n.t('Hide')
				: $i18n.t('Show what was summarized')}
		</span>
		<div class="h-px flex-1 bg-gray-100 dark:bg-gray-850"></div>
	</button>

	{#if open}
		<div
			transition:slide={{ duration: 150 }}
			class="mt-2 w-full rounded-2xl border border-gray-50 p-3 text-xs dark:border-gray-850/60"
		>
			<div class="mb-2 text-[0.6875rem] text-gray-400 dark:text-gray-500">
				{$i18n.t('Older turns were summarized to make room. The note is kept with the chat.')}
			</div>
			<div class="markdown-prose-xs">
				<Markdown id={`${id}-context-summary`} content={summary} />
			</div>
		</div>
	{/if}
</div>
