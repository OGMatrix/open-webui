<script lang="ts">
	/**
	 * What the task model thinks this message needs, offered rather than applied.
	 *
	 * It sits above the prompt box, in the place already used for the things
	 * worth knowing before sending, and it holds the message only as long as it
	 * takes to answer. Every row is a choice: nothing changes until it is ticked
	 * and taken.
	 */
	import { getContext } from 'svelte';
	import { fly } from 'svelte/transition';

	import Spinner from '$lib/components/common/Spinner.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Sparkles from '$lib/components/icons/Sparkles.svelte';
	import Wrench from '$lib/components/icons/Wrench.svelte';
	import Cube from '$lib/components/icons/Cube.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import Photo from '$lib/components/icons/Photo.svelte';
	import Terminal from '$lib/components/icons/Terminal.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	import {
		CODE_INTERPRETER,
		IMAGE_GENERATION,
		WEB_SEARCH,
		suggestedItems,
		type SuggestionItem,
		type ToolSuggestion
	} from '$lib/utils/toolSuggestions';

	const i18n = getContext('i18n') as any;

	/** 'asking' while the model is being asked, 'offering' once it has answered. */
	export let state: 'idle' | 'asking' | 'offering' = 'idle';
	export let suggestion: ToolSuggestion | null = null;

	export let onApply: (chosen: Set<string>) => void = () => {};
	export let onDismiss: () => void = () => {};
	export let onCancel: () => void = () => {};
	export let onNeverAgain: () => void = () => {};

	let chosen = new Set<string>();

	// A fresh suggestion starts with everything ticked: the common answer is
	// "yes, all of it", and un-ticking is easier than hunting for the one row
	// that mattered.
	$: if (suggestion) {
		chosen = new Set(suggestedItems(suggestion).map((item) => item.id));
	}

	const toggle = (id: string) => {
		const next = new Set(chosen);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		chosen = next;
	};

	const label = (item: SuggestionItem) => (item.on ? $i18n.t('Switch on') : $i18n.t('Switch off'));
</script>

{#if state === 'asking'}
	<div
		class="mx-1 mb-1 flex items-center gap-2 rounded-2xl bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:bg-gray-850/60 dark:text-gray-300"
		role="status"
		in:fly={{ y: 4, duration: 120 }}
	>
		<Spinner className="size-3.5 shrink-0" />
		<div class="min-w-0 flex-1 truncate">{$i18n.t('Checking which integrations this needs…')}</div>

		<button
			type="button"
			class="shrink-0 rounded-lg px-2 py-0.5 font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
			on:click={onCancel}
		>
			{$i18n.t('Send now')}
		</button>
	</div>
{:else if state === 'offering' && suggestion}
	<div
		class="mx-1 mb-1 rounded-2xl bg-gray-50 px-3 py-2 text-xs text-gray-700 dark:bg-gray-850/60 dark:text-gray-200"
		role="group"
		aria-label={$i18n.t('Suggested integrations for this message')}
		in:fly={{ y: 4, duration: 120 }}
	>
		<div class="flex items-start gap-2">
			<Sparkles className="size-3.5 shrink-0 mt-0.5 text-gray-500" />

			<div class="min-w-0 flex-1">
				<div class="font-medium">
					{suggestion.reason || $i18n.t('This message might need a different set switched on.')}
				</div>

				<div class="mt-1.5 flex flex-wrap gap-1">
					{#each suggestedItems(suggestion) as item (item.id)}
						<Tooltip content={item.description || item.name} placement="top-start">
							<button
								type="button"
								class="flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 transition-colors {chosen.has(
									item.id
								)
									? 'border-gray-300 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white'
									: 'border-transparent bg-gray-100/70 text-gray-500 line-through dark:bg-gray-800/60 dark:text-gray-400'}"
								aria-pressed={chosen.has(item.id)}
								on:click={() => toggle(item.id)}
							>
								<div class="shrink-0 text-gray-500">
									{#if item.id === WEB_SEARCH}
										<GlobeAlt className="size-3" strokeWidth="1.75" />
									{:else if item.id === IMAGE_GENERATION}
										<Photo className="size-3" strokeWidth="1.75" />
									{:else if item.id === CODE_INTERPRETER}
										<Terminal className="size-3" strokeWidth="1.75" />
									{:else if item.kind === 'skill'}
										<Cube className="size-3" strokeWidth="1.75" />
									{:else}
										<Wrench className="size-3" />
									{/if}
								</div>

								<span class="shrink-0 text-gray-500">{label(item)}</span>
								<span class="min-w-0 truncate">{item.name}</span>
							</button>
						</Tooltip>
					{/each}
				</div>
			</div>

			<Tooltip content={$i18n.t('Stop suggesting integrations')} placement="top-end">
				<button
					type="button"
					class="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
					aria-label={$i18n.t('Stop suggesting integrations')}
					on:click={onNeverAgain}
				>
					<XMark className="size-3.5" strokeWidth="2" />
				</button>
			</Tooltip>
		</div>

		<div class="mt-2 flex items-center justify-end gap-1">
			<button
				type="button"
				class="rounded-lg px-2 py-1 font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
				on:click={onDismiss}
			>
				{$i18n.t('Send as is')}
			</button>

			<button
				type="button"
				class="rounded-lg bg-gray-900 px-2.5 py-1 font-medium text-white hover:bg-black disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
				disabled={chosen.size === 0}
				on:click={() => onApply(chosen)}
			>
				{$i18n.t('Apply and send')}
			</button>
		</div>
	</div>
{/if}
