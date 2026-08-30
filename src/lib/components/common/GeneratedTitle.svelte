<script lang="ts">
	import { onDestroy } from 'svelte';

	// Chat records are untyped at several call sites, so this accepts whatever
	// they hold and coerces below. Constraining it here instead only pushes
	// implicit-any and unknown errors out into those callers.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export let title: any = '';
	/** True while the backend is still generating this chat's title. */
	export let generating = false;
	export let className = '';
	/** Width of the placeholder bar; the sidebar and the header want different ones. */
	export let skeletonWidth = '9rem';

	// Fast enough to read as one motion rather than a typewriter.
	const CHAR_STAGGER_MS = 16;
	// Past this the stagger stops growing, so a long title still lands promptly.
	const MAX_STAGGERED_CHARS = 40;
	const CHAR_DURATION_MS = 260;

	let revealing = false;
	let revealChars: string[] = [];
	let pendingReveal = false;
	let previousGenerating = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	$: text = typeof title === 'string' ? title : title == null ? '' : String(title);

	const clearTimer = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const startReveal = (value: string) => {
		clearTimer();
		revealChars = Array.from(value);
		revealing = true;

		const stagger = Math.min(revealChars.length, MAX_STAGGERED_CHARS) * CHAR_STAGGER_MS;
		// Drop back to plain text once the motion is done, so the title truncates
		// and gets selected like any other text for the rest of its life.
		timer = setTimeout(
			() => {
				revealing = false;
				timer = null;
			},
			stagger + CHAR_DURATION_MS + 60
		);
	};

	// Only animate on the generating -> done transition. A rename, or switching
	// to another chat, should just render.
	const syncGenerating = (isGenerating: boolean) => {
		if (isGenerating === previousGenerating) {
			return;
		}
		const finished = previousGenerating && !isGenerating;
		previousGenerating = isGenerating;

		if (isGenerating) {
			revealing = false;
			pendingReveal = false;
			clearTimer();
			return;
		}

		if (finished) {
			// The title may land a tick after the flag clears.
			if (text) {
				startReveal(text);
			} else {
				pendingReveal = true;
			}
		}
	};

	$: syncGenerating(generating);
	$: if (pendingReveal && text) {
		pendingReveal = false;
		startReveal(text);
	}

	onDestroy(clearTimer);
</script>

{#if generating}
	<span
		class="generated-title-skeleton {className}"
		style="--skeleton-width: {skeletonWidth}"
		aria-hidden="true"
	></span>
{:else if revealing}
	<span class="generated-title-reveal {className}" aria-label={text}>
		{#each revealChars as character, index (index)}
			<span style="animation-delay: {Math.min(index, MAX_STAGGERED_CHARS) * CHAR_STAGGER_MS}ms"
				>{character}</span
			>
		{/each}
	</span>
{:else}
	{text}
{/if}

<style>
	.generated-title-skeleton {
		display: inline-block;
		width: var(--skeleton-width, 9rem);
		max-width: 100%;
		height: 0.7em;
		vertical-align: middle;
		border-radius: 9999px;
		background-color: currentColor;
		opacity: 0.16;
		background-image: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255, 255, 255, 0.55) 50%,
			transparent 100%
		);
		background-size: 200% 100%;
		background-repeat: no-repeat;
		animation: generated-title-shimmer 1.5s ease-in-out infinite;
	}

	@keyframes generated-title-shimmer {
		0% {
			background-position: 150% 0;
		}
		100% {
			background-position: -50% 0;
		}
	}

	.generated-title-reveal {
		/* Keep the spaces the title was generated with. */
		white-space: pre;
	}

	.generated-title-reveal > span {
		display: inline-block;
		opacity: 0;
		animation: generated-title-in 260ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
	}

	@keyframes generated-title-in {
		from {
			opacity: 0;
			transform: translateY(0.32em) scale(0.96);
			filter: blur(2px);
		}
		to {
			opacity: 1;
			transform: none;
			filter: blur(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.generated-title-skeleton {
			animation: none;
			background-image: none;
		}

		.generated-title-reveal > span {
			animation: generated-title-fade 120ms ease-out forwards;
		}

		@keyframes generated-title-fade {
			from {
				opacity: 0;
			}
			to {
				opacity: 1;
			}
		}
	}
</style>
