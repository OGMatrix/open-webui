<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { formatSize, joinPath, looksTextual, type DiffedEntry } from '$lib/utils/fileTree';

	import Spinner from '$lib/components/common/Spinner.svelte';
	import ChevronRight from '$lib/components/icons/ChevronRight.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
	import FolderIcon from '$lib/components/icons/Folder.svelte';
	import Document from '$lib/components/icons/Document.svelte';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let entry: DiffedEntry;
	export let path: string;
	export let depth = 0;

	export let expanded: Record<string, boolean> = {};
	export let listings: Record<string, DiffedEntry[]> = {};
	export let loadingPaths: Record<string, boolean> = {};
	export let pathErrors: Record<string, string> = {};
	export let unparsed: Record<string, string> = {};

	export let canRead = false;
	export let selectedPath: string | null = null;

	export let onToggle: (path: string) => void = () => {};
	export let onOpen: (path: string) => void = () => {};

	$: isDirectory = entry.type === 'directory';
	$: isOpen = expanded[path] ?? false;
	/**
	 * A removed entry is a record of what went away, not a thing to open.
	 * Clicking it would ask the server for a path that is no longer there.
	 */
	$: gone = entry.change === 'removed';
	$: children = listings[path] ?? [];
	/**
	 * Whether opening this would show anything.
	 *
	 * The read tool returns text. Asking it for a PNG gives back bytes rendered
	 * as mojibake, so a file that cannot be read as text is not offered as one.
	 */
	$: openable = isDirectory || (canRead && looksTextual(entry.name));

	const CHANGE_LABEL: Record<string, string> = {
		added: 'Added',
		removed: 'Removed',
		modified: 'Changed'
	};

	const CHANGE_DOT: Record<string, string> = {
		added: 'bg-emerald-500',
		removed: 'bg-red-500',
		modified: 'bg-amber-500'
	};
</script>

<div>
	<button
		type="button"
		disabled={gone || !openable}
		aria-expanded={isDirectory ? isOpen : undefined}
		aria-current={selectedPath === path ? 'true' : undefined}
		class="group flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left text-xs transition-colors focus:outline-hidden disabled:cursor-default {selectedPath ===
		path
			? 'bg-gray-100 dark:bg-gray-850'
			: 'hover:bg-gray-100 dark:hover:bg-gray-850'} {gone
			? 'opacity-50 line-through hover:bg-transparent dark:hover:bg-transparent'
			: ''}"
		style="padding-left: {0.375 + depth * 0.75}rem"
		on:click={() => (isDirectory ? onToggle(path) : onOpen(path))}
	>
		{#if isDirectory}
			{#if isOpen}
				<ChevronDown className="size-3 shrink-0 text-gray-400" strokeWidth="2" />
			{:else}
				<ChevronRight className="size-3 shrink-0 text-gray-400" strokeWidth="2" />
			{/if}
			<FolderIcon className="size-3.5 shrink-0 text-gray-400" strokeWidth="1.75" />
		{:else}
			<span class="size-3 shrink-0" aria-hidden="true"></span>
			<Document className="size-3.5 shrink-0 text-gray-400" strokeWidth="1.75" />
		{/if}

		<span class="min-w-0 flex-1 truncate" dir="ltr">{entry.name}</span>

		{#if entry.change}
			<!--
				A dot rather than a word: the row is narrow, and the label is on the
				dot for anyone who needs it read out.
			-->
			<span
				class="size-1.5 shrink-0 rounded-full {CHANGE_DOT[entry.change]}"
				title={$i18n.t(CHANGE_LABEL[entry.change])}
				aria-label={$i18n.t(CHANGE_LABEL[entry.change])}
			></span>
		{/if}

		{#if !isDirectory && formatSize(entry.size)}
			<span class="shrink-0 text-[0.625rem] tabular-nums text-gray-400">
				{formatSize(entry.size)}
			</span>
		{/if}
	</button>

	{#if isDirectory && isOpen}
		{#if loadingPaths[path]}
			<div
				class="flex items-center py-1 text-gray-400"
				style="padding-left: {0.375 + (depth + 1) * 0.75}rem"
			>
				<Spinner className="size-3" />
			</div>
		{/if}

		{#if pathErrors[path]}
			<div
				class="py-1 pr-2 text-[0.6875rem] text-red-500 dark:text-red-400"
				style="padding-left: {0.375 + (depth + 1) * 0.75}rem"
			>
				{pathErrors[path]}
			</div>
		{/if}

		{#if unparsed[path]}
			<!--
				The server answered something this app could not read as a listing.
				Showing it beats an empty folder, which would be a claim that there
				is nothing here.
			-->
			<pre
				class="whitespace-pre-wrap break-words py-1 pr-2 text-[0.625rem] text-gray-500 dark:text-gray-400"
				style="padding-left: {0.375 + (depth + 1) * 0.75}rem">{unparsed[path]}</pre>
		{/if}

		{#each children as child (child.name)}
			<svelte:self
				entry={child}
				path={joinPath(path, child.name)}
				depth={depth + 1}
				{expanded}
				{listings}
				{loadingPaths}
				{pathErrors}
				{unparsed}
				{canRead}
				{selectedPath}
				{onToggle}
				{onOpen}
			/>
		{/each}

		{#if children.length === 0 && !loadingPaths[path] && !pathErrors[path] && !unparsed[path] && listings[path]}
			<div
				class="py-1 text-[0.6875rem] text-gray-400"
				style="padding-left: {0.375 + (depth + 1) * 0.75}rem"
			>
				{$i18n.t('Empty')}
			</div>
		{/if}
	{/if}
</div>
