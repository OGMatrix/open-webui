<script lang="ts">
	import { getContext, tick } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { decode } from 'html-entities';
	import fileSaver from 'file-saver';
	const { saveAs } = fileSaver;

	import { copyToClipboard } from '$lib/utils';
	import { readNumericColumn, sortRowOrder, type SortDirection } from '$lib/utils/markdownTable';
	import { settings } from '$lib/stores';

	import MarkdownInlineTokens from '$lib/components/chat/Messages/Markdown/MarkdownInlineTokens.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Clipboard from '$lib/components/icons/Clipboard.svelte';
	import Download from '$lib/components/icons/Download.svelte';
	import ChevronUp from '$lib/components/icons/ChevronUp.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	export let id: string;
	export let token: any;
	export let tokenIdx = 0;
	export let done = true;
	export let sourceIds: string[] = [];
	export let onSourceClick: (...args: any[]) => void = () => {};

	/** Rows are only worth pinning the header for once they outrun the viewport. */
	const STICKY_FROM_ROWS = 8;

	let scroller: HTMLElement | null = null;
	let atStart = true;
	let atEnd = true;

	let sortColumn: number | null = null;
	let sortDirection: SortDirection = 'asc';

	$: locale = $i18n?.language || 'en-US';
	$: rows = token?.rows ?? [];
	$: header = token?.header ?? [];

	/** Plain text per column, which is what alignment and sorting reason about. */
	$: columnText = header.map((_: unknown, column: number) =>
		rows.map((row: any[]) => decode(row?.[column]?.text ?? ''))
	);

	$: numericColumns = columnText.map((cells: string[]) => readNumericColumn(cells, locale));

	/**
	 * An explicit markdown alignment always wins. Where the author left it open,
	 * a column that holds only numbers goes right, so digits line up by place
	 * value and magnitudes can be compared at a glance.
	 */
	$: alignments = header.map((_: unknown, column: number) => {
		const declared = token?.align?.[column];
		if (declared) return declared;
		return numericColumns[column] ? 'right' : null;
	});

	$: rowOrder = (() => {
		const identity = rows.map((_: unknown, index: number) => index);
		if (sortColumn === null || !columnText[sortColumn]) return identity;
		return sortRowOrder(columnText[sortColumn], sortDirection, locale, numericColumns[sortColumn]);
	})();

	$: sticky = rows.length >= STICKY_FROM_ROWS;

	const toggleSort = (column: number) => {
		if (sortColumn !== column) {
			sortColumn = column;
			// Numbers are most useful largest-first; text reads best A to Z.
			sortDirection = numericColumns[column] ? 'desc' : 'asc';
			return;
		}
		if (sortDirection === (numericColumns[column] ? 'desc' : 'asc')) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
			return;
		}
		// Third click hands the model's own row order back.
		sortColumn = null;
	};

	const updateScrollEdges = () => {
		if (!scroller) return;
		const max = scroller.scrollWidth - scroller.clientWidth;
		atStart = scroller.scrollLeft <= 1;
		atEnd = max <= 1 || scroller.scrollLeft >= max - 1;
	};

	// Column widths settle after the cells render, and again whenever they change.
	$: if (scroller && columnText) {
		tick().then(updateScrollEdges);
	}

	const csvCell = (text: string) => `"${decode(text).replace(/"/g, '""')}"`;

	const exportCSV = () => {
		const headerRow = header.map((cell: any) => csvCell(cell.text));
		// Export what is on screen, sort and all, so the file matches the table.
		const bodyRows = rowOrder.map((index: number) =>
			(rows[index] ?? []).map((cell: any) =>
				csvCell((cell.tokens ?? []).map((inner: any) => inner.text).join(''))
			)
		);

		const csv = [headerRow, ...bodyRows].map((row) => row.join(',')).join('\n');
		// The BOM is what makes Excel read the file as UTF-8.
		const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=UTF-8' });
		saveAs(blob, `table-${id}-${tokenIdx}.csv`);
	};

	const copySource = () => {
		copyToClipboard(token.raw.trim(), null, $settings?.copyFormatted ?? false);
	};
</script>

<div class="markdown-table group relative my-2.5 w-full">
	<div
		class="table-frame relative overflow-hidden rounded-xl ring-1 ring-gray-200/80 dark:ring-white/10"
		class:is-start={atStart}
		class:is-end={atEnd}
	>
		<div
			class="scrollbar-thin relative max-h-[32rem] overflow-auto"
			bind:this={scroller}
			on:scroll={updateScrollEdges}
		>
			<!--
				Sized by its content, never below the frame.

				`width: 100%` made every table fit the pane, which sounds right and
				reads badly: a column of file paths gets crushed to a few characters
				and each one breaks mid-path. The frame scrolls, so a wide table can
				be wide; cells cap their own width so one long paragraph cannot make
				it absurd.
			-->
			<table class="markdown-table-grid border-collapse text-start" dir="auto">
				<thead class={sticky ? 'sticky top-0 z-10' : ''}>
					<tr>
						{#each header as cell, column}
							<th
								scope="col"
								aria-sort={sortColumn === column
									? sortDirection === 'asc'
										? 'ascending'
										: 'descending'
									: 'none'}
								class="border-b border-gray-200 bg-gray-100/90 px-3.5 py-2.5 text-start text-[0.6875rem] font-semibold tracking-wide whitespace-nowrap text-gray-600 uppercase backdrop-blur-sm dark:border-white/10 dark:bg-white/[0.06] dark:text-gray-300"
								style={alignments[column] ? `text-align: ${alignments[column]}` : ''}
							>
								<button
									type="button"
									class="group/sort inline-flex max-w-full cursor-pointer items-center gap-1 rounded transition-colors hover:text-gray-900 dark:hover:text-white"
									class:flex-row-reverse={alignments[column] === 'right'}
									on:click={() => toggleSort(column)}
									title={$i18n.t('Sort by this column')}
								>
									<span class="min-w-0 break-normal">
										<MarkdownInlineTokens
											id={`${id}-${tokenIdx}-header-${column}`}
											tokens={cell.tokens}
											{done}
											{sourceIds}
											{onSourceClick}
										/>
									</span>
									<span
										class="shrink-0 transition-opacity {sortColumn === column
											? 'opacity-100'
											: 'opacity-0 group-hover/sort:opacity-40'}"
									>
										{#if sortColumn === column && sortDirection === 'desc'}
											<ChevronDown className="size-3" strokeWidth="2.5" />
										{:else}
											<ChevronUp className="size-3" strokeWidth="2.5" />
										{/if}
									</span>
								</button>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rowOrder as rowIndex (rowIndex)}
						<tr
							class="transition-colors even:bg-gray-50/70 hover:bg-gray-100/70 dark:even:bg-white/[0.035] dark:hover:bg-white/[0.07]"
						>
							{#each rows[rowIndex] ?? [] as cell, column}
								<td
									class="px-3.5 py-2.5 align-top text-[0.8125rem] leading-relaxed text-gray-800 dark:text-gray-200"
									class:tabular-nums={!!numericColumns[column]}
									style={alignments[column] ? `text-align: ${alignments[column]}` : ''}
								>
									<div class="break-normal">
										<MarkdownInlineTokens
											id={`${id}-${tokenIdx}-row-${rowIndex}-${column}`}
											tokens={cell.tokens}
											{done}
											{sourceIds}
											{onSourceClick}
										/>
									</div>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<div
		class="pointer-events-none absolute top-1.5 right-1.5 z-20 flex gap-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
	>
		<Tooltip content={$i18n.t('Copy')}>
			<button
				class="rounded-lg bg-white/80 p-1 text-gray-600 backdrop-blur-sm transition hover:text-gray-900 dark:bg-gray-900/80 dark:text-gray-300 dark:hover:text-white"
				on:click={(e) => {
					e.stopPropagation();
					copySource();
				}}
			>
				<Clipboard className="size-3.5" strokeWidth="1.5" />
			</button>
		</Tooltip>

		<Tooltip content={$i18n.t('Export to CSV')}>
			<button
				class="rounded-lg bg-white/80 p-1 text-gray-600 backdrop-blur-sm transition hover:text-gray-900 dark:bg-gray-900/80 dark:text-gray-300 dark:hover:text-white"
				on:click={(e) => {
					e.stopPropagation();
					exportCSV();
				}}
			>
				<Download className="size-3.5" strokeWidth="1.5" />
			</button>
		</Tooltip>
	</div>
</div>

<style>
	/*
	 * Fits the frame, and is stopped from crushing its columns by its content.
	 *
	 * Sizing by max-content was the wrong half of an earlier fix. It did keep a
	 * column of file paths from being crushed, but it also made any table with
	 * three columns and a paragraph in one of them wider than the pane, so
	 * reading the last column meant scrolling sideways for it.
	 *
	 * The half that mattered is below: a codespan that will not wrap gives its
	 * column a floor the table layout has to respect. Measured on both tables
	 * that were reported — two columns of paths, and three with a prose column
	 * — at the real width of the message column, each now fills its frame
	 * exactly, scrolls in neither direction, and breaks no chip.
	 */
	.markdown-table-grid {
		width: 100%;
	}

	/*
	 * One cell cannot make the table absurd. Past this a paragraph wraps, which
	 * is right for prose and far past anything a label or a path needs.
	 */
	.markdown-table-grid :global(th),
	.markdown-table-grid :global(td) {
		max-width: 32rem;
	}

	/*
	 * A hairline between columns. With two columns of unlike things -- a label
	 * and a paragraph about it -- the eye needs to know where one ends, and
	 * relying on the gap alone stops working as soon as a cell wraps.
	 */
	.markdown-table-grid :global(th + th),
	.markdown-table-grid :global(td + td) {
		border-inline-start: 1px solid var(--table-rule, rgba(0, 0, 0, 0.06));
	}

	:global(.dark) .markdown-table-grid {
		--table-rule: rgba(255, 255, 255, 0.07);
	}

	/*
	 * Inline code stays in one piece, and this is what keeps the columns honest.
	 *
	 * A codespan is a chip with its own background, so half of one at the end of
	 * a line and half at the start of the next reads as two different things --
	 * `src/core/llama-` above `cpp-client.ts`. Refusing to wrap also gives the
	 * column a width the table layout cannot go below, which is what stops a
	 * path column being crushed to ten characters in the first place.
	 *
	 * The cost is bounded and was measured: a single token wide enough to beat
	 * the cell cap above overruns it, by 27px for a hundred-character path,
	 * inside a frame that scrolls. That is rarer than either failure it avoids.
	 */
	.markdown-table-grid :global(.codespan) {
		white-space: nowrap;
	}

	/*
	 * Fades at the scrollable edges: without them a table that continues past the
	 * right edge looks like a table that simply ends there.
	 */
	.table-frame::before,
	.table-frame::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1.5rem;
		pointer-events: none;
		z-index: 15;
		opacity: 1;
		transition: opacity 150ms ease;
	}

	.table-frame::before {
		left: 0;
		background: linear-gradient(to right, var(--table-edge, rgba(255, 255, 255, 0.9)), transparent);
	}

	.table-frame::after {
		right: 0;
		background: linear-gradient(to left, var(--table-edge, rgba(255, 255, 255, 0.9)), transparent);
	}

	.table-frame.is-start::before,
	.table-frame.is-end::after {
		opacity: 0;
	}

	:global(.dark) .table-frame::before,
	:global(.dark) .table-frame::after {
		--table-edge: rgba(0, 0, 0, 0.9);
	}

	/* Slim scrollbar so a scrollable table does not gain a heavy grey bar. */
	.scrollbar-thin {
		scrollbar-width: thin;
		scrollbar-color: rgba(150, 150, 150, 0.4) transparent;
	}

	.scrollbar-thin::-webkit-scrollbar {
		width: 6px;
		height: 6px;
	}

	.scrollbar-thin::-webkit-scrollbar-thumb {
		background-color: rgba(150, 150, 150, 0.4);
		border-radius: 999px;
	}

	.scrollbar-thin::-webkit-scrollbar-track {
		background: transparent;
	}
</style>
