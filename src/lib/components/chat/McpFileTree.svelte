<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { callMCPFilesystem, type MCPFilesystemServer } from '$lib/apis/tools';
	import {
		baseName,
		countChanges,
		diffListing,
		joinPath,
		type DiffedEntry,
		type FileEntry
	} from '$lib/utils/fileTree';

	import McpFileTreeNode from './McpFileTreeNode.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ChevronRight from '$lib/components/icons/ChevronRight.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
	import Document from '$lib/components/icons/Document.svelte';
	import ArrowPath from '$lib/components/icons/ArrowPath.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';

	const i18n = getContext<Writable<i18nType>>('i18n');

	/**
	 * The servers to browse, found by the panel that owns this tab.
	 *
	 * Not fetched here: the tab is only drawn once something knows there is a
	 * filesystem to show, and asking twice would dial every server twice.
	 */
	export let servers: MCPFilesystemServer[] = [];

	let serverId: string | null = null;

	/** Entries by directory path, as last read. */
	let listings: Record<string, DiffedEntry[]> = {};
	/** The reading before the current one, which is what makes a change visible. */
	let previous: Record<string, FileEntry[]> = {};
	let expanded: Record<string, boolean> = {};
	let loadingPaths: Record<string, boolean> = {};
	let pathErrors: Record<string, string> = {};
	/** What a server said when its answer could not be read as a listing. */
	let unparsed: Record<string, string> = {};

	let preview: { path: string; text: string } | null = null;
	let previewLoading = false;
	let previewError: string | null = null;

	$: server = servers.find((entry) => entry.id === serverId) ?? null;
	$: roots = server?.roots ?? [];
	$: canRead = (server?.operations ?? []).includes('read');
	$: changed = Object.values(listings).reduce((total, entries) => total + countChanges(entries), 0);

	/**
	 * Read one directory, keeping the previous reading to compare against.
	 *
	 * `refresh` is what a re-read means: the listing that was on screen becomes
	 * the baseline, so what comes back can be marked against it.
	 */
	const readDirectory = async (path: string, refresh = false) => {
		if (!serverId) return;

		if (refresh && listings[path]) {
			previous[path] = listings[path].filter((entry) => entry.change !== 'removed');
		}

		loadingPaths = { ...loadingPaths, [path]: true };
		delete pathErrors[path];
		pathErrors = pathErrors;

		try {
			const result = await callMCPFilesystem(localStorage.token, serverId, 'list', { path });
			const entries: FileEntry[] = result?.entries ?? [];

			listings = { ...listings, [path]: diffListing(previous[path] ?? null, entries) };

			// A server that answered something the parser did not recognise has
			// said *something*; showing it beats an empty folder that may not be.
			if (result?.parsed === false && (result?.raw ?? '').trim()) {
				unparsed = { ...unparsed, [path]: result.raw };
			} else {
				delete unparsed[path];
				unparsed = unparsed;
			}
		} catch (error) {
			pathErrors = { ...pathErrors, [path]: `${error}` };
		} finally {
			loadingPaths = { ...loadingPaths, [path]: false };
		}
	};

	const toggle = async (path: string) => {
		if (expanded[path]) {
			expanded = { ...expanded, [path]: false };
			return;
		}

		expanded = { ...expanded, [path]: true };
		if (!listings[path]) await readDirectory(path);
	};

	/** Re-read everything already open, so a change anywhere shows at once. */
	const refreshAll = async () => {
		const open = Object.keys(listings);
		await Promise.all(open.map((path) => readDirectory(path, true)));
	};

	const openFile = async (path: string) => {
		if (!serverId || !canRead) return;

		preview = { path, text: '' };
		previewLoading = true;
		previewError = null;

		try {
			const result = await callMCPFilesystem(localStorage.token, serverId, 'read', { path });
			preview = { path, text: result?.text ?? '' };
		} catch (error) {
			previewError = `${error}`;
		} finally {
			previewLoading = false;
		}
	};

	const reset = () => {
		listings = {};
		previous = {};
		expanded = {};
		unparsed = {};
		pathErrors = {};
		preview = null;
	};

	// Switching servers means every path on screen belongs to a different
	// machine; keeping them would show one server's tree under another's name.
	let lastServerId: string | null = null;
	$: if (serverId !== lastServerId) {
		lastServerId = serverId;
		reset();
		if (serverId) {
			void tick().then(() => {
				for (const root of roots) {
					expanded = { ...expanded, [root]: true };
					void readDirectory(root);
				}
			});
		}
	}

	// The first server unless the choice is still valid, so switching chats
	// does not silently move the reader to a different machine's tree.
	$: if (!serverId || !servers.some((entry) => entry.id === serverId)) {
		serverId = servers[0]?.id ?? null;
	}
</script>

<div class="flex h-full w-full flex-col text-sm">
	{#if servers.length === 0}
		<div class="p-3 text-xs text-gray-500 dark:text-gray-400">
			{$i18n.t('No filesystem MCP server is connected.')}
		</div>
	{:else}
		<div
			class="flex items-center gap-1.5 border-b border-gray-100 px-2 py-1.5 dark:border-gray-850"
		>
			{#if servers.length > 1}
				<select
					bind:value={serverId}
					aria-label={$i18n.t('Server')}
					class="min-w-0 flex-1 truncate bg-transparent text-xs outline-hidden"
				>
					{#each servers as entry (entry.id)}
						<option value={entry.id}>{entry.name}</option>
					{/each}
				</select>
			{:else}
				<div class="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400">
					{server?.name ?? ''}
				</div>
			{/if}

			{#if changed > 0}
				<!--
					The reason to keep the panel open: how much moved since the last
					look, without having to find it row by row.
				-->
				<span
					class="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[0.6875rem] text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"
				>
					{$i18n.t('{{COUNT}} changed', { COUNT: changed })}
				</span>
			{/if}

			<Tooltip content={$i18n.t('Refresh')} placement="bottom">
				<button
					type="button"
					aria-label={$i18n.t('Refresh')}
					class="flex size-6 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 focus:outline-hidden dark:text-gray-400 dark:hover:bg-gray-800"
					on:click={refreshAll}
				>
					<ArrowPath className="size-3.5" strokeWidth="2" />
				</button>
			</Tooltip>
		</div>

		<div class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-1 py-1">
			{#if roots.length === 0}
				<div class="p-2 text-xs text-gray-500 dark:text-gray-400">
					{$i18n.t('This server did not say which directories it can show.')}
				</div>
			{/if}

			{#each roots as root (root)}
				{@const rootEntries = listings[root] ?? []}
				<div class="mb-1">
					<button
						type="button"
						aria-expanded={expanded[root] ?? false}
						class="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium transition-colors hover:bg-gray-100 focus:outline-hidden dark:hover:bg-gray-850"
						on:click={() => toggle(root)}
					>
						{#if expanded[root]}
							<ChevronDown className="size-3 shrink-0 text-gray-400" strokeWidth="2" />
						{:else}
							<ChevronRight className="size-3 shrink-0 text-gray-400" strokeWidth="2" />
						{/if}
						<span class="truncate" dir="ltr">{root}</span>
					</button>

					{#if expanded[root]}
						<div class="pl-3">
							<!--
								One level at a time. A tool that walks the whole tree exists,
								but a project with a node_modules in it would make the first
								click take a minute and then flood the panel.
							-->
							{#if loadingPaths[root]}
								<div class="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400">
									<Spinner className="size-3" />
								</div>
							{/if}
							{#if pathErrors[root]}
								<div class="px-2 py-1 text-xs text-red-500 dark:text-red-400">
									{pathErrors[root]}
								</div>
							{/if}
							{#if unparsed[root]}
								<pre
									class="whitespace-pre-wrap break-words px-2 py-1 text-[0.6875rem] text-gray-500 dark:text-gray-400">{unparsed[
										root
									]}</pre>
							{/if}

							{#each rootEntries as entry (entry.name)}
								{@const path = joinPath(root, entry.name)}
								<McpFileTreeNode
									{entry}
									{path}
									depth={1}
									{expanded}
									{listings}
									{loadingPaths}
									{pathErrors}
									{unparsed}
									{canRead}
									selectedPath={preview?.path ?? null}
									onToggle={toggle}
									onOpen={openFile}
								/>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if preview}
			<div class="flex min-h-0 flex-1 flex-col border-t border-gray-100 dark:border-gray-850">
				<div class="flex items-center gap-1.5 px-2 py-1.5">
					<Document className="size-3.5 shrink-0 text-gray-400" strokeWidth="1.75" />
					<span class="min-w-0 flex-1 truncate text-xs" dir="ltr">{baseName(preview.path)}</span>
					<Tooltip content={$i18n.t('Close')} placement="bottom">
						<button
							type="button"
							aria-label={$i18n.t('Close')}
							class="flex size-6 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 focus:outline-hidden dark:text-gray-400 dark:hover:bg-gray-800"
							on:click={() => (preview = null)}
						>
							<XMark className="size-3.5" strokeWidth="2.5" />
						</button>
					</Tooltip>
				</div>

				<div class="scrollbar-hidden min-h-0 flex-1 overflow-auto px-2 pb-2">
					{#if previewLoading}
						<div class="flex items-center gap-2 py-2 text-xs text-gray-400">
							<Spinner className="size-3.5" />
						</div>
					{:else if previewError}
						<div class="py-2 text-xs text-red-500 dark:text-red-400">{previewError}</div>
					{:else}
						<pre
							class="whitespace-pre-wrap break-words font-mono text-[0.6875rem] leading-relaxed text-gray-700 dark:text-gray-300">{preview.text}</pre>
					{/if}
				</div>
			</div>
		{/if}
	{/if}
</div>
