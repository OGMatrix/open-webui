<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import type { ToolValue } from '$lib/utils/toolCalls';

	const i18n: Writable<i18nType> = getContext('i18n');

	export let value: ToolValue;

	/**
	 * How deep this sits, so nesting can be shown by position rather than by
	 * punctuation. A rule down the left says "these belong to the line above"
	 * without spending a character on saying it.
	 */
	export let depth = 0;
</script>

{#if value.kind === 'empty'}
	<span class="text-gray-300 select-none dark:text-gray-600">—</span>
{:else if value.kind === 'text'}
	<span class="break-words whitespace-pre-wrap text-gray-800 dark:text-gray-200"
		>{value.value}{#if value.truncated}<span class="text-gray-400 dark:text-gray-500">…</span
			>{/if}</span
	>
{:else if value.kind === 'number'}
	<!-- Lined up and monospaced: numbers are compared down a column, not read. -->
	<span class="font-mono text-gray-800 tabular-nums dark:text-gray-200">{value.value}</span>
{:else if value.kind === 'boolean'}
	<!--
		The literal token, not a translated yes/no. The key beside it came from the
		tool and is in English whatever the interface language is; answering
		`safe` with `Ja` would make half a line German and lose the value the tool
		was actually handed.
	-->
	<span
		class="rounded px-1 py-px font-mono text-[0.6875rem] font-medium {value.value
			? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
			: 'bg-gray-500/10 text-gray-500 dark:text-gray-400'}"
	>
		{value.value}
	</span>
{:else if value.kind === 'list'}
	<div class="flex flex-col gap-0.5">
		{#each value.items as item, index (index)}
			<div class="flex min-w-0 gap-1.5">
				<!--
					The position, not a bullet. Which of eight results this is happens
					to be the thing people ask about them.
				-->
				<span
					class="shrink-0 font-mono text-[0.625rem] text-gray-300 tabular-nums dark:text-gray-600"
					>{index + 1}</span
				>
				<div class="min-w-0 flex-1"><svelte:self value={item} depth={depth + 1} /></div>
			</div>
		{/each}
		{#if value.hidden > 0}
			<div class="text-[0.6875rem] text-gray-400 dark:text-gray-500">
				{$i18n.t('and {{COUNT}} more', { COUNT: value.hidden })}
			</div>
		{/if}
	</div>
{:else if value.kind === 'record'}
	<div
		class="flex flex-col gap-0.5 {depth > 0
			? 'border-l border-gray-100 pl-2 dark:border-gray-800'
			: ''}"
	>
		{#each value.entries as entry (entry.key)}
			<div class="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
				<span class="shrink-0 text-gray-500 dark:text-gray-400">{entry.key}</span>
				<div class="min-w-0 flex-1"><svelte:self value={entry.value} depth={depth + 1} /></div>
			</div>
		{/each}
		{#if value.hidden > 0}
			<div class="text-[0.6875rem] text-gray-400 dark:text-gray-500">
				{$i18n.t('and {{COUNT}} more', { COUNT: value.hidden })}
			</div>
		{/if}
	</div>
{/if}
