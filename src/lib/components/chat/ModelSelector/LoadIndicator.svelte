<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import dayjs from '$lib/dayjs';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import { loadState, unloadsAt } from '$lib/utils/modelLoaded';

	const i18n: Writable<i18nType> = getContext('i18n');

	export let model: any = null;

	/**
	 * Whether to draw the state when the model is *not* loaded.
	 *
	 * In a list it is left off: one green dot among forty rows already says
	 * which is warm, and forty grey ones would only be noise. On the collapsed
	 * selector there is nothing to compare against, so a single control has to
	 * say both halves itself or it says nothing.
	 */
	export let showUnloaded = false;

	export let className = '';

	$: state = loadState(model);
	$: expiry = state === 'loaded' ? unloadsAt(model) : null;
	$: title =
		state === 'loaded'
			? expiry
				? $i18n.t('Unloads {{FROM_NOW}}', { FROM_NOW: dayjs(expiry).fromNow() })
				: $i18n.t('Loaded')
			: $i18n.t('Not loaded');
</script>

{#if state === 'loaded' || (state === 'unloaded' && showUnloaded)}
	<div class="flex items-center px-0.5 {className}">
		<Tooltip content={title} className="self-end">
			<div class="flex items-center">
				{#if state === 'loaded'}
					<span class="relative flex size-1.5">
						<!--
							The ping is the whole signal at a glance, so it is the one thing
							that has to survive: a still dot at this size reads as a bullet.
						-->
						<span
							class="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
						></span>
						<span class="relative inline-flex size-1.5 rounded-full bg-green-500"></span>
					</span>
				{:else}
					<!--
						Hollow rather than filled, and still. Read next to the loaded dot it
						is plainly the other state, and read alone it does not claim
						attention the way a solid mark would.
					-->
					<span
						class="size-1.5 rounded-full border border-gray-400 dark:border-gray-500"
						aria-hidden="true"
					></span>
				{/if}
			</div>
		</Tooltip>
	</div>
{/if}

<style>
	/* A dot that pulses is a dot that moves, and some people asked for less. */
	@media (prefers-reduced-motion: reduce) {
		.animate-ping {
			animation: none;
			opacity: 0.35;
		}
	}
</style>
