<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Dropdown from '$lib/components/common/Dropdown.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ContextPanel from './ContextPanel.svelte';
	import { formatTokenCount, type ChatUsage } from '$lib/utils/tokenUsage';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let tokens = 0;
	export let threshold: number | null = null;
	export let estimated = false;
	export let usage: ChatUsage | null = null;

	let show = false;

	$: hasThreshold = Number(threshold) > 0;
	$: percent = hasThreshold
		? Math.min(100, Math.max(0, (tokens / (threshold as number)) * 100))
		: 0;

	// Only worth showing once a chat has something in it.
	$: visible = tokens > 0;

	// A ring reads as "how full" at a glance, where a number needs reading.
	// Geometry matches the sibling icons: a 24 viewBox at stroke 1.75, so it sits
	// at the same size and weight as the buttons either side of it.
	const RADIUS = 9;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	// A hair of arc even at 1%, so a nearly empty window reads as "barely used"
	// rather than as a broken ring.
	const MIN_ARC = 0.05;
	$: fill = hasThreshold ? Math.max(percent / 100, MIN_ARC) : 1;
	$: dash = fill * CIRCUMFERENCE;

	$: tone =
		percent >= 90
			? 'text-red-500 dark:text-red-400'
			: percent >= 70
				? 'text-amber-600 dark:text-amber-400'
				: 'text-gray-500 dark:text-gray-400';

	// The pill is icon-only, so the numbers live in the tooltip.
	$: tooltip = hasThreshold
		? `${$i18n.t('Context')}: ${formatTokenCount(tokens)} / ${formatTokenCount(
				threshold as number
			)} · ${$i18n.t('{{percent}}% used', { percent: Math.round(percent) })}`
		: `${$i18n.t('Context')}: ${formatTokenCount(tokens)}`;
</script>

{#if visible}
	<Dropdown bind:show side="top" align="start" sideOffset={6}>
		<Tooltip content={tooltip} placement="top">
			<button
				type="button"
				aria-label={$i18n.t('Context')}
				class="group flex max-w-full items-center gap-1.5 overflow-hidden rounded-full p-[0.375rem] text-sm transition-colors duration-300 focus:outline-hidden {show
					? 'bg-gray-50 dark:bg-gray-800'
					: 'bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800'} {tone}"
			>
				<svg
					viewBox="0 0 24 24"
					class="size-4 shrink-0"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r={RADIUS} opacity="0.25" />
					<circle
						cx="12"
						cy="12"
						r={RADIUS}
						stroke-linecap="round"
						stroke-dasharray="{dash} {CIRCUMFERENCE}"
						transform="rotate(-90 12 12)"
						style="transition: stroke-dasharray 500ms"
					/>
				</svg>
			</button>
		</Tooltip>

		<div slot="content">
			<div
				class="w-72 rounded-xl border border-gray-100 bg-white p-3 text-gray-900 shadow-lg dark:border-gray-800 dark:bg-gray-850 dark:text-white"
			>
				<ContextPanel {tokens} {threshold} {estimated} {usage} />
			</div>
		</div>
	</Dropdown>
{/if}
