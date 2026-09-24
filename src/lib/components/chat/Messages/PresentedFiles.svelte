<script lang="ts">
	/**
	 * The files an answer hands over, as cards under it.
	 *
	 * A handed-over file is not an attachment of the question and not an
	 * illustration inside the text: it is the thing the reader came for, so it
	 * gets a row of its own with the name, what it is, and one obvious way to
	 * keep it. Every one of them is a stored copy, so the download works long
	 * after the terminal it was made in is gone.
	 */
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { WEBUI_API_BASE_URL } from '$lib/constants';
	import { formatFileSize } from '$lib/utils';

	import Download from '$lib/components/icons/Download.svelte';
	import Icon from '$lib/components/chat/FileNav/Icon.svelte';
	import { fileIconName } from '$lib/components/chat/FileNav/fileIcon';
	import FileItemModal from '$lib/components/common/FileItemModal.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let files: any[] = [];
	export let id = '';

	const TEXT_TYPE = /^(text\/|application\/(json|xml|yaml|x-yaml|javascript|sql|x-sh))/;
	const TEXT_EXTENSIONS = new Set(
		'md txt text csv tsv json yaml yml xml html htm css js ts jsx tsx svelte py rb rs go java c h cpp sh bash sql log ini toml env conf'.split(
			' '
		)
	);
	/** Types the file modal draws from the stored file itself, without needing its text. */
	const RICH_EXTENSIONS = new Set(
		'pdf png jpg jpeg gif webp svg bmp avif mp3 wav ogg oga m4a flac xlsx xls docx pptx'.split(' ')
	);

	let previewItem: any = null;
	let showPreview = false;

	const extensionOf = (file: any) => {
		const name = String(file?.name ?? '');
		return name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
	};

	const isText = (file: any) =>
		TEXT_TYPE.test(String(file?.content_type ?? '')) || TEXT_EXTENSIONS.has(extensionOf(file));

	const canPreview = (file: any) =>
		isText(file) ||
		RICH_EXTENSIONS.has(extensionOf(file)) ||
		/^(image|audio)\//.test(String(file?.content_type ?? ''));

	/** What the file is, in the words a file listing uses: `PDF · 2.4 MB`. */
	const describe = (file: any) => {
		const extension = extensionOf(file);
		const size = Number(file?.size);
		const measured = Number.isFinite(size) && size > 0 ? formatFileSize(size) : '';
		return [extension.toUpperCase(), measured].filter(Boolean).join(' · ');
	};

	const downloadUrl = (file: any) =>
		`${WEBUI_API_BASE_URL}/files/${encodeURIComponent(file?.id ?? '')}/content?attachment=true`;

	const open = (file: any) => {
		if (!canPreview(file)) {
			// Nothing to show for an archive or a binary: the click is the download.
			window.location.href = downloadUrl(file);
			return;
		}

		previewItem = {
			...file,
			meta: { name: file?.name, content_type: file?.content_type, size: file?.size }
		};
		showPreview = true;
	};
</script>

{#if previewItem}
	<FileItemModal bind:show={showPreview} bind:item={previewItem} />
{/if}

{#if files.length > 0}
	<div class="my-2 flex w-full flex-col gap-2" id={id ? `${id}-presented-files` : undefined}>
		{#each files as file (file.id ?? file.name)}
			<div
				class="group flex w-full items-center gap-1 rounded-2xl border border-gray-100 bg-white transition hover:border-gray-200 dark:border-white/8 dark:bg-gray-950/40 dark:hover:border-white/12"
			>
				<!--
					The card opens the file, the button beside it keeps the file. Two
					controls rather than one: which of the two a reader wants is not
					something a single click can tell.
				-->
				<button
					type="button"
					class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-2.5 text-left"
					on:click={() => open(file)}
				>
					<div
						class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-gray-400"
					>
						<Icon name={fileIconName(file?.name ?? '', 'file')} size={18} />
					</div>
					<div class="min-w-0 flex-1">
						<div
							class="truncate text-sm font-medium text-gray-800 dark:text-gray-100"
							title={file?.name}
						>
							{file?.name}
						</div>
						<div class="truncate text-xs text-gray-400 dark:text-gray-500">
							{describe(file)}
						</div>
					</div>
				</button>

				<Tooltip content={$i18n.t('Download')}>
					<a
						class="mr-2 flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/5"
						href={downloadUrl(file)}
						download={file?.name}
						aria-label={$i18n.t('Download {{NAME}}', { NAME: file?.name ?? '' })}
					>
						<Download className="size-4 shrink-0" />
						<span class="hidden @md:inline">{$i18n.t('Download')}</span>
					</a>
				</Tooltip>
			</div>
		{/each}
	</div>
{/if}
