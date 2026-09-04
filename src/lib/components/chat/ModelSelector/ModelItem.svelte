<script lang="ts">
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { marked } from 'marked';

	import { getContext, tick } from 'svelte';

	import { mobile, settings, user } from '$lib/stores';
	import { WEBUI_API_BASE_URL, WEBUI_BASE_URL } from '$lib/constants';

	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import { copyToClipboard, sanitizeResponseContent } from '$lib/utils';
	import { resolveLocalizedModelDescription } from '$lib/utils/localizedContent';
	import ArrowUpTray from '$lib/components/icons/ArrowUpTray.svelte';
	import ArrowDownTray from '$lib/components/icons/ArrowDownTray.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Check from '$lib/components/icons/Check.svelte';
	import LoadIndicator from './LoadIndicator.svelte';
	import ModelItemMenu from './ModelItemMenu.svelte';
	import EllipsisHorizontal from '$lib/components/icons/EllipsisHorizontal.svelte';
	import { toast } from 'svelte-sonner';
	import Tag from '$lib/components/icons/Tag.svelte';
	import Label from '$lib/components/icons/Label.svelte';
	import type { NameParts } from '$lib/utils/modelNames';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let selectedModelIdx: number = -1;
	export let item: any = {};
	export let index: number = -1;
	export let value: string | null = '';
	export let selectedValues: string[] = [];
	export let compareEnabled = false;

	export let unloadModelHandler: (model: any) => void = () => {};
	export let loadModelHandler: (model: any) => void = () => {};
	/** True when this model's connection can be told to load it. */
	export let canLoad = false;
	/** True while a load for this model is in flight. */
	export let isLoading = false;
	export let pinModelHandler: (modelId: string) => void = () => {};
	export let deleteModelHandler: (model: any) => void = () => {};
	export let selectionOnly = false;
	/** The name already split into the part it shares with its neighbours and the rest. */
	export let nameParts: NameParts | undefined = undefined;

	/**
	 * Which backend this row comes from, or empty when saying so adds nothing.
	 *
	 * The selector decides: it can see the whole list, and a provider that
	 * every model shares is not a distinction.
	 */
	export let providerName = '';

	$: parts = nameParts ?? { head: '', body: item.label ?? '', tail: '' };

	export let onClick: () => void = () => {};

	$: localizedDescription = resolveLocalizedModelDescription(item.model, $i18n.language);

	const copyLinkHandler = async (model) => {
		const baseUrl = window.location.origin;
		const res = await copyToClipboard(`${baseUrl}/?model=${encodeURIComponent(model.id)}`);

		if (res) {
			toast.success($i18n.t('Copied link to clipboard'));
		} else {
			toast.error($i18n.t('Failed to copy link'));
		}
	};

	const formatSize = (size?: number) => (size ? `(${(size / 1024 ** 3).toFixed(1)}GB)` : '');

	let showMenu = false;
	$: isSelected = compareEnabled ? selectedValues.includes(item.value) : value === item.value;
</script>

<button
	role="option"
	aria-selected={isSelected}
	aria-label={$i18n.t('Select {{modelName}} model', { modelName: item.label })}
	class="focus-ring group/item flex h-8 w-full cursor-pointer select-none items-center rounded-xl px-2 text-left text-[0.8125rem] font-normal text-gray-700 outline-hidden transition-colors duration-75 dark:text-gray-100 {($settings?.highContrastMode ??
	false)
		? 'hover:bg-gray-200 dark:hover:bg-gray-800'
		: 'hover:bg-gray-50/40 dark:hover:bg-gray-800/40'} {index === selectedModelIdx &&
	!compareEnabled
		? ($settings?.highContrastMode ?? false)
			? 'bg-gray-200 dark:bg-gray-800'
			: 'bg-gray-50/70 dark:bg-gray-800/60'
		: ''} {isSelected
		? ($settings?.highContrastMode ?? false)
			? 'bg-gray-200 dark:bg-gray-800'
			: 'bg-gray-50/70 dark:bg-gray-800/60'
		: ''}"
	data-arrow-selected={index === selectedModelIdx}
	data-value={item.value}
	on:click={() => {
		onClick();
	}}
>
	<div class="flex flex-1 flex-col gap-1.5 overflow-hidden">
		<!-- {#if (item?.model?.tags ?? []).length > 0}
			<div
				class="flex gap-0.5 self-center items-start h-full w-full translate-y-[0.5px] overflow-x-auto scrollbar-none"
			>
				{#each item.model?.tags.sort((a, b) => a.name.localeCompare(b.name)) as tag}
					<Tooltip content={tag.name} className="flex-shrink-0">
						<div
							class=" text-xs font-normal px-1 rounded-sm uppercase bg-gray-500/20 text-gray-700 dark:text-gray-200"
						>
							{tag.name}
						</div>
					</Tooltip>
				{/each}
			</div>
		{/if} -->

		<div class="flex items-center gap-2 overflow-hidden">
			<div class="flex items-center min-w-fit">
				<Tooltip content={$user?.role === 'admin' ? (item?.value ?? '') : ''} placement="top-start">
					<img
						src={`${WEBUI_API_BASE_URL}/models/model/profile/image?id=${item.model.id}&lang=${$i18n.language}`}
						alt={$i18n.t('{{modelName}} profile image', { modelName: item.label })}
						class="flex size-4 items-center rounded-full"
						loading="lazy"
						on:error={(e) => {
							// LICENSE covers this Open WebUI fallback logo.
							// Do not alter, remove, obscure, or replace it except as LICENSE permits:
							// https://docs.openwebui.com/license.
							e.currentTarget.src = '/favicon.png';
						}}
					/>
				</Tooltip>
			</div>

			<div class="flex min-w-0 items-center">
				<Tooltip
					content={`${item.label} (${item.value})`}
					placement="top-start"
					className="flex min-w-0"
				>
					<!--
						The shared part of the name stays readable but steps back, so what
						separates this model from the rest is what the eye lands on.

						It is also the part that goes when the row runs out of room. What
						tells qwen3.8-27b-mtp-256k from qwen3.8-27b-256k sits at the end,
						exactly where a plain truncation cuts first, and four rows reading
						"qwen3.8-27b-..." name nothing at all. The opening is muted and
						already said by the heading above, so it gives way a thousand times
						more readily than the part that does the telling.
					-->
					<div class="flex min-w-0 items-baseline whitespace-nowrap">
						{#if parts.head}<span
								class="name-head min-w-0 truncate text-gray-400 dark:text-gray-500"
								>{parts.head}</span
							>{/if}<span class="name-body min-w-0 truncate">{parts.body}</span
						>{#if parts.tail}<span
								class="name-tail min-w-0 truncate text-gray-400 dark:text-gray-500"
								>{parts.tail}</span
							>{/if}
					</div>
				</Tooltip>
			</div>

			<div class="flex shrink-0 items-center gap-1.5">
				{#if providerName}
					<Tooltip content={$i18n.t('Served by {{provider}}', { provider: providerName })}>
						<span
							class="shrink-0 rounded-sm bg-gray-100 px-1 py-px text-[0.625rem] font-medium whitespace-nowrap text-gray-500 dark:bg-white/[0.06] dark:text-gray-400"
						>
							{providerName}
						</span>
					</Tooltip>
				{/if}

				{#if item.model.owned_by === 'ollama'}
					{#if (item.model.ollama?.details?.parameter_size ?? '') !== ''}
						<div class="flex items-center translate-y-[0.5px]">
							<Tooltip
								content={`${
									item.model.ollama?.details?.quantization_level
										? item.model.ollama?.details?.quantization_level + ' '
										: ''
								}${
									item.model.ollama?.size
										? `(${(item.model.ollama?.size / 1024 ** 3).toFixed(1)}GB)`
										: ''
								}`}
								className="self-end"
							>
								<span
									class="line-clamp-1 text-[0.6875rem] font-normal text-gray-500 dark:text-gray-400"
									>{item.model.ollama?.details?.parameter_size ?? ''}</span
								>
							</Tooltip>
						</div>
					{/if}
				{:else if item.model.provider === 'lmstudio' || item.model.provider === 'llama.cpp'}
					{@const parameterSize =
						item.model.params_string ?? item.model.details?.parameter_size ?? ''}
					{@const quantization =
						item.model.quantization?.name ?? item.model.details?.quantization_level ?? ''}
					{@const size = item.model.size_bytes ?? item.model.size}
					{#if parameterSize || quantization || size}
						<div class="flex items-center translate-y-[0.5px]">
							<Tooltip
								content={`${quantization ? `${quantization} ` : ''}${formatSize(size)}`}
								className="self-end"
							>
								<span
									class="line-clamp-1 text-[0.6875rem] font-normal text-gray-500 dark:text-gray-400"
								>
									{parameterSize || quantization || formatSize(size)}
								</span>
							</Tooltip>
						</div>
					{/if}
				{/if}

				<LoadIndicator model={item.model} />

				<!-- {JSON.stringify(item.info)} -->

				{#if (item?.model?.tags ?? []).length > 0}
					{#key item.model.id}
						<Tooltip elementId="tags-{item.model.id}">
							<div slot="tooltip" id="tags-{item.model.id}">
								{#each item.model?.tags.sort((a, b) => a.name.localeCompare(b.name)) as tag}
									<Tooltip content={tag.name} className="flex-shrink-0">
										<div class=" text-xs font-normal rounded-sm uppercase text-white">
											{tag.name}
										</div>
									</Tooltip>
								{/each}
							</div>

							<div class="translate-y-[1px]">
								<Tag />
							</div>
						</Tooltip>
					{/key}
				{/if}

				{#if item.model?.direct}
					<Tooltip content={`${$i18n.t('Direct')}`}>
						<div class="translate-y-[1px]">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 16 16"
								fill="currentColor"
								class="size-3"
							>
								<path
									fill-rule="evenodd"
									d="M2 2.75A.75.75 0 0 1 2.75 2C8.963 2 14 7.037 14 13.25a.75.75 0 0 1-1.5 0c0-5.385-4.365-9.75-9.75-9.75A.75.75 0 0 1 2 2.75Zm0 4.5a.75.75 0 0 1 .75-.75 6.75 6.75 0 0 1 6.75 6.75.75.75 0 0 1-1.5 0C8 10.35 5.65 8 2.75 8A.75.75 0 0 1 2 7.25ZM3.5 11a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
									clip-rule="evenodd"
								/>
							</svg>
						</div>
					</Tooltip>
				{:else if item.model.connection_type === 'external'}
					<Tooltip content={`${$i18n.t('External')}`}>
						<div class="translate-y-[1px]">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 16 16"
								fill="currentColor"
								class="size-3"
							>
								<path
									fill-rule="evenodd"
									d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.5 3.5 0 0 1 0 4.95l-2 2a3.5 3.5 0 0 1-5.396-4.402.75.75 0 0 1 1.251.827 2 2 0 0 0 3.085 2.514l2-2a2 2 0 0 0 0-2.828.75.75 0 0 1 0-1.06Z"
									clip-rule="evenodd"
								/>
								<path
									fill-rule="evenodd"
									d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.5 3.5 0 0 1 0-4.95l2-2a3.5 3.5 0 0 1 5.396 4.402.75.75 0 0 1-1.251-.827 2 2 0 0 0-3.085-2.514l-2 2a2 2 0 0 0 0 2.828.75.75 0 0 1 0 1.06Z"
									clip-rule="evenodd"
								/>
							</svg>
						</div>
					</Tooltip>
				{/if}

				{#if localizedDescription}
					<Tooltip
						content={`${marked.parse(
							sanitizeResponseContent(localizedDescription).replaceAll('\n', '<br>')
						)}`}
					>
						<div class=" translate-y-[1px]">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke="currentColor"
								class="w-4 h-4"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
								/>
							</svg>
						</div>
					</Tooltip>
				{/if}
			</div>
		</div>
	</div>

	<div class="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
		{#if !selectionOnly && $user?.role === 'admin' && canLoad}
			<Tooltip
				content={isLoading ? `${$i18n.t('Loading')}` : `${$i18n.t('Load model')}`}
				className="flex-shrink-0 {isLoading ? '' : 'group-hover/item:opacity-100 opacity-0'}"
			>
				<button
					class="focus-ring flex disabled:opacity-50"
					aria-label={$i18n.t('Load model')}
					disabled={isLoading}
					on:click={(e) => {
						e.preventDefault();
						e.stopPropagation();
						loadModelHandler(item.model);
					}}
				>
					{#if isLoading}
						<Spinner className="size-3" />
					{:else}
						<ArrowDownTray className="size-3" />
					{/if}
				</button>
			</Tooltip>
		{/if}

		{#if !selectionOnly && $user?.role === 'admin' && item.model.loaded}
			<Tooltip
				content={`${$i18n.t('Eject')}`}
				className="flex-shrink-0 group-hover/item:opacity-100 opacity-0 "
			>
				<button
					class="focus-ring flex"
					aria-label={$i18n.t('Eject model')}
					on:click={(e) => {
						e.preventDefault();
						e.stopPropagation();
						unloadModelHandler(item.value);
					}}
				>
					<ArrowUpTray className="size-3" />
				</button>
			</Tooltip>
		{/if}

		{#if !selectionOnly}
			<ModelItemMenu
				bind:show={showMenu}
				model={item.model}
				{pinModelHandler}
				{deleteModelHandler}
				copyLinkHandler={() => {
					copyLinkHandler(item.model);
				}}
			>
				<button
					aria-label={`${$i18n.t('More Options')}`}
					class="focus-ring flex"
					on:click={(e) => {
						e.preventDefault();
						e.stopPropagation();
						showMenu = !showMenu;
					}}
				>
					<EllipsisHorizontal />
				</button>
			</ModelItemMenu>
		{/if}

		{#if isSelected}
			<div>
				<Check className="size-3" />
			</div>
		{/if}
	</div>
</button>

<style>
	/*
	 * Which part of a name gives way when the row is too narrow.
	 *
	 * Flex shrinks each item in proportion to its factor, so these are an order
	 * of priority rather than three sizes: the muted opening collapses first and
	 * takes its own ellipsis, the shared ending next, and the part that actually
	 * picks this model out is the last thing to go. A row too narrow for even
	 * that still shows its beginning, which is the best that is left.
	 */
	.name-head {
		flex: 0 1000 auto;
	}

	.name-tail {
		flex: 0 10 auto;
	}

	.name-body {
		flex: 0 1 auto;
	}
</style>
