<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import ArchiveBox from '$lib/components/icons/ArchiveBox.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	/**
	 * Compaction while it runs, in the same shape it will take when it is done.
	 *
	 * The finished row replaces this one in place, so the two are deliberately
	 * built alike: same icon, same dot, same line. Nothing jumps, and what was
	 * a promise becomes a record.
	 */
	export let state: 'running' | 'failed' = 'running';
	export let startedAt: number = Date.now();

	let elapsed = 0;
	// A summary is a model call on a long conversation; it can take a while, and
	// a number that moves is the difference between waiting and wondering.
	const timer = setInterval(() => {
		elapsed = Math.floor((Date.now() - startedAt) / 1000);
	}, 1000);
	onDestroy(() => clearInterval(timer));
</script>

<div class="my-2 flex w-full min-w-0 items-center gap-1.5 py-1 text-sm">
	{#if state === 'failed'}
		<span class="shrink-0 text-red-500 dark:text-red-400" aria-hidden="true">
			<XMark className="size-4" strokeWidth="2.5" />
		</span>
	{:else}
		<span class="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true">
			<Spinner className="size-4" />
		</span>
	{/if}

	<span
		class="size-1.5 shrink-0 rounded-full {state === 'failed'
			? 'bg-red-500/70'
			: 'bg-amber-500/70'}"
		aria-hidden="true"
	></span>

	<div class="line-clamp-1 min-w-0 flex-1" role="status">
		{#if state === 'failed'}
			<span class="text-black dark:text-white">{$i18n.t('Context compaction failed')}</span>
			<span class="text-gray-400 dark:text-gray-500"
				>· {$i18n.t('older turns were trimmed instead')}</span
			>
		{:else}
			<!--
				The same shimmer the rest of the chat uses for work in progress,
				from app.css rather than a second copy of it here.
			-->
			<span class="shimmer text-black dark:text-white">{$i18n.t('Compacting context')}</span>
			<span class="text-gray-400 dark:text-gray-500">
				· {$i18n.t('summarizing older turns to make room')}
				{#if elapsed > 2}<span class="tabular-nums"> · {elapsed}s</span>{/if}
			</span>
		{/if}
	</div>
</div>
