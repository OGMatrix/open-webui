<script lang="ts">
	import { getContext } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { formatTokenCount } from '$lib/utils/tokenUsage';
	import ArchiveBox from '$lib/components/icons/ArchiveBox.svelte';
	import TaskList from '../Messages/ResponseMessage/TaskList.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	/**
	 * The strip that grows out of the top of the prompt box.
	 *
	 * Everything here answers "what is true right now, that I would want to know
	 * before I type": how far through a plan the assistant is, and how close the
	 * conversation is to being compacted. It sits against the input rather than
	 * in the message list because none of it is part of the conversation -- it
	 * is the state of the thing being talked to, and it stays put while the
	 * messages above it scroll.
	 */
	export let tasks: { id: string; content: string; status: string }[] = [];
	export let showTasks = false;

	/** Tokens in the window now, and the count at which compaction fires. */
	export let tokens = 0;
	export let compactAt: number | null = null;
	/** True while a compaction is actually running. */
	export let compacting = false;

	$: hasTasks = showTasks && tasks.length > 0 && tasks.some((task) => task?.status !== 'completed');

	// Only worth saying once it is close. Before that it is noise on every turn,
	// and the meter in the input already carries the number.
	const WARN_AT = 0.9;
	$: approaching =
		!compacting &&
		compactAt !== null &&
		compactAt > 0 &&
		tokens >= compactAt * WARN_AT &&
		tokens < compactAt;
	$: remaining = approaching ? Math.max(0, (compactAt as number) - tokens) : 0;
	$: share = compactAt && compactAt > 0 ? Math.min(100, Math.round((tokens / compactAt) * 100)) : 0;

	$: visible = hasTasks || approaching || compacting;
</script>

{#if visible}
	<!--
		Overlapped into the input by a negative margin so the two read as one
		object: the strip is the top of the box, not a separate card floating
		above it.
	-->
	<div class="mx-2 -mb-3" transition:slide={{ duration: 150 }}>
		<div
			class="rounded-t-2xl border border-b-0 border-gray-100 bg-gray-50/90 pb-3.5 backdrop-blur dark:border-gray-850 dark:bg-gray-900/70"
		>
			{#if compacting || approaching}
				<div
					class="flex min-w-0 items-center gap-1.5 px-3.5 pt-2 pb-1 text-xs text-amber-600 dark:text-amber-400"
					role="status"
				>
					<ArchiveBox className="size-3.5 shrink-0" strokeWidth="2" />
					{#if compacting}
						<span class="shimmer">{$i18n.t('Compacting context')}</span>
					{:else}
						<span class="tabular-nums"
							>{$i18n.t('{{percent}}% of the window', { percent: share })}</span
						>
						<span class="min-w-0 truncate text-gray-400 dark:text-gray-500">
							· {$i18n.t('compacting in about {{tokens}} tokens', {
								tokens: formatTokenCount(remaining)
							})}
						</span>
					{/if}
				</div>
			{/if}

			{#if hasTasks}
				<!-- TaskList brings its own header and collapse; a second one here
					 would be two controls competing for the same job. -->
				<div class="max-h-[30vh] overflow-y-auto">
					<TaskList {tasks} className="" />
				</div>
			{/if}
		</div>
	</div>
{/if}
