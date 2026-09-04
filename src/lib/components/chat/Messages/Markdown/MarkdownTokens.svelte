<script lang="ts">
	import { decode } from 'html-entities';
	import { onMount, getContext } from 'svelte';
	const i18n = getContext('i18n');

	import { marked, type Token } from 'marked';
	import { unescapeHtml } from '$lib/utils';
	import { resolveChatMessageToolCall } from '$lib/apis/chats';

	import { WEBUI_BASE_URL } from '$lib/constants';
	import { settings } from '$lib/stores';
	import { toast } from 'svelte-sonner';

	import CodeBlock from '$lib/components/chat/Messages/CodeBlock.svelte';
	import MarkdownInlineTokens from '$lib/components/chat/Messages/Markdown/MarkdownInlineTokens.svelte';
	import KatexRenderer from './KatexRenderer.svelte';
	import AlertRenderer, { alertComponent } from './AlertRenderer.svelte';
	import Collapsible from '$lib/components/common/Collapsible.svelte';
	import ToolCallDisplay from '$lib/components/common/ToolCallDisplay.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import ConsecutiveDetailsGroup from './ConsecutiveDetailsGroup.svelte';
	import { getDisplayTokens, isGroupableDetailToken } from '$lib/utils/markdownGrouping';

	import HtmlToken from './HTMLToken.svelte';
	import ColonFenceBlock from './ColonFenceBlock.svelte';
	import MarkdownTable from './MarkdownTable.svelte';

	export let id: string;
	export let chatId = '';
	export let messageId = '';
	export let tokens: Token[];
	export let top = true;
	export let attributes = {};
	export let sourceIds = [];

	export let done = true;

	export let save = false;
	export let preview = false;
	export let compactPreview = false;

	export let paragraphTag = 'p';

	export let editCodeBlock = true;
	export let topPadding = false;
	export let allowEmbeds = true;

	export let onSave: Function = () => {};
	export let onUpdate: Function = () => {};
	export let onPreview: Function = () => {};

	export let onTaskClick: Function = () => {};
	export let onSourceClick: Function = () => {};
	export let onToolCallResolved: Function = () => {};

	const headerComponent = (depth: number) => {
		return 'h' + depth;
	};

	const getDetailTextContent = (token) => {
		return decode(token?.text || '')
			.replace(/<summary>.*?<\/summary>/gi, '')
			.trim();
	};

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

	$: displayTokens = getDisplayTokens(tokens);
	$: singlePlainBlock =
		displayTokens.length === 1 &&
		(displayTokens[0]?.type === 'paragraph' || displayTokens[0]?.type === 'text');
</script>

<!-- {JSON.stringify(tokens)} -->
{#each displayTokens as token, tokenIdx (tokenIdx)}
	{#if token.type === 'hr'}
		<hr class="border-gray-50 dark:border-gray-850/30" />
	{:else if token.type === 'heading'}
		<svelte:element this={headerComponent(token.depth)} dir="auto">
			<MarkdownInlineTokens
				id={`${id}-${tokenIdx}-h`}
				tokens={token.tokens}
				{done}
				{sourceIds}
				{onSourceClick}
			/>
		</svelte:element>
	{:else if token.type === 'code'}
		{#if token.raw.includes('```')}
			<CodeBlock
				id={`${id}-${tokenIdx}`}
				collapsed={$settings?.collapseCodeBlocks ?? false}
				{token}
				lang={token?.lang ?? ''}
				code={token?.text ?? ''}
				{attributes}
				{save}
				{preview}
				edit={editCodeBlock}
				stickyButtonsClassName={topPadding ? 'top-10' : 'top-0'}
				onSave={(value) => {
					onSave({
						raw: token.raw,
						oldContent: token.text,
						newContent: value
					});
				}}
				{onUpdate}
				{onPreview}
			/>
		{:else}
			{token.text}
		{/if}
	{:else if token.type === 'table'}
		<MarkdownTable {id} {token} {tokenIdx} {done} {sourceIds} {onSourceClick} />
	{:else if token.type === 'blockquote'}
		{@const alert = alertComponent(token)}
		{#if alert}
			<AlertRenderer {token} {alert} />
		{:else}
			<blockquote dir="auto">
				<svelte:self
					id={`${id}-${tokenIdx}`}
					{chatId}
					{messageId}
					tokens={token.tokens}
					{done}
					{save}
					{preview}
					{compactPreview}
					{editCodeBlock}
					{onTaskClick}
					{sourceIds}
					{onSourceClick}
					{onToolCallResolved}
				/>
			</blockquote>
		{/if}
	{:else if token.type === 'list'}
		{#if token.ordered}
			<ol start={token.start || 1} dir="auto">
				{#each token.items as item, itemIdx}
					<li class="text-start">
						{#if item?.task}
							<input
								class=" translate-y-[1px] -translate-x-1 flex-shrink-0"
								type="checkbox"
								checked={item.checked}
								on:change={(e) => {
									onTaskClick({
										id: id,
										token: token,
										tokenIdx: tokenIdx,
										item: item,
										itemIdx: itemIdx,
										checked: e.target.checked
									});
								}}
							/>
						{/if}

						<svelte:self
							id={`${id}-${tokenIdx}-${itemIdx}`}
							{chatId}
							{messageId}
							tokens={item.tokens}
							top={token.loose}
							{done}
							{save}
							{preview}
							{compactPreview}
							{editCodeBlock}
							{onTaskClick}
							{sourceIds}
							{onSourceClick}
						/>
					</li>
				{/each}
			</ol>
		{:else}
			<ul dir="auto" class="">
				{#each token.items as item, itemIdx}
					<li class="text-start {item?.task ? 'flex -translate-x-6.5 gap-3 ' : ''}">
						{#if item?.task}
							<input
								class="flex-shrink-0"
								type="checkbox"
								checked={item.checked}
								on:change={(e) => {
									onTaskClick({
										id: id,
										token: token,
										tokenIdx: tokenIdx,
										item: item,
										itemIdx: itemIdx,
										checked: e.target.checked
									});
								}}
							/>

							<div>
								<svelte:self
									id={`${id}-${tokenIdx}-${itemIdx}`}
									{chatId}
									{messageId}
									tokens={item.tokens}
									top={token.loose}
									{done}
									{save}
									{preview}
									{compactPreview}
									{editCodeBlock}
									{onTaskClick}
									{sourceIds}
									{onSourceClick}
								/>
							</div>
						{:else}
							<svelte:self
								id={`${id}-${tokenIdx}-${itemIdx}`}
								{chatId}
								{messageId}
								tokens={item.tokens}
								top={token.loose}
								{done}
								{save}
								{preview}
								{compactPreview}
								{editCodeBlock}
								{onTaskClick}
								{sourceIds}
								{onSourceClick}
							/>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{:else if token.type === 'detail_group'}
		<ConsecutiveDetailsGroup
			id={`${id}-${tokenIdx}-detail-group`}
			tokens={token.items}
			messageDone={done}
			{compactPreview}
			{allowEmbeds}
			resolvable={!!chatId && !!messageId && save}
			{resolvingCallId}
			onResolve={resolveToolCall}
		>
			<div slot="content">
				{#each token.items as detailToken, detailIdx}
					{@const textContent = getDetailTextContent(detailToken)}

					{#if !isGroupableDetailToken(detailToken)}
						<!--
							A note the assistant wrote between two tool calls. It is
							folded in with them because more calls followed it, so it was
							written while working rather than as the answer -- but it is
							still prose, and it renders as prose.
						-->
						<div class="my-1 text-sm">
							<svelte:self
								id={`${id}-${tokenIdx}-${detailIdx}-note`}
								{chatId}
								{messageId}
								tokens={[detailToken]}
								{done}
								{save}
								{preview}
								{compactPreview}
								{editCodeBlock}
								{onTaskClick}
								{sourceIds}
								{onSourceClick}
							/>
						</div>
					{:else if detailToken?.attributes?.type === 'tool_calls'}
						<ToolCallDisplay
							id={`${id}-${tokenIdx}-${detailIdx}-tc`}
							attributes={detailToken.attributes}
							resultContent={getDetailTextContent(detailToken)}
							grouped={true}
							resolvable={!!chatId && !!messageId && save}
							resolving={resolvingCallId === detailToken.attributes?.id}
							onResolve={(approved) => resolveToolCall(detailToken.attributes?.id ?? '', approved)}
							open={$settings?.expandDetails ?? false}
							className="w-full"
							buttonClassName={detailButtonClassName}
						/>
					{:else if textContent.length > 0}
						<Collapsible
							title={detailToken.summary}
							open={$settings?.expandDetails ?? false}
							attributes={detailToken?.attributes}
							messageDone={done}
							className="w-full"
							buttonClassName={detailButtonClassName}
							dir="auto"
						>
							<div class="mb-1.5" slot="content">
								<svelte:self
									id={`${id}-${tokenIdx}-${detailIdx}-d`}
									{chatId}
									{messageId}
									tokens={marked.lexer(decode(detailToken.text))}
									attributes={detailToken?.attributes}
									{done}
									{save}
									{preview}
									{compactPreview}
									{editCodeBlock}
									{onTaskClick}
									{sourceIds}
									{onSourceClick}
								/>
							</div>
						</Collapsible>
					{:else}
						<Collapsible
							title={detailToken.summary}
							open={false}
							disabled={true}
							attributes={detailToken?.attributes}
							messageDone={done}
							className="w-full"
							buttonClassName={detailButtonClassName}
							dir="auto"
						/>
					{/if}
				{/each}
			</div>
		</ConsecutiveDetailsGroup>
	{:else if token.type === 'details'}
		{@const textContent = getDetailTextContent(token)}

		{#if token?.attributes?.type === 'tool_calls'}
			<!-- Tool calls have dedicated handling with ToolCallDisplay component -->
			<ToolCallDisplay
				id={`${id}-${tokenIdx}-tc`}
				attributes={token.attributes}
				resultContent={getDetailTextContent(token)}
				resolvable={!!chatId && !!messageId && save}
				resolving={resolvingCallId === token.attributes?.id}
				onResolve={(approved) => resolveToolCall(token.attributes?.id ?? '', approved)}
				open={$settings?.expandDetails ?? false}
				className="w-full space-y-2"
				buttonClassName={detailButtonClassName}
			/>
		{:else if textContent.length > 0}
			<Collapsible
				title={token.summary}
				open={$settings?.expandDetails ?? false}
				attributes={token?.attributes}
				messageDone={done}
				className="w-full space-y-2"
				buttonClassName={detailButtonClassName}
				dir="auto"
			>
				<div class=" mb-1.5" slot="content">
					<svelte:self
						id={`${id}-${tokenIdx}-d`}
						{chatId}
						{messageId}
						tokens={marked.lexer(decode(token.text))}
						attributes={token?.attributes}
						{done}
						{save}
						{preview}
						{compactPreview}
						{editCodeBlock}
						{onTaskClick}
						{sourceIds}
						{onSourceClick}
					/>
				</div>
			</Collapsible>
		{:else}
			<Collapsible
				title={token.summary}
				open={false}
				disabled={true}
				attributes={token?.attributes}
				messageDone={done}
				className="w-full space-y-2"
				buttonClassName={detailButtonClassName}
				dir="auto"
			/>
		{/if}
	{:else if token.type === 'html'}
		<HtmlToken {id} {token} {onSourceClick} />
	{:else if token.type === 'iframe'}
		<iframe
			src="{WEBUI_BASE_URL}/api/v1/files/{token.fileId}/content"
			title={token.fileId}
			width="100%"
			frameborder="0"
			on:load={(e) => {
				try {
					e.currentTarget.style.height =
						e.currentTarget.contentWindow.document.body.scrollHeight + 20 + 'px';
				} catch {}
			}}
		></iframe>
	{:else if token.type === 'paragraph'}
		{#if paragraphTag == 'span'}
			<span dir="auto">
				<MarkdownInlineTokens
					id={`${id}-${tokenIdx}-p`}
					tokens={token.tokens ?? []}
					{done}
					{sourceIds}
					{onSourceClick}
				/>
			</span>
		{:else}
			<p dir="auto" class={singlePlainBlock ? '!my-0' : ''}>
				<MarkdownInlineTokens
					id={`${id}-${tokenIdx}-p`}
					tokens={token.tokens ?? []}
					{done}
					{sourceIds}
					{onSourceClick}
				/>
			</p>
		{/if}
	{:else if token.type === 'text'}
		{#if top}
			<p class={singlePlainBlock ? '!my-0' : ''}>
				{#if token.tokens}
					<MarkdownInlineTokens
						id={`${id}-${tokenIdx}-t`}
						tokens={token.tokens}
						{done}
						{sourceIds}
						{onSourceClick}
					/>
				{:else}
					{unescapeHtml(token.text)}
				{/if}
			</p>
		{:else if token.tokens}
			<MarkdownInlineTokens
				id={`${id}-${tokenIdx}-p`}
				tokens={token.tokens ?? []}
				{done}
				{sourceIds}
				{onSourceClick}
			/>
		{:else}
			{unescapeHtml(token.text)}
		{/if}
	{:else if token.type === 'inlineKatex'}
		{#if token.text}
			<KatexRenderer content={token.text} displayMode={token?.displayMode ?? false} />
		{/if}
	{:else if token.type === 'blockKatex'}
		{#if token.text}
			<KatexRenderer content={token.text} displayMode={token?.displayMode ?? false} />
		{/if}
	{:else if token.type === 'colonFence'}
		<ColonFenceBlock
			id={`${id}-${tokenIdx}`}
			{token}
			{tokenIdx}
			{done}
			{editCodeBlock}
			{sourceIds}
			{onTaskClick}
			{onSourceClick}
		/>
	{:else if token.type === 'space'}
		<!-- skip -->
	{:else}
		{console.log('Unknown token', token)}
	{/if}
{/each}
