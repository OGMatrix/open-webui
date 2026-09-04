<script lang="ts">
	import { getContext } from 'svelte';
	import { fly } from 'svelte/transition';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	/**
	 * Whether the view is still following the answer as it arrives.
	 *
	 * Scrolling up to read something earlier detaches it, which is the right
	 * behaviour -- but nothing then says the answer has moved on, and getting
	 * back means dragging to the end of a conversation that is still growing.
	 */
	export let attached = true;

	/** True while a response is arriving, so the button can say so. */
	export let generating = false;

	export let onClick: () => void;
</script>

{#if !attached}
	<!--
		Anchored to the top edge of the composer itself, not to the top of
		everything stacked above it. With a task list open, the stack is tall, and
		a button meant to say "the conversation moved on down here" would sit up
		in the message flow.
	-->
	<div class="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-2 flex justify-center">
		<div transition:fly={{ y: 8, duration: 150 }} class="pointer-events-auto">
			<Tooltip content={$i18n.t('Follow the conversation again')} placement="top">
				<button
					type="button"
					class="flex items-center gap-1.5 rounded-full border border-gray-100 bg-white/90 py-1.5 pr-3 pl-2.5 text-xs shadow-lg backdrop-blur transition hover:bg-white dark:border-gray-850 dark:bg-gray-900/90 dark:hover:bg-gray-850"
					on:click={onClick}
				>
					<!--
						Decorative: the label beside it already says what the button does,
						and a screen reader announcing both reads the same thing twice.
						It only moves while an answer is arriving, which is when there is
						something down there to go back to.
					-->
					<span
						class="text-gray-500 dark:text-gray-400 {generating ? 'animate-bounce' : ''}"
						aria-hidden="true"
					>
						<ChevronDown className="size-3.5" strokeWidth="2.5" />
					</span>
					<span class="text-gray-700 dark:text-gray-200">{$i18n.t('Jump to latest')}</span>
				</button>
			</Tooltip>
		</div>
	</div>
{/if}
