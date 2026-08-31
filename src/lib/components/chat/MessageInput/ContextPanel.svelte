<script lang="ts">
	import { getContext } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
	import { formatTokenCount, formatTokenRate, type ChatUsage } from '$lib/utils/tokenUsage';

	const i18n = getContext<Writable<i18nType>>('i18n');

	/** Tokens currently in the context window. */
	export let tokens = 0;
	/** Size of the context window, when it is known. */
	export let threshold: number | null = null;
	/** True while the count is an estimate rather than a provider figure. */
	export let estimated = false;
	export let usage: ChatUsage | null = null;

	let showDetails = false;

	$: hasThreshold = Number(threshold) > 0;
	$: percent = hasThreshold
		? Math.min(100, Math.max(0, (tokens / (threshold as number)) * 100))
		: 0;
	$: remaining = hasThreshold ? Math.max(0, (threshold as number) - tokens) : 0;

	// The bar earns attention only as the window actually fills.
	$: barTone =
		percent >= 90
			? 'bg-red-500 dark:bg-red-400'
			: percent >= 70
				? 'bg-amber-500 dark:bg-amber-400'
				: 'bg-gray-400 dark:bg-gray-500';

	$: hasDetails = Boolean(
		usage && (usage.turns > 0 || usage.tokensPerSecond !== null || usage.lastTurn)
	);
</script>

<div class="text-xs">
	<div class="flex items-baseline justify-between gap-3">
		<span class="font-medium text-gray-700 dark:text-gray-200">{$i18n.t('Context')}</span>
		<span class="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
			{#if estimated}<span class="mr-0.5">~</span>{/if}{formatTokenCount(tokens)}{#if hasThreshold}
				<span class="text-gray-400 dark:text-gray-600">
					/ {formatTokenCount(threshold as number)}</span
				>
			{/if}
		</span>
	</div>

	{#if hasThreshold}
		<div class="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
			<div
				class="h-full rounded-full transition-[width] duration-500 {barTone}"
				style={`width: ${percent}%`}
			></div>
		</div>

		<div class="mt-1 flex items-baseline justify-between gap-3 text-gray-400 dark:text-gray-500">
			<span class="tabular-nums"
				>{$i18n.t('{{percent}}% used', { percent: Math.round(percent) })}</span
			>
			<span class="shrink-0 tabular-nums">
				{$i18n.t('{{tokens}} remaining', { tokens: formatTokenCount(remaining) })}
			</span>
		</div>
	{/if}

	{#if hasDetails && usage}
		<button
			type="button"
			class="mt-2 flex w-full items-center justify-between gap-2 rounded-lg py-1 text-left text-gray-500 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
			aria-expanded={showDetails}
			on:click={() => (showDetails = !showDetails)}
		>
			<span>{$i18n.t('Token usage details')}</span>
			<ChevronDown
				className="size-3 shrink-0 transition-transform duration-200 {showDetails
					? 'rotate-180'
					: ''}"
				strokeWidth="2.5"
			/>
		</button>

		{#if showDetails}
			<div transition:slide={{ duration: 160 }} class="space-y-2 pb-0.5">
				{#if usage.turns > 0}
					<div>
						<div
							class="mb-0.5 text-[0.625rem] font-medium tracking-wide text-gray-400 uppercase dark:text-gray-600"
						>
							{$i18n.t('Across all turns')}
						</div>
						<div class="flex items-baseline justify-between gap-3">
							<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Prompt evaluated')}</span>
							<span class="shrink-0 tabular-nums text-gray-600 dark:text-gray-300"
								>{formatTokenCount(usage.promptTokens)}</span
							>
						</div>
						<div class="flex items-baseline justify-between gap-3">
							<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Generated')}</span>
							<span class="shrink-0 tabular-nums text-gray-600 dark:text-gray-300"
								>{formatTokenCount(usage.completionTokens)}</span
							>
						</div>
					</div>
				{/if}

				{#if usage.lastTurn}
					<div>
						<div
							class="mb-0.5 text-[0.625rem] font-medium tracking-wide text-gray-400 uppercase dark:text-gray-600"
						>
							{$i18n.t('Last turn')}
						</div>
						<div class="flex items-baseline justify-between gap-3">
							<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Prompt')}</span>
							<span class="shrink-0 tabular-nums text-gray-600 dark:text-gray-300"
								>{formatTokenCount(usage.lastTurn.promptTokens)}</span
							>
						</div>
						{#if usage.lastTurn.cachedTokens > 0}
							<div class="flex items-baseline justify-between gap-3">
								<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Cached')}</span>
								<span class="shrink-0 tabular-nums font-medium text-gray-700 dark:text-gray-200"
									>{formatTokenCount(usage.lastTurn.cachedTokens)}</span
								>
							</div>
						{/if}
					</div>
				{/if}

				{#if usage.tokensPerSecond !== null}
					<div
						class="flex items-baseline justify-between gap-3 border-t border-gray-100 pt-1.5 dark:border-gray-800"
					>
						<span class="text-gray-500 dark:text-gray-400">{$i18n.t('Average speed')}</span>
						<span class="shrink-0 tabular-nums text-gray-600 dark:text-gray-300">
							{formatTokenRate(usage.tokensPerSecond)} t/s
						</span>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>
