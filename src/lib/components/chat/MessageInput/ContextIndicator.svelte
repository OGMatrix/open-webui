<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Dropdown from '$lib/components/common/Dropdown.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ContextPanel from './ContextPanel.svelte';
	import { formatTokenCount, type ChatUsage } from '$lib/utils/tokenUsage';
	import type { ModelPricing } from '$lib/utils/cost';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let tokens = 0;
	export let threshold: number | null = null;
	export let estimated = false;
	export let usage: ChatUsage | null = null;
	export let pricing: ModelPricing | null = null;
	export let windowSource: 'server' | 'model' | 'setting' | null = null;

	let show = false;

	$: hasThreshold = Number(threshold) > 0;
	$: percent = hasThreshold
		? Math.min(100, Math.max(0, (tokens / (threshold as number)) * 100))
		: 0;

	// Only worth showing once a chat has something in it.
	$: visible = tokens > 0;

	// A ring reads as "how full" at a glance, where a number needs reading.
	//
	// It used to match the icons either side of it exactly -- a 24 viewBox at
	// stroke 1.75 -- which made it about one pixel of line at 16px, over a track
	// at a quarter opacity. On a dark ground that is a smudge, and the one number
	// worth knowing sat in a tooltip nobody hovers. It is bigger and heavier now,
	// and carries the figure beside it.
	const RADIUS = 9;
	const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
	// A hair of arc even at 1%, so a nearly empty window reads as "barely used"
	// rather than as a broken ring.
	const MIN_ARC = 0.05;
	$: fill = hasThreshold ? Math.max(percent / 100, MIN_ARC) : 1;
	$: dash = fill * CIRCUMFERENCE;

	// Quiet until there is a reason not to be. A bar that shouts from the first
	// message is one that gets ignored by the time it matters.
	$: level = percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'calm';

	$: tone =
		level === 'critical'
			? 'text-red-600 dark:text-red-400'
			: level === 'warn'
				? 'text-amber-600 dark:text-amber-400'
				: 'text-gray-500 dark:text-gray-400';

	// The surface carries the same warning as the colour, so the control is
	// findable in a row of icons rather than being one more grey glyph.
	$: surface =
		level === 'critical'
			? 'bg-red-500/10 hover:bg-red-500/15 dark:bg-red-400/10 dark:hover:bg-red-400/20'
			: level === 'warn'
				? 'bg-amber-500/10 hover:bg-amber-500/15 dark:bg-amber-400/10 dark:hover:bg-amber-400/20'
				: 'bg-gray-50 hover:bg-gray-100 dark:bg-white/[0.06] dark:hover:bg-white/10';

	// The percentage where a window is known, the count where it is not. Both
	// are short enough to sit in the row, and both beat hovering for them.
	$: label = hasThreshold ? `${Math.round(percent)}%` : formatTokenCount(tokens);

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
				aria-label={tooltip}
				class="group flex max-w-full items-center gap-1 overflow-hidden rounded-full py-1 pr-2 pl-1.5 transition-colors duration-300 focus:outline-hidden {surface} {tone}"
			>
				<svg
					viewBox="0 0 24 24"
					class="size-[1.125rem] shrink-0"
					fill="none"
					stroke="currentColor"
					stroke-width="3"
					aria-hidden="true"
				>
					<!--
						The track gets its own colour rather than the arc's at low
						opacity: on a dark ground a quarter-opacity grey is not a track,
						it is nothing.
					-->
					<circle cx="12" cy="12" r={RADIUS} class="stroke-gray-300 dark:stroke-white/20" />
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
				<span class="text-xs font-medium tabular-nums">{label}</span>
			</button>
		</Tooltip>

		<div slot="content">
			<div
				class="w-72 rounded-xl border border-gray-100 bg-white p-3 text-gray-900 shadow-lg dark:border-gray-800 dark:bg-gray-850 dark:text-white"
			>
				<ContextPanel {tokens} {threshold} {estimated} {usage} {pricing} {windowSource} />
			</div>
		</div>
	</Dropdown>
{/if}
