<script lang="ts">
	export let label = '';
	export let description = '';
	export let className = '';
	export let labelClassName = '';
</script>

<!-- The label and its control sit at opposite ends of a wide row, which is
     where "which switch belongs to which line" comes from. A band on hover
     ties the two ends together without moving anything. -->
<div
	class="setting-row -mx-2 flex items-center justify-between gap-2.5 rounded-lg px-2 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.03] {className}"
>
	<div class="min-w-0 text-xs text-gray-600 dark:text-gray-400 {labelClassName}">
		<slot name="label">{label}</slot>
	</div>

	<div class="min-w-0">
		<slot />
	</div>
</div>

{#if description}
	<p class="-mt-0.5 mb-1 text-[0.6875rem] text-gray-400 dark:text-gray-600">
		{description}
	</p>
{/if}
