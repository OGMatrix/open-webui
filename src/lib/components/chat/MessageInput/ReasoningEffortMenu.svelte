<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import Dropdown from '$lib/components/common/Dropdown.svelte';
	import DropdownMenu from '$lib/components/common/DropdownMenu.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import LightBulb from '$lib/components/icons/LightBulb.svelte';
	import Check from '$lib/components/icons/Check.svelte';
	import type { ReasoningLevel, ReasoningMode } from '$lib/utils/reasoning';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let mode: ReasoningMode | null = null;
	export let level: ReasoningLevel | null = null;
	export let onSelect: (level: ReasoningLevel | null) => void = () => {};

	let show = false;

	// Models whose thinking is a plain switch get a toggle, not a menu with two
	// entries in it.
	$: isSwitch = (mode?.levels?.length ?? 0) === 2 && (mode?.levels ?? []).includes('off');
	$: switchedOn = isSwitch && level !== null && level !== 'off';

	const LABELS: Record<ReasoningLevel, string> = {
		off: 'Off',
		minimal: 'Minimal',
		low: 'Low',
		medium: 'Medium',
		high: 'High',
		xhigh: 'Extra high'
	};

	const labelFor = (value: ReasoningLevel) => $i18n.t(LABELS[value]);

	$: active = level !== null;

	// Icon-only pills, so the current choice belongs in the tooltip.
	$: switchTooltip = `${$i18n.t('Thinking')}: ${switchedOn ? $i18n.t('On') : $i18n.t('Off')}`;
	$: menuTooltip =
		level === null
			? `${$i18n.t('Thinking effort')}: ${$i18n.t('Model default')}`
			: `${$i18n.t('Thinking effort')}: ${labelFor(level)}`;

	const pillClass = (on: boolean) =>
		`group flex max-w-full items-center gap-1.5 overflow-hidden rounded-full p-[0.375rem] text-sm transition-colors duration-300 focus:outline-hidden ${
			on
				? 'border border-amber-200/40 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-400/10 dark:text-amber-300 dark:hover:bg-amber-600/10'
				: 'bg-transparent text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
		}`;
</script>

{#if mode}
	{#if isSwitch}
		<Tooltip content={switchTooltip} placement="top">
			<button
				type="button"
				aria-label={$i18n.t('Thinking')}
				aria-pressed={switchedOn}
				class={pillClass(switchedOn)}
				on:click|preventDefault={() => onSelect(switchedOn ? 'off' : 'high')}
			>
				<LightBulb className="size-4" strokeWidth="1.75" />
			</button>
		</Tooltip>
	{:else}
		<Dropdown bind:show side="top" align="start" sideOffset={6}>
			<Tooltip content={menuTooltip} placement="top">
				<button type="button" aria-label={$i18n.t('Thinking effort')} class={pillClass(active)}>
					<LightBulb className="size-4" strokeWidth="1.75" />
				</button>
			</Tooltip>

			<div slot="content">
				<DropdownMenu className="select-none min-w-[10rem]">
					{#each mode.levels as value (value)}
						<button
							type="button"
							on:click={() => {
								onSelect(value);
								show = false;
							}}
						>
							<div class="size-3.5 shrink-0">
								{#if level === value}
									<Check className="size-3.5" strokeWidth="2.5" />
								{/if}
							</div>
							<div class="flex items-center">{labelFor(value)}</div>
						</button>
					{/each}

					<hr class="border-gray-100 dark:border-gray-800" />

					<button
						type="button"
						on:click={() => {
							onSelect(null);
							show = false;
						}}
					>
						<div class="size-3.5 shrink-0">
							{#if level === null}
								<Check className="size-3.5" strokeWidth="2.5" />
							{/if}
						</div>
						<div class="flex items-center">{$i18n.t('Model default')}</div>
					</button>
				</DropdownMenu>
			</div>
		</Dropdown>
	{/if}
{/if}
