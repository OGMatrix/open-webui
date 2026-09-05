<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { toast } from 'svelte-sonner';

	import { socket, user as _user } from '$lib/stores';
	import { getNoteById, updateNoteById } from '$lib/apis/notes';
	import { shouldApplyNoteEvent, titleFor } from '$lib/utils/canvas';

	import RichTextInput from '$lib/components/common/RichTextInput.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import XMark from '$lib/components/icons/XMark.svelte';
	import ArrowTopRightOnSquare from '$lib/components/icons/ArrowTopRightOnSquare.svelte';

	const i18n = getContext<Writable<i18nType>>('i18n');

	/** The note held open beside the conversation. */
	export let noteId: string | null = null;
	export let onClose: () => void = () => {};
	/** The passage the reader has selected, so the composer can act on it. */
	export let selectedText = '';
	/**
	 * The document's name, reported upward.
	 *
	 * The conversation tells the model which note is open; a name makes that
	 * something a person can also follow when they read the request back.
	 */
	export let title = '';

	let note: any = null;
	let loading = false;
	let loadError: string | null = null;
	let editor: any = null;

	/**
	 * When the reader last typed.
	 *
	 * The server announces every write, including the reader's own, so an event
	 * arriving mid-sentence would replace the document under the cursor.
	 */
	let lastEditAt = 0;
	const SETTLE_MS = 800;

	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saving = false;
	let savedAt = 0;

	const load = async (id: string) => {
		loading = true;
		loadError = null;

		const res = await getNoteById(localStorage.token, id).catch((error) => {
			loadError = `${error}`;
			return null;
		});

		if (res) {
			note = res;
			title = res.title ?? '';
			// The document may already be open on the notes page or being edited
			// by the model; both announce their changes in this room.
			$socket?.emit('join-note', { note_id: id, auth: { token: localStorage.token } });
		}

		loading = false;
	};

	const onNoteEvent = async (incoming: any) => {
		if (!shouldApplyNoteEvent(note, incoming, lastEditAt + SETTLE_MS)) return;

		note = {
			...note,
			...incoming,
			data: { ...(note?.data ?? {}), ...(incoming?.data ?? {}) }
		};
		await tick();
	};

	/**
	 * Save what was typed, once typing stops.
	 *
	 * Every save comes back as an event, so saving on each keystroke would mean
	 * a stream of events racing the keystrokes that caused them.
	 */
	const scheduleSave = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(save, 600);
	};

	const save = async () => {
		if (!note?.id) return;

		saving = true;
		const res = await updateNoteById(localStorage.token, note.id, {
			title: note.title,
			data: note.data,
			meta: note.meta ?? null
		}).catch((error) => {
			toast.error(`${error}`);
			return null;
		});
		saving = false;

		if (res) {
			note.updated_at = res.updated_at ?? note.updated_at;
			savedAt = Date.now();
		}
	};

	// Loading is keyed on the id so that opening a different answer as a
	// document swaps the panel rather than leaving the last one on screen.
	let loadedId: string | null = null;
	$: if (noteId && noteId !== loadedId) {
		loadedId = noteId;
		note = null;
		void load(noteId);
	}
	$: if (!noteId) {
		loadedId = null;
		note = null;
	}

	onMount(() => {
		$socket?.on('events:note', onNoteEvent);
		return () => {
			$socket?.off('events:note', onNoteEvent);
		};
	});

	onDestroy(() => {
		if (saveTimer) clearTimeout(saveTimer);
		$socket?.off('events:note', onNoteEvent);
	});

	const renameFromContent = () => {
		// A document made from an answer starts named after its first line; once
		// the reader has given it a name of their own, leave it alone.
		if (!note || (note.title ?? '').trim()) return;
		note.title = titleFor(note?.data?.content?.md ?? '', $i18n.t('Untitled'));
		title = note.title;
	};
</script>

<div class="flex h-full w-full flex-col">
	{#if loading}
		<div class="flex flex-1 items-center justify-center">
			<Spinner className="size-4" />
		</div>
	{:else if loadError}
		<div class="p-3 text-xs text-red-500 dark:text-red-400">{loadError}</div>
	{:else if note}
		<div
			class="flex shrink-0 items-center gap-1.5 border-b border-gray-100 px-2 py-1.5 dark:border-gray-850"
		>
			<!--
				The title is the document's own, editable here rather than in a
				dialogue: renaming a thing you are looking at should not need a trip
				somewhere else.
			-->
			<input
				bind:value={note.title}
				on:input={() => {
					title = note.title ?? '';
					lastEditAt = Date.now();
					scheduleSave();
				}}
				aria-label={$i18n.t('Title')}
				placeholder={$i18n.t('Untitled')}
				class="min-w-0 flex-1 bg-transparent text-sm font-medium outline-hidden placeholder:text-gray-400 dark:placeholder:text-gray-600"
			/>

			<div
				class="shrink-0 text-[0.6875rem] tabular-nums text-gray-400"
				aria-live="polite"
				aria-atomic="true"
			>
				{#if saving}
					{$i18n.t('Saving...')}
				{:else if savedAt}
					{$i18n.t('Saved')}
				{/if}
			</div>

			<Tooltip content={$i18n.t('Open in Notes')} placement="bottom">
				<a
					href="/notes/{note.id}"
					class="flex size-6 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 focus:outline-hidden dark:text-gray-400 dark:hover:bg-gray-800"
					aria-label={$i18n.t('Open in Notes')}
				>
					<ArrowTopRightOnSquare className="size-3.5" strokeWidth="2" />
				</a>
			</Tooltip>

			<Tooltip content={$i18n.t('Close')} placement="bottom">
				<button
					type="button"
					aria-label={$i18n.t('Close')}
					class="flex size-6 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 focus:outline-hidden dark:text-gray-400 dark:hover:bg-gray-800"
					on:click={onClose}
				>
					<XMark className="size-3.5" strokeWidth="2.5" />
				</button>
			</Tooltip>
		</div>

		<div class="scrollbar-hidden min-h-0 flex-1 overflow-y-auto px-3 py-2">
			<!--
				The same editor the notes page uses, on the same document id, so the
				two stay in step when both are open.
			-->
			<RichTextInput
				bind:editor
				id={`canvas-${note.id}`}
				className="input-prose-sm min-h-[12rem]"
				json={true}
				bind:value={note.data.content.json}
				html={note.data.content.html}
				documentId={`note:${note.id}`}
				collaboration={true}
				socket={$socket}
				user={$_user}
				link={true}
				image={true}
				placeholder={$i18n.t('Write something...')}
				onSelectionUpdate={({ editor: current }) => {
					const { from, to } = current.state.selection;
					selectedText = current.state.doc.textBetween(from, to, ' ');
				}}
				onChange={(content) => {
					lastEditAt = Date.now();
					note.data.content.html = content.html;
					note.data.content.md = content.md;
					renameFromContent();
					scheduleSave();
				}}
			/>
		</div>
	{/if}
</div>
