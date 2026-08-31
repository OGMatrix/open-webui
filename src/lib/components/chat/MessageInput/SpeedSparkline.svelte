<script lang="ts">
	import { formatTokenRate } from '$lib/utils/tokenUsage';

	/** Decode rate of each measured turn, oldest first. */
	export let rates: number[] = [];
	export let className = '';

	// Two points is the least that can show a direction.
	const MIN_POINTS = 2;
	// Only the recent stretch is interesting, and a long chat would squash it.
	const MAX_POINTS = 24;

	const WIDTH = 100;
	const HEIGHT = 20;
	const PAD = 1.5;

	$: shown = rates.slice(-MAX_POINTS);
	$: enough = shown.length >= MIN_POINTS;

	$: min = enough ? Math.min(...shown) : 0;
	$: max = enough ? Math.max(...shown) : 0;
	// A flat line still needs a range to divide by, and should sit mid-height.
	$: span = max - min || 1;

	$: points = shown.map((rate, index) => {
		const x = PAD + (index / (shown.length - 1)) * (WIDTH - PAD * 2);
		const y = max === min ? HEIGHT / 2 : HEIGHT - PAD - ((rate - min) / span) * (HEIGHT - PAD * 2);
		return [x, y] as const;
	});

	$: line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
	// Closing the shape back along the baseline gives the fill something to sit in.
	$: area = points.length
		? `${line} ${points[points.length - 1][0].toFixed(2)},${HEIGHT} ${points[0][0].toFixed(2)},${HEIGHT}`
		: '';
	$: last = points.length ? points[points.length - 1] : null;

	// Down means slower, which is the direction worth noticing.
	$: trend = enough ? shown[shown.length - 1] - shown[0] : 0;
	$: tone =
		trend < -min * 0.15 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-500';
</script>

{#if enough}
	<div class="flex items-center gap-2 {className}">
		<svg
			viewBox="0 0 {WIDTH} {HEIGHT}"
			preserveAspectRatio="none"
			class="h-5 flex-1 {tone}"
			aria-hidden="true"
		>
			<polygon points={area} fill="currentColor" opacity="0.12" />
			<polyline
				points={line}
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linejoin="round"
				stroke-linecap="round"
				vector-effect="non-scaling-stroke"
			/>
			{#if last}
				<circle
					cx={last[0]}
					cy={last[1]}
					r="2"
					fill="currentColor"
					vector-effect="non-scaling-stroke"
				/>
			{/if}
		</svg>
		<span class="shrink-0 tabular-nums text-[0.625rem] text-gray-400 dark:text-gray-600">
			{formatTokenRate(min)}–{formatTokenRate(max)}
		</span>
	</div>
{/if}
