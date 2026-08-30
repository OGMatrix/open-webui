<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Dropdown from '$lib/components/common/Dropdown.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import LightBulb from '$lib/components/icons/LightBulb.svelte';
	import Check from '$lib/components/icons/Check.svelte';
	import type { ReasoningLevel, ReasoningMode } from '$lib/utils/reasoning';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let mode: ReasoningMode | null = null;
	export let level: ReasoningLevel | null = null;
	export let onSelect: (level: ReasoningLevel | null) => void = () => {};

	let show = false;

	// A model that only offers on/off reads better as On than as "High".
	$: isSwitch = (mode?.levels?.length ?? 0) === 2 && (mode?.levels ?? []).includes('off');

	const labelFor = (value: ReasoningLevel) => {
		if (value === 'off') return $i18n.t('Off');
		if (value === 'high' && isSwitch) return $i18n.t('On');
		if (value === 'minimal') return $i18n.t('Minimal');
		if (value === 'low') return $i18n.t('Low');
		if (value === 'medium') return $i18n.t('Medium');
		return $i18n.t('High');
	};

	const hintFor = (value: ReasoningLevel) => {
		if (value === 'off') return $i18n.t('Answer directly, without thinking first.');
		if (value === 'minimal') return $i18n.t('Barely any thinking. Fastest.');
		if (value === 'low') return $i18n.t('A little thinking, for simple questions.');
		if (value === 'medium') return $i18n.t('A balance of thinking and speed.');
		return isSwitch
			? $i18n.t('Think before answering.')
			: $i18n.t('Think hard. Slowest, and uses the most tokens.');
	};

	// Off is a deliberate choice too, so it stays highlighted rather than looking unset.
	$: active = level !== null;
	$: triggerLabel = level === null ? $i18n.t('Thinking') : labelFor(level);
</script>

{#if mode}
	<Dropdown bind:show side="top" align="start" sideOffset={6} contentClass="w-60">
		<Tooltip content={$i18n.t('Thinking effort')} placement="top">
			<button
				type="button"
				aria-label={$i18n.t('Thinking effort')}
				class="group flex max-w-full items-center gap-1.5 overflow-hidden rounded-full p-[0.375rem] text-sm transition-colors duration-300 focus:outline-hidden {active
					? 'border border-amber-200/40 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-600/10'
					: 'bg-transparent text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'}"
			>
				<LightBulb className="size-4" strokeWidth="1.75" />
				<div class="{active ? 'block' : 'hidden group-hover:block'} truncate pr-0.5">
					{triggerLabel}
				</div>
			</button>
		</Tooltip>

		<div slot="content" class="text-sm">
			<div
				class="px-3 pt-2 pb-1 text-[0.6875rem] font-medium tracking-wide text-gray-400 uppercase dark:text-gray-500"
			>
				{$i18n.t('Thinking effort')}
			</div>

			<div class="px-1 pb-1">
				{#each mode.levels as value (value)}
					<button
						type="button"
						class="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800"
						on:click={() => {
							onSelect(value);
							show = false;
						}}
					>
						<div class="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-300">
							{#if level === value}
								<Check className="size-3.5" strokeWidth="2.5" />
							{/if}
						</div>
						<div class="min-w-0">
							<div class="font-medium">{labelFor(value)}</div>
							<div class="text-xs text-gray-500 dark:text-gray-400">{hintFor(value)}</div>
						</div>
					</button>
				{/each}

				<div class="my-1 border-t border-gray-100 dark:border-gray-800"></div>

				<button
					type="button"
					class="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-gray-50 dark:hover:bg-gray-800"
					on:click={() => {
						onSelect(null);
						show = false;
					}}
				>
					<div class="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-300">
						{#if level === null}
							<Check className="size-3.5" strokeWidth="2.5" />
						{/if}
					</div>
					<div class="min-w-0">
						<div class="font-medium">{$i18n.t('Model default')}</div>
						<div class="text-xs text-gray-500 dark:text-gray-400">
							{$i18n.t('Send nothing and let the model decide.')}
						</div>
					</div>
				</button>
			</div>
		</div>
	</Dropdown>
{/if}
