<script lang="ts">
	import { getContext, onDestroy, onMount, tick } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import { settings } from '$lib/stores';
	import { createMessagesList } from '$lib/utils';
	import {
		buildOutline,
		entryForTurn,
		stepOutline,
		type OutlineEntry
	} from '$lib/utils/chatOutline';
	import { matchKeybinding, Shortcut } from '$lib/shortcuts';

	import Tooltip from '$lib/components/common/Tooltip.svelte';

	const i18n = getContext<Writable<i18nType>>('i18n');

	export let history: { messages?: Record<string, any>; currentId?: string | null } = {};
	export let messagesContainerId = 'messages-container';
	/** Renders the whole branch, so an older turn can be reached. */
	export let renderAll: () => Promise<void> = async () => {};
	/** Called before jumping, so the view stops following a streaming answer. */
	export let onNavigate: () => void = () => {};

	/**
	 * Below this the outline is noise: a handful of turns are already all on
	 * screen, and a rail beside them says nothing the conversation does not.
	 */
	const MINIMUM_TURNS = 3;

	let activeId: string | null = null;
	let railElement: HTMLElement | null = null;

	$: branch = createMessagesList(history, history?.currentId ?? null) ?? [];
	$: outline = buildOutline(branch);
	$: visible = outline.length >= MINIMUM_TURNS;

	/**
	 * Past this many marks the rail draws itself tighter.
	 *
	 * Clipping instead would cut equally from both ends, losing the start and
	 * the end of the conversation -- the two landmarks worth most. Thirty marks
	 * at the roomy size is three hundred pixels; the tight size carries a
	 * hundred and twenty in the same space a screen can spare.
	 */
	const DENSE_ABOVE = 30;
	$: dense = outline.length > DENSE_ABOVE;

	const messageElement = (id: string) => document.getElementById(`message-${id}`);

	/**
	 * The turn the reader is inside.
	 *
	 * The last question whose message has passed the top of the viewport, which
	 * is the one whose answer fills the screen.
	 */
	const updateActive = () => {
		const container = document.getElementById(messagesContainerId);
		if (!container || outline.length === 0) return;

		const top = container.getBoundingClientRect().top;
		let deepest: number | null = null;

		for (const [turn, message] of branch.entries()) {
			const element = messageElement(String(message?.id ?? ''));
			// Older messages are not rendered yet, so a gap here is expected.
			if (!element) continue;
			// A small allowance, so a question sitting just under the navbar still
			// counts as the one being read.
			if (element.getBoundingClientRect().top - top <= 80) {
				deepest = turn;
			} else {
				break;
			}
		}

		activeId = deepest === null ? null : (entryForTurn(outline, deepest)?.id ?? null);
	};

	let scheduled = 0;
	const onScroll = () => {
		cancelAnimationFrame(scheduled);
		scheduled = requestAnimationFrame(updateActive);
	};

	const goTo = async (entry: OutlineEntry | null) => {
		if (!entry) return;
		onNavigate();

		if (!messageElement(entry.id)) {
			// Older turns are paged in on scroll, so the target may not exist yet.
			await renderAll();
			await tick();
		}

		messageElement(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		activeId = entry.id;
	};

	const step = (direction: 1 | -1) => goTo(stepOutline(outline, activeId, direction));

	const onKeydown = (event: KeyboardEvent) => {
		if (($settings?.keyboardShortcuts ?? true) === false) return;

		const shortcut = matchKeybinding(event);
		if (shortcut === Shortcut.NAVIGATE_TURN_UP) {
			event.preventDefault();
			step(-1);
		} else if (shortcut === Shortcut.NAVIGATE_TURN_DOWN) {
			event.preventDefault();
			step(1);
		}
	};

	/**
	 * Arrow keys move between marks once the rail has focus.
	 *
	 * With a roving tabindex this is the only way to reach the other marks from
	 * the keyboard, and it is what a listbox is expected to do.
	 */
	const onRailKeydown = (event: KeyboardEvent, index: number) => {
		const next =
			event.key === 'ArrowDown' || event.key === 'ArrowRight'
				? index + 1
				: event.key === 'ArrowUp' || event.key === 'ArrowLeft'
					? index - 1
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? outline.length - 1
							: null;

		if (next === null || next < 0 || next >= outline.length) return;

		event.preventDefault();
		goTo(outline[next]);
		// The rail is rebuilt with a new roving tabindex, so focus has to follow.
		tick().then(() => {
			railElement?.querySelector<HTMLElement>('button[tabindex="0"]')?.focus();
		});
	};

	onMount(() => {
		const container = document.getElementById(messagesContainerId);
		container?.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('keydown', onKeydown);
		updateActive();

		return () => {
			container?.removeEventListener('scroll', onScroll);
			window.removeEventListener('keydown', onKeydown);
		};
	});

	onDestroy(() => cancelAnimationFrame(scheduled));

	// A new mark means the rail changed shape, so the highlight has to catch
	// up. Deliberately keyed on the count alone: measuring every message on
	// every frame of a streaming answer would thrash layout for nothing, and
	// scrolling already keeps the highlight current.
	$: markCount = outline.length;
	$: if (markCount) void tick().then(updateActive);

	$: activeIndex = outline.findIndex((entry) => entry.id === activeId);
	/** With nothing active yet, the first mark carries the tab stop. */
	$: tabStop = activeIndex === -1 ? 0 : activeIndex;

	const describe = (entry: OutlineEntry): string => {
		if (entry.kind === 'compaction') return $i18n.t('Context compacted');

		const label = entry.label || $i18n.t('Message');
		const parts: string[] = [];
		if (entry.toolCalls > 0) {
			parts.push($i18n.t('{{COUNT}} tool calls', { COUNT: entry.toolCalls }));
		}
		if (entry.reasoning > 0) {
			parts.push($i18n.t('{{COUNT}} reasoning blocks', { COUNT: entry.reasoning }));
		}
		return parts.length ? `${label} — ${parts.join(', ')}` : label;
	};
</script>

{#if visible}
	<!--
		A rail rather than a panel: what a long agentic run hides is its own
		shape, and a column of marks shows how many questions it holds and where
		in them the reader is, without covering the answer they are reading.
	-->
	<nav
		bind:this={railElement}
		aria-label={$i18n.t('Conversation outline')}
		class="pointer-events-auto hidden max-h-[60vh] flex-col justify-center overflow-hidden py-2 @md:flex {dense
			? 'gap-px'
			: 'gap-[3px]'}"
	>
		{#each outline as entry, index (entry.id + entry.kind)}
			<Tooltip content={describe(entry)} placement="left">
				<button
					type="button"
					aria-label={describe(entry)}
					aria-current={entry.id === activeId ? 'true' : undefined}
					tabindex={index === tabStop ? 0 : -1}
					class="group flex w-6 shrink items-center justify-end focus:outline-hidden {dense
						? 'h-[4px] min-h-[2px]'
						: 'h-[7px] min-h-[3px]'}"
					on:click={() => goTo(entry)}
					on:keydown={(event) => onRailKeydown(event, index)}
				>
					<!--
						The mark is thin, but the button around it is a full-height
						target, so it can be hit without aiming.
					-->
					<span
						class="block h-[3px] rounded-full transition-all duration-150 {entry.kind ===
						'compaction'
							? 'w-4 bg-amber-400/70 group-hover:bg-amber-400'
							: entry.id === activeId
								? 'w-5 bg-gray-500 dark:bg-gray-300'
								: 'w-3 bg-gray-300 group-hover:w-5 group-hover:bg-gray-400 dark:bg-gray-700 dark:group-hover:bg-gray-500'}"
					></span>
				</button>
			</Tooltip>
		{/each}
	</nav>
{/if}
