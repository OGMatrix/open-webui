<script lang="ts">
	import { decode } from 'html-entities';
	import { v4 as uuidv4 } from 'uuid';

	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	const i18n = getContext<Writable<i18nType>>('i18n');

	import { slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	import ChevronUp from '../icons/ChevronUp.svelte';
	import ChevronDown from '../icons/ChevronDown.svelte';
	import Spinner from './Spinner.svelte';
	import WrenchSolid from '../icons/WrenchSolid.svelte';
	import CheckCircle from '../icons/CheckCircle.svelte';
	import XMark from '../icons/XMark.svelte';
	import Image from './Image.svelte';
	import ToolValue from './ToolCallDisplay/ToolValue.svelte';
	import { describeValue, summariseArguments, toolHue } from '$lib/utils/toolCalls';
	import FullHeightIframe from './FullHeightIframe.svelte';
	import { settings } from '$lib/stores';

	export let id: string = '';
	export let attributes: {
		type?: string;
		id?: string;
		name?: string;
		arguments?: string;
		result?: string;
		files?: string;
		embeds?: string;
		done?: string;
		status?: string;
	} = {};

	export let open = false;
	export let grouped = false;
	export let className = '';
	export let resolvable = false;
	export let resolving = false;
	export let onResolve: (approved: boolean) => void = () => {};

	const RESULT_PREVIEW_LIMIT = 10000;
	let expandedResult = false;

	$: if (!open) expandedResult = false;
	export let buttonClassName =
		'py-1 text-[0.9375rem] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition';

	const componentId = id || uuidv4();

	function parseJSONString(str: string) {
		// Iteratively unwrap nested JSON-encoded strings. Same result as the previous
		// recursive form, but without the stack-overflow-and-recover path it hit on
		// scalar values (e.g. JSON.parse('5') -> 5 -> infinite self-recursion).
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let value: any = str;
		while (typeof value === 'string') {
			try {
				value = JSON.parse(value);
			} catch {
				break;
			}
		}
		return value;
	}

	function formatJSONString(str: string) {
		try {
			const parsed = parseJSONString(str);
			if (typeof parsed === 'object') {
				return JSON.stringify(parsed, null, 2);
			} else {
				return String(parsed);
			}
		} catch (e) {
			return str;
		}
	}

	function parseArguments(str: string): Record<string, unknown> | null {
		try {
			const parsed = parseJSONString(str);
			if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
			return null;
		} catch {
			return null;
		}
	}

	function isToolResultError(value: unknown): boolean {
		if (typeof value === 'string') {
			const text = value.trim().toLowerCase();
			if (
				text.startsWith('error:') ||
				text.startsWith('exception:') ||
				text.startsWith('traceback') ||
				text.startsWith('http error!')
			) {
				return true;
			}
		}

		let parsed = value;
		while (typeof parsed === 'string') {
			try {
				parsed = JSON.parse(parsed);
			} catch {
				break;
			}
		}
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;

		const result = parsed as Record<string, unknown>;
		const error = result.error;
		if (
			(typeof error === 'string' && error.trim().length > 0) ||
			(typeof error === 'object' && error !== null)
		) {
			return true;
		}

		const status = typeof result.status === 'string' ? result.status.trim().toLowerCase() : '';
		if (status === 'error' || status === 'failed') return true;

		const message = result.message;
		return (
			(result.success === false || result.ok === false) &&
			((typeof message === 'string' && message.trim().length > 0) ||
				(typeof message === 'object' && message !== null))
		);
	}

	export let resultContent: string = '';

	/*
	 * What the call was asked and what came back, described rather than
	 * stringified. The row is read to find out what a tool did; braces are the
	 * data, not the answer.
	 */
	$: summary = summariseArguments(parsedArgs);
	$: hue = toolHue(attributes?.name ?? '');
	$: describedArgs = parsedArgs ? describeValue(parsedArgs) : null;
	$: describedResult =
		parsedResult !== null && typeof parsedResult === 'object' ? describeValue(parsedResult) : null;

	$: result = resultContent || decode(attributes?.result ?? '');
	$: files = parseJSONString(decode(attributes?.files ?? ''));
	$: embeds = parseJSONString(decode(attributes?.embeds ?? ''));
	$: isAskUser = attributes?.name === 'ask_user';
	$: needsInput = isAskUser && attributes?.status === 'pending';
	$: needsApproval = !isAskUser && attributes?.status === 'pending' && resolvable;
	$: args =
		open || needsApproval || needsInput || (Array.isArray(embeds) && embeds.length > 0)
			? decode(attributes?.arguments ?? '')
			: '';
	$: isRejected = attributes?.status === 'rejected';
	$: isDone =
		attributes?.done === 'true' ||
		attributes?.status === 'failed' ||
		attributes?.status === 'incomplete';
	$: isExecuting = !isDone && !isRejected && attributes?.status === 'completed';
	$: isPreparing = !isDone && !isRejected && !needsApproval && !needsInput && !isExecuting;
	$: isActive = isPreparing || isExecuting;
	$: isError = attributes?.status === 'failed' || (isDone && isToolResultError(result));

	$: parsedArgs = parseArguments(args);
	$: parsedResult = parseJSONString(result);

	const toggleOpen = () => {
		open = !open;
	};

	const toggleOpenOnKeydown = (event: KeyboardEvent) => {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		event.preventDefault();
		toggleOpen();
	};
</script>

<div {id} class={className}>
	{#if !grouped && embeds && Array.isArray(embeds) && embeds.length > 0}
		<!-- Embed Mode: Show iframes without collapsible behavior -->
		<div class="py-1 w-full cursor-pointer">
			<div class="w-full text-xs text-gray-500">
				{attributes.name}
			</div>
			{#each embeds as embed, idx}
				<div class="my-2" id={`${componentId}-tool-call-embed-${idx}`}>
					<FullHeightIframe
						src={embed}
						{args}
						allowScripts={true}
						allowForms={$settings?.iframeSandboxAllowForms ?? false}
						allowSameOrigin={$settings?.iframeSandboxAllowSameOrigin ?? false}
						allowPopups={true}
					/>
				</div>
			{/each}
		</div>
	{:else}
		<!-- Tool call display -->
		<div
			class="{buttonClassName} w-full min-w-0 cursor-pointer"
			role="button"
			tabindex="0"
			on:click={toggleOpen}
			on:keydown={toggleOpenOnKeydown}
		>
			<div
				class="w-full min-w-0 max-w-full font-normal flex items-center gap-1.5 {isActive
					? 'shimmer'
					: ''}"
			>
				<!-- Status icon -->
				{#if isActive}
					<div>
						<Spinner className="size-4" />
					</div>
				{:else if isRejected}
					<div class="text-red-400 dark:text-red-500">
						<XMark className="size-4" strokeWidth="2.5" />
					</div>
				{:else if isError}
					<div class="text-red-500 dark:text-red-400">
						<XMark className="size-4" strokeWidth="2.5" />
					</div>
				{:else if isDone}
					<div class="text-emerald-500 dark:text-emerald-400">
						<CheckCircle className="size-4" strokeWidth="2" />
					</div>
				{:else}
					<div class="text-gray-400 dark:text-gray-500">
						<WrenchSolid className="size-3.5" />
					</div>
				{/if}

				<!--
					A colour of its own, from the name, so a run of five calls is five
					things rather than five wrenches. The same tool is the same colour
					in every chat, because it is derived and not assigned.
				-->
				<span
					class="size-1.5 shrink-0 rounded-full"
					style="background: hsl({hue} 65% 55%)"
					aria-hidden="true"
				></span>

				<!-- Label -->
				<div class="line-clamp-1 min-w-0 flex-1">
					<!-- Short label (below md) -->
					<span class="text-black @md:hidden dark:text-white">{attributes.name}</span>
					<!-- Full label (md and above) -->
					<span class="hidden @md:inline font-normal">
						{#if isRejected}
							{$i18n.t('Denied {{NAME}}', { NAME: attributes.name })}
						{:else if needsInput}
							{$i18n.t('Input needed')}
						{:else if needsApproval}
							{$i18n.t('Allow {{NAME}}?', { NAME: attributes.name })}
						{:else}
							<!--
								The name, and what it was asked. The state is already in the
								icon to the left; saying it again in words spent the room
								this needed, and "View Result from search_web" never said
								which search.
							-->
							<span class="text-black dark:text-white">{attributes.name}</span>
							{#if summary}
								<span class="text-gray-400 dark:text-gray-500">· {summary}</span>
							{/if}
						{/if}
					</span>
				</div>

				{#if needsApproval && !isAskUser}
					<span class="flex gap-1 shrink-0">
						<button
							type="button"
							class="tool-call-allow-button text-[0.6875rem] px-2.5 py-0.5 rounded-md text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-white/8 hover:bg-gray-200 dark:hover:bg-white/12 transition-colors duration-100 disabled:opacity-50"
							disabled={resolving}
							on:click|stopPropagation={() => onResolve(true)}
						>
							{$i18n.t('Allow')}
						</button>
						<button
							type="button"
							class="tool-call-deny-button text-[0.6875rem] px-2 py-0.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-100 disabled:opacity-50"
							disabled={resolving}
							on:click|stopPropagation={() => onResolve(false)}
						>
							{$i18n.t('Deny')}
						</button>
					</span>
				{:else}
					<!-- Chevron -->
					<div class="flex shrink-0 self-center translate-y-[1px]">
						{#if open}
							<ChevronUp strokeWidth="3.5" className="size-3" />
						{:else}
							<ChevronDown strokeWidth="3.5" className="size-3" />
						{/if}
					</div>
				{/if}
			</div>
		</div>

		{#if open}
			<div transition:slide={{ duration: 300, easing: quintOut, axis: 'y' }}>
				<div
					class="border border-gray-50 dark:border-gray-850/30 rounded-2xl my-1.5 p-2.5 space-y-2"
				>
					{#if args}
						<!-- Input -->
						<div>
							<div
								class="text-[0.625rem] uppercase tracking-wider font-normal text-gray-400 dark:text-gray-500 mb-1.5 px-1"
							>
								{$i18n.t('Input')}
							</div>

							{#if describedArgs}
								<div class="space-y-0.5 px-1 text-xs">
									<ToolValue value={describedArgs} />
								</div>
							{:else}
								<div class="tool-call-body w-full max-w-none!">
									<pre
										class="text-xs text-gray-600 dark:text-gray-300 whitespace-pre font-mono bg-gray-50 dark:bg-gray-900 rounded-lg p-2 overflow-x-auto">{formatJSONString(
											args
										)}</pre>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Output -->
					{#if isDone && result}
						<div>
							<div
								class="text-[0.625rem] uppercase tracking-wider font-normal text-gray-400 dark:text-gray-500 mb-1.5 px-1"
							>
								{$i18n.t('Output')}
							</div>
							<div class="w-full max-w-none!">
								{#if describedResult}
									<div class="space-y-0.5 px-1 text-xs">
										<ToolValue value={describedResult} />
									</div>
								{:else}
									{@const resultStr = String(parsedResult)}
									{@const isTruncated = resultStr.length > RESULT_PREVIEW_LIMIT && !expandedResult}
									<pre
										class="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words font-mono">{isTruncated
											? resultStr.slice(0, RESULT_PREVIEW_LIMIT)
											: resultStr}</pre>
									{#if isTruncated}
										<button
											class="mt-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition"
											on:click|stopPropagation={() => {
												expandedResult = true;
											}}
										>
											{$i18n.t('Show all ({{COUNT}} characters)', {
												COUNT: resultStr.length.toLocaleString()
											})}
										</button>
									{/if}
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	{/if}

	<!-- Files display (images etc.) when done -->
	{#if isDone}
		{#if typeof files === 'object'}
			{#each files ?? [] as file, idx}
				{#if typeof file === 'string'}
					{#if file.startsWith('data:image/')}
						<Image id={`${componentId}-tool-call-result-${idx}`} src={file} alt="Image" />
					{/if}
				{:else if typeof file === 'object'}
					{#if (file.type === 'image' || (file?.content_type ?? '').startsWith('image/')) && file.url}
						<Image id={`${componentId}-tool-call-result-${idx}`} src={file.url} alt="Image" />
					{/if}
				{/if}
			{/each}
		{/if}
	{/if}
</div>
