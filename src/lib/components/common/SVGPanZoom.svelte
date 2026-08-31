<script lang="ts">
	import fileSaver from 'file-saver';
	const { saveAs } = fileSaver;

	import { toast } from 'svelte-sonner';

	import DOMPurify from 'dompurify';

	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	const i18n: Writable<i18nType> = getContext('i18n');

	import { copyToClipboard } from '$lib/utils';

	import PanzoomContainer from './PanzoomContainer.svelte';
	import Tooltip from './Tooltip.svelte';
	import Clipboard from '../icons/Clipboard.svelte';
	import Reset from '../icons/Reset.svelte';
	import Download from '../icons/Download.svelte';
	import Photo from '../icons/Photo.svelte';
	import Plus from '../icons/Plus.svelte';
	import Minus from '../icons/Minus.svelte';
	import ArrowsPointingOut from '../icons/ArrowsPointingOut.svelte';

	export let className = '';
	export let svg = '';
	export let content = '';
	/** Names the downloaded files, so a chat full of diagrams stays sortable. */
	export let name = 'diagram';

	let panzoomRef: PanzoomContainer;
	let frame: HTMLElement;
	let isFullscreen = false;

	const resetPanZoomViewport = () => {
		panzoomRef?.reset();
	};

	const downloadAsSVG = () => {
		const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
		saveAs(svgBlob, `${name}.svg`);
	};

	/** Intrinsic size of the drawing, which the viewBox states even when width does not. */
	const svgSize = (markup: string) => {
		const box = markup.match(
			/viewBox="\s*([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)/
		);
		if (box) {
			const width = parseFloat(box[3]);
			const height = parseFloat(box[4]);
			if (width > 0 && height > 0) return { width, height };
		}
		const width = parseFloat(markup.match(/\bwidth="([\d.]+)/)?.[1] ?? '');
		const height = parseFloat(markup.match(/\bheight="([\d.]+)/)?.[1] ?? '');
		return width > 0 && height > 0 ? { width, height } : { width: 1200, height: 800 };
	};

	/**
	 * Rasterises the diagram so it can be pasted into a document or a slide,
	 * which is where diagrams tend to end up and where SVG is often not accepted.
	 *
	 * Drawn at twice the intrinsic size so it stays sharp on a retina screen, and
	 * on an opaque background so it does not vanish into a white page.
	 */
	const downloadAsPNG = async () => {
		try {
			const { width, height } = svgSize(svg);
			const scale = 2;

			// A sized root is required: an SVG with only a viewBox draws at 0x0 here.
			const sized = svg.replace(
				/<svg\b/,
				`<svg width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"`
			);

			const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml;charset=utf-8' }));
			try {
				const image = new Image();
				image.decoding = 'sync';
				await new Promise<void>((resolve, reject) => {
					image.onload = () => resolve();
					image.onerror = () => reject(new Error('image decode failed'));
					image.src = url;
				});

				const canvas = document.createElement('canvas');
				canvas.width = Math.round(width * scale);
				canvas.height = Math.round(height * scale);
				const context = canvas.getContext('2d');
				if (!context) throw new Error('no 2d context');

				context.fillStyle = document.documentElement.classList.contains('dark')
					? '#1a1a1a'
					: '#ffffff';
				context.fillRect(0, 0, canvas.width, canvas.height);
				context.drawImage(image, 0, 0, canvas.width, canvas.height);

				const blob = await new Promise<Blob | null>((resolve) =>
					canvas.toBlob(resolve, 'image/png')
				);
				if (!blob) throw new Error('canvas produced no image');
				saveAs(blob, `${name}.png`);
			} finally {
				URL.revokeObjectURL(url);
			}
		} catch (error) {
			console.error('Failed to export diagram as PNG:', error);
			toast.error($i18n.t('Failed to export as PNG'));
		}
	};

	const toggleFullscreen = async () => {
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else {
				await frame?.requestFullscreen();
			}
		} catch (error) {
			console.error('Fullscreen request failed:', error);
		}
	};

	const onFullscreenChange = () => {
		isFullscreen = document.fullscreenElement === frame;
		// The drawing was fitted to the old box; give it the new one.
		resetPanZoomViewport();
	};
</script>

<svelte:document on:fullscreenchange={onFullscreenChange} />

<div
	class="diagram-frame group relative {className}"
	class:is-fullscreen={isFullscreen}
	bind:this={frame}
>
	<PanzoomContainer
		bind:this={panzoomRef}
		className="flex h-full max-h-full justify-center items-center"
	>
		{@html DOMPurify.sanitize(svg, {
			USE_PROFILES: { svg: true, svgFilters: true }, // allow <svg>, <defs>, <filter>, etc.
			WHOLE_DOCUMENT: false,
			ADD_TAGS: ['style', 'foreignObject'], // include foreignObject if using HTML labels
			ADD_ATTR: [
				'class',
				'style',
				'id',
				'data-*',
				'viewBox',
				'preserveAspectRatio',
				// markers / arrows
				'markerWidth',
				'markerHeight',
				'markerUnits',
				'refX',
				'refY',
				'orient',
				// hrefs (for gradients, markers, etc.)
				'href',
				'xlink:href',
				// text positioning
				'dominant-baseline',
				'text-anchor',
				// pattern / clip / mask units
				'clipPathUnits',
				'filterUnits',
				'patternUnits',
				'patternContentUnits',
				'maskUnits',
				// a11y niceties
				'role',
				'aria-label',
				'aria-labelledby',
				'aria-hidden',
				'tabindex'
			],
			SANITIZE_DOM: true
		})}
	</PanzoomContainer>

	{#if content}
		<!-- Held back until the pointer arrives, so the diagram is what is on screen. -->
		<div
			class="pointer-events-none absolute top-2.5 right-2.5 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
		>
			<Tooltip content={$i18n.t('Zoom out')}>
				<button
					class="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm ring-1 ring-gray-100 backdrop-blur-sm transition hover:text-gray-900 dark:bg-gray-850/90 dark:text-gray-300 dark:ring-gray-800 dark:hover:text-white"
					on:click={() => panzoomRef?.zoomOut()}
				>
					<Minus className="size-4" strokeWidth="2" />
				</button>
			</Tooltip>
			<Tooltip content={$i18n.t('Zoom in')}>
				<button
					class="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm ring-1 ring-gray-100 backdrop-blur-sm transition hover:text-gray-900 dark:bg-gray-850/90 dark:text-gray-300 dark:ring-gray-800 dark:hover:text-white"
					on:click={() => panzoomRef?.zoomIn()}
				>
					<Plus className="size-4" strokeWidth="2" />
				</button>
			</Tooltip>
			<Tooltip content={$i18n.t('Reset view')}>
				<button
					class="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm ring-1 ring-gray-100 backdrop-blur-sm transition hover:text-gray-900 dark:bg-gray-850/90 dark:text-gray-300 dark:ring-gray-800 dark:hover:text-white"
					on:click={() => resetPanZoomViewport()}
				>
					<Reset className="size-4" />
				</button>
			</Tooltip>
			<Tooltip content={$i18n.t(isFullscreen ? 'Exit fullscreen' : 'Fullscreen')}>
				<button
					class="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm ring-1 ring-gray-100 backdrop-blur-sm transition hover:text-gray-900 dark:bg-gray-850/90 dark:text-gray-300 dark:ring-gray-800 dark:hover:text-white"
					on:click={() => toggleFullscreen()}
				>
					<ArrowsPointingOut className="size-4" />
				</button>
			</Tooltip>
			<Tooltip content={$i18n.t('Download as SVG')}>
				<button
					class="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm ring-1 ring-gray-100 backdrop-blur-sm transition hover:text-gray-900 dark:bg-gray-850/90 dark:text-gray-300 dark:ring-gray-800 dark:hover:text-white"
					on:click={() => downloadAsSVG()}
				>
					<Download className="size-4" />
				</button>
			</Tooltip>
			<Tooltip content={$i18n.t('Download as PNG')}>
				<button
					class="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm ring-1 ring-gray-100 backdrop-blur-sm transition hover:text-gray-900 dark:bg-gray-850/90 dark:text-gray-300 dark:ring-gray-800 dark:hover:text-white"
					on:click={() => downloadAsPNG()}
				>
					<Photo className="size-4" />
				</button>
			</Tooltip>
			<Tooltip content={$i18n.t('Copy source')}>
				<button
					class="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow-sm ring-1 ring-gray-100 backdrop-blur-sm transition hover:text-gray-900 dark:bg-gray-850/90 dark:text-gray-300 dark:ring-gray-800 dark:hover:text-white"
					on:click={() => {
						copyToClipboard(content);
						toast.success($i18n.t('Copied to clipboard'));
					}}
				>
					<Clipboard className="size-4" strokeWidth="1.5" />
				</button>
			</Tooltip>
		</div>
	{/if}
</div>

<style>
	/* Fullscreen paints its own black backdrop; give it the app surface instead. */
	.diagram-frame.is-fullscreen {
		background-color: white;
		max-height: none;
	}

	:global(.dark) .diagram-frame.is-fullscreen {
		background-color: #1a1a1a;
	}
</style>
