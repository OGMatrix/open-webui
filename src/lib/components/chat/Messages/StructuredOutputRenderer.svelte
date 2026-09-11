<script lang="ts">
	import TerminalOutputFile from './TerminalOutputFile.svelte';
	import OutputDetailStep from './OutputDetailStep.svelte';
	import { readStepLayout, runParts } from '$lib/utils/stepLayout';
	import { resolveChatMessageToolCall } from '$lib/apis/chats';
	import { settings } from '$lib/stores';
	import { toast } from 'svelte-sonner';

	import Markdown from './Markdown.svelte';
	import ConsecutiveDetailsGroup from './Markdown/ConsecutiveDetailsGroup.svelte';
	import {
		buildOutputDisplayItems,
		isToolStepToken,
		type OutputDisplayItem,
		type OutputItem
	} from './structuredOutput';

	export let id = '';
	export let chatId = '';
	export let messageId = '';
	export let output: OutputItem[] = [];
	export let done = true;
	export let model = null;
	export let save = false;
	export let preview = false;
	export let compactPreview = false;
	export let renderMarkdown = true;
	export let editCodeBlock = true;
	export let topPadding = false;
	export let sourceIds: string[] = [];
	export let formatMessageContent: (content: string) => string = (content) => content;
	export let onSave: any = () => {};
	export let onSourceClick: any = () => {};
	export let onTaskClick: any = () => {};
	export let onUpdate: any = () => {};
	export let onPreview: any = () => {};
	export let onToolCallResolved: any = () => {};

	let resolvingCallId = '';

	const resolveToolCall = async (callId: string, approved: boolean) => {
		if (!chatId || !messageId || !callId || resolvingCallId) {
			return;
		}

		resolvingCallId = callId;
		try {
			const res = await resolveChatMessageToolCall(
				localStorage.token,
				chatId,
				messageId,
				callId,
				approved ? 'approve' : 'reject'
			);
			onToolCallResolved(res);
		} catch (err) {
			toast.error(String(err));
		} finally {
			resolvingCallId = '';
		}
	};

	$: detailButtonClassName = `py-0.5 ${
		compactPreview ? 'text-xs' : 'text-[0.9375rem]'
	} text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition`;

	/**
	 * How the steps are laid out; see utils/stepLayout. Read straight from the
	 * settings in both places rather than one from the other: a reactive value
	 * derived from another reactive value has been seen stale on first render
	 * in this codebase.
	 */
	$: stepLayout = readStepLayout($settings);
	$: displayItems = buildOutputDisplayItems(
		output,
		done,
		readStepLayout($settings)
	) as OutputDisplayItem[];
</script>

{#each displayItems as displayItem (displayItem.id)}
	{#if displayItem.type === 'message'}
		{#if renderMarkdown}
			<div class="markdown-prose">
				<Markdown
					id={`${id}-${displayItem.id}`}
					{chatId}
					{messageId}
					content={formatMessageContent(displayItem.text)}
					{model}
					{save}
					{preview}
					{compactPreview}
					{done}
					{editCodeBlock}
					{topPadding}
					{sourceIds}
					{onSourceClick}
					{onTaskClick}
					{onToolCallResolved}
					{onSave}
					{onUpdate}
					{onPreview}
				/>
			</div>
		{:else}
			<div class="whitespace-pre-wrap text-[0.9375rem]">{displayItem.text}</div>
		{/if}
	{:else if displayItem.type === 'detail_group'}
		<ConsecutiveDetailsGroup
			id={`${id}-${displayItem.id}`}
			tokens={displayItem.tokens}
			messageDone={done}
			{compactPreview}
			resolvable={!!chatId && !!messageId && save}
			{resolvingCallId}
			onResolve={resolveToolCall}
		>
			<div slot="content">
				<!--
					Each step on its own, unless tool grouping folds the bursts of
					back-to-back calls inside this run. A burst is a group of its own,
					which leaves its embeds to this one: this group already shows every
					embed of the run, and a burst showing them too would show them twice.
				-->
				{#each runParts(displayItem.tokens, stepLayout, isToolStepToken) as part, partIndex}
					{#if part.kind === 'tools'}
						<ConsecutiveDetailsGroup
							id={`${id}-${displayItem.id}-burst-${partIndex}`}
							tokens={part.items}
							messageDone={done}
							{compactPreview}
							allowEmbeds={false}
							resolvable={!!chatId && !!messageId && save}
							{resolvingCallId}
							onResolve={resolveToolCall}
						>
							<div slot="content">
								{#each part.items as detailToken, burstIndex}
									<OutputDetailStep
										id={`${id}-${displayItem.id}-${partIndex}-${burstIndex}`}
										token={detailToken}
										grouped={true}
										buttonClassName={detailButtonClassName}
										{chatId}
										{messageId}
										{done}
										{save}
										{preview}
										{compactPreview}
										{editCodeBlock}
										resolvable={!!chatId && !!messageId && save}
										resolving={resolvingCallId === detailToken.attributes?.id}
										onResolve={(approved) =>
											resolveToolCall(detailToken.attributes?.id ?? '', approved)}
										{onToolCallResolved}
									/>
								{/each}
							</div>
						</ConsecutiveDetailsGroup>
					{:else}
						<OutputDetailStep
							id={`${id}-${displayItem.id}-${partIndex}`}
							token={part.item}
							grouped={true}
							buttonClassName={detailButtonClassName}
							{chatId}
							{messageId}
							{done}
							{save}
							{preview}
							{compactPreview}
							{editCodeBlock}
							resolvable={!!chatId && !!messageId && save}
							resolving={resolvingCallId === part.item.attributes?.id}
							onResolve={(approved) => resolveToolCall(part.item.attributes?.id ?? '', approved)}
							{onToolCallResolved}
						/>
					{/if}
				{/each}
			</div>
		</ConsecutiveDetailsGroup>
	{:else if displayItem.type === 'file'}
		{#if displayItem.item?.displayed || $settings?.terminalFileDisplay === 'inline'}
			<TerminalOutputFile item={displayItem.item} {chatId} />
		{/if}
	{:else}
		{@const detailToken = displayItem.token}
		<OutputDetailStep
			id={`${id}-${displayItem.id}`}
			token={detailToken}
			className="w-full space-y-2"
			buttonClassName={detailButtonClassName}
			{chatId}
			{messageId}
			{done}
			{save}
			{preview}
			{compactPreview}
			{editCodeBlock}
			resolvable={!!chatId && !!messageId && save}
			resolving={resolvingCallId === detailToken.attributes?.id}
			onResolve={(approved) => resolveToolCall(detailToken.attributes?.id ?? '', approved)}
			{onToolCallResolved}
		/>
	{/if}
{/each}
