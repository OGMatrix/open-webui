<script lang="ts">
	/**
	 * One step of an answer -- a tool call, a thought, a code run, or a note
	 * written between them -- as the structured renderer draws it.
	 *
	 * This markup used to be written out twice in StructuredOutputRenderer, once
	 * inside a group and once on its own, and folding bursts of tool calls inside
	 * a group would have needed a third copy. `grouped` says which it is: inside
	 * a group a tool call leaves its embeds to the group, and a note only ever
	 * occurs there.
	 */
	import { settings } from '$lib/stores';

	import Collapsible from '$lib/components/common/Collapsible.svelte';
	import ToolCallDisplay from '$lib/components/common/ToolCallDisplay.svelte';
	import Markdown from './Markdown.svelte';
	import { NOTE_DETAIL_TYPE, type OutputDetailToken } from './structuredOutput';

	/** Stem for the ids of what this renders; `-tool-call`, `-note` and `-detail` go on the end. */
	export let id: string;
	export let token: OutputDetailToken;
	export let grouped = false;
	export let className = 'w-full';
	export let buttonClassName = '';

	export let chatId = '';
	export let messageId = '';
	export let done = true;
	export let save = false;
	export let preview = false;
	export let compactPreview = false;
	export let editCodeBlock = true;

	export let resolvable = false;
	export let resolving = false;
	export let onResolve: (approved: boolean) => void = () => {};
	export let onToolCallResolved: any = () => {};

	const getDetailTitle = (detailToken: OutputDetailToken): any => detailToken.summary;
	const getDetailAttributes = (detailToken: OutputDetailToken): any => detailToken.attributes;
</script>

{#if token.attributes?.type === NOTE_DETAIL_TYPE}
	<!--
		Something the assistant said between two tool calls. Folded in with them
		because more calls followed, so it was written while working -- but it is
		prose, and renders as prose.
	-->
	<div class="markdown-prose my-1 text-sm">
		<Markdown
			id={`${id}-note`}
			{chatId}
			{messageId}
			content={token.text}
			{done}
			{save}
			{preview}
			{compactPreview}
			{editCodeBlock}
			{onToolCallResolved}
		/>
	</div>
{:else if token.attributes?.type === 'tool_calls'}
	<ToolCallDisplay
		id={`${id}-tool-call`}
		attributes={token.attributes}
		resultContent={token.text}
		{grouped}
		{resolvable}
		{resolving}
		{onResolve}
		open={$settings?.expandDetails ?? false}
		{className}
		{buttonClassName}
	/>
{:else if token.text?.length > 0}
	<Collapsible
		title={getDetailTitle(token)}
		open={$settings?.expandDetails ?? false}
		attributes={getDetailAttributes(token)}
		messageDone={done}
		{className}
		{buttonClassName}
	>
		<div class="mb-1.5" slot="content">
			<div class="markdown-prose">
				<Markdown
					id={`${id}-detail`}
					{chatId}
					{messageId}
					content={token.text}
					{done}
					{save}
					{preview}
					{compactPreview}
					{editCodeBlock}
					{onToolCallResolved}
				/>
			</div>
		</div>
	</Collapsible>
{:else}
	<Collapsible
		title={getDetailTitle(token)}
		open={false}
		disabled={true}
		attributes={getDetailAttributes(token)}
		messageDone={done}
		{className}
		{buttonClassName}
	/>
{/if}
