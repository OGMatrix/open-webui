<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		glowStyleAttribute,
		glowMotion,
		hasInterior,
		meterBars,
		prefillFraction,
		pushRate,
		respondsToArrivals,
		shouldRipple,
		showsHistory,
		type GlowStyle
	} from '$lib/utils/generationGlow';

	/** True while a model is producing the answer. */
	export let active = false;
	/** Live rate, or null when nothing has been measured yet. */
	export let tokensPerSecond: number | null = null;
	/** Still reading the prompt, not yet writing. */
	export let prefilling = false;

	export let style: GlowStyle = 'sweep';
	/** Multiplies the pace, 0.25 to 3. */
	export let speed = 1;
	/** Scales presence, 0 to 2. */
	export let intensity = 1;
	/** Hue in degrees to build the palette from, or null to follow the theme. */
	export let hue: number | null = null;
	/** Lay film grain over whatever else is running. */
	export let grain = false;
	/** Running token count, which is how the frame knows text has arrived. */
	export let tokens = 0;
	/** Prompt-reading progress, where the provider reports any. */
	export let prefill: { percent?: number } | null = null;

	/** Rings currently expanding, oldest first. */
	let ripples: { id: number }[] = [];
	let rippleId = 0;
	let lastRippleAt = 0;
	let lastTokens = 0;
	let rippleTimer: ReturnType<typeof setTimeout> | null = null;

	/** Recent readings of the rate, for the meter. */
	let rateHistory: number[] = [];
	let meterTimer: ReturnType<typeof setInterval> | null = null;

	/**
	 * A ring for every arrival of text, spaced so they can be told apart.
	 *
	 * At most a handful live at once: a ring that has faded is still an element
	 * the browser composites, and a fast model would otherwise leave hundreds.
	 */
	const emitRipple = () => {
		const now = Date.now();
		if (!shouldRipple(lastRippleAt, now)) {
			return;
		}
		lastRippleAt = now;
		rippleId += 1;
		ripples = [...ripples, { id: rippleId }].slice(-4);

		if (rippleTimer) clearTimeout(rippleTimer);
		rippleTimer = setTimeout(() => {
			ripples = [];
			rippleTimer = null;
		}, 1400);
	};

	$: if (active && respondsToArrivals(style) && tokens > lastTokens) {
		lastTokens = tokens;
		emitRipple();
	}

	// A generation that ended leaves nothing behind for the next one to inherit.
	$: if (!active) {
		lastTokens = 0;
		ripples = [];
		rateHistory = [];
	}

	/**
	 * The meter samples on its own clock rather than on arrivals.
	 *
	 * Bars have to be evenly spaced in time to mean anything: sampling whenever
	 * text happened to arrive would draw a picture of the chunking, not of the
	 * speed.
	 */
	$: if (active && showsHistory(style)) {
		if (!meterTimer) {
			meterTimer = setInterval(() => {
				rateHistory = pushRate(rateHistory, tokensPerSecond);
			}, 260);
		}
	} else if (meterTimer) {
		clearInterval(meterTimer);
		meterTimer = null;
	}

	onDestroy(() => {
		if (meterTimer) clearInterval(meterTimer);
		if (rippleTimer) clearTimeout(rippleTimer);
	});

	$: bars = showsHistory(style) ? meterBars(rateHistory) : [];
	$: progress = prefilling ? prefillFraction(prefill) : null;

	$: motion = glowMotion(tokensPerSecond, { prefilling, speedScale: speed, intensity });

	$: variables = [
		glowStyleAttribute(motion),
		hue === null ? '' : `--glow-hue: ${hue}`,
		progress === null ? '' : `--glow-progress: ${progress.toFixed(4)}`
	]
		.filter(Boolean)
		.join('; ');

	$: visible = active && (style !== 'off' || grain);
</script>

{#if visible}
	<!--
		Sits behind the field's contents and takes no clicks. Everything that
		changes while a model answers arrives as a custom property, so the
		animations keep running on the compositor instead of being restarted
		whenever the measured rate moves.
	-->
	<div
		class="generation-glow glow-{style}"
		class:glow-reading={progress !== null}
		style={variables}
		aria-hidden="true"
	>
		{#if hasInterior(style)}
			<!--
				Three lights, blurred far past their own size and drifting on
				durations that share no common multiple, so the arrangement never
				comes back round to where it started.
			-->
			<div class="glow-field">
				<span class="glow-blob glow-blob-a"></span>
				<span class="glow-blob glow-blob-b"></span>
				<span class="glow-blob glow-blob-c"></span>
			</div>
		{/if}

		{#if respondsToArrivals(style)}
			<!--
				One ring per arrival of text, expanding from the edge. This is the
				only layer driven by the writing itself rather than by an average
				of it, so a model that stops for a moment visibly stops.
			-->
			<div class="glow-ripples">
				{#each ripples as ring (ring.id)}
					<span class="glow-ring"></span>
				{/each}
			</div>
		{/if}

		{#if showsHistory(style) && bars.length > 0}
			<!--
				The last few seconds of the rate, along the bottom edge. Not just
				how fast the model is now, but whether it has been steady.
			-->
			<div class="glow-histogram">
				{#each bars as height, index (index)}
					<span class="glow-bar" style="--bar: {height.toFixed(3)}"></span>
				{/each}
			</div>
		{/if}

		{#if grain}
			<div class="glow-grain"></div>
		{/if}
	</div>
{/if}

<style>
	/*
	 * An angle has to be a registered property for a browser to interpolate it;
	 * animating a plain custom property jumps from one value to the next.
	 */
	@property --glow-angle {
		syntax: '<angle>';
		inherits: false;
		initial-value: 0deg;
	}

	.generation-glow {
		position: absolute;
		inset: -1px;
		border-radius: inherit;
		pointer-events: none;
		/*
		 * Behind the field's own contents. The interior layers cover the whole
		 * shape, and the text has to stay the thing being read.
		 */
		z-index: -1;

		/* Follows the app's accent unless a hue was chosen. */
		--glow-hue: 250;
		--glow-a: hsl(var(--glow-hue) 90% 62%);
		--glow-b: hsl(calc(var(--glow-hue) + 70) 92% 66%);
		--glow-c: hsl(calc(var(--glow-hue) - 60) 88% 60%);

		opacity: var(--glow-opacity, 0.6);
		transition:
			opacity 400ms ease,
			filter 400ms ease;
	}

	/*
	 * The ring: two masks, one inset by the ring's own width, subtracted from
	 * each other. That leaves the edge alone and follows whatever radius the
	 * frame has, which a border cannot do without owning the element.
	 *
	 * Both layers are masked. The halo is a blurred copy of the ring, not a
	 * blurred copy of the whole shape - blurring a filled rectangle gives a
	 * smear across the field rather than light coming off its edge.
	 */
	.generation-glow::before,
	.generation-glow::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		padding: 1.5px;
		-webkit-mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		mask:
			linear-gradient(#000 0 0) content-box,
			linear-gradient(#000 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
	}

	/* The halo, sitting behind the ring so the edge stays the sharpest thing. */
	.generation-glow::after {
		padding: 2.5px;
		filter: blur(var(--glow-bloom, 10px));
		opacity: 0.7;
		z-index: -1;
	}

	/* ── sweep: a light travelling around the frame ─────────────────────── */
	.glow-sweep::before,
	.glow-sweep::after {
		background: conic-gradient(
			from var(--glow-angle),
			transparent 0deg,
			var(--glow-a) 40deg,
			var(--glow-b) 90deg,
			transparent 150deg,
			transparent 360deg
		);
		animation: glow-turn var(--glow-duration, 3s) linear infinite;
	}

	/* ── pulse: the whole frame breathing ───────────────────────────────── */
	.glow-pulse::before,
	.glow-pulse::after {
		background: linear-gradient(90deg, var(--glow-a), var(--glow-b), var(--glow-a));
		animation: glow-breathe var(--glow-duration, 3s) ease-in-out infinite;
	}

	/* ── aurora and nebula: the ring, plus light inside the field ───────── */
	.glow-aurora::before,
	.glow-aurora::after,
	.glow-nebula::before,
	.glow-nebula::after {
		background: conic-gradient(
			from var(--glow-angle),
			transparent 0deg,
			var(--glow-a) 60deg,
			transparent 150deg,
			var(--glow-b) 220deg,
			transparent 310deg
		);
		animation: glow-turn var(--glow-duration, 3s) linear infinite;
	}

	/* Nebula keeps its edge quiet; the interior is what it is for. */
	.glow-nebula::before,
	.glow-nebula::after {
		opacity: 0.45;
	}

	.glow-field {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		/* Blobs are far larger than the field; this is what keeps them inside it. */
		overflow: hidden;
		/*
		 * Light pools towards the edges and thins out across the middle, which is
		 * where the text sits. A field lit evenly is a field that is harder to
		 * read, and this is a box people type into.
		 */
		-webkit-mask: radial-gradient(
			ellipse 78% 130% at 50% 50%,
			transparent 8%,
			rgba(0, 0, 0, 0.55) 48%,
			#000 88%
		);
		mask: radial-gradient(
			ellipse 78% 130% at 50% 50%,
			transparent 8%,
			rgba(0, 0, 0, 0.55) 48%,
			#000 88%
		);
	}

	.glow-blob {
		position: absolute;
		display: block;
		width: 65%;
		/* Wider than tall: an input is a slot, and round blobs read as bubbles. */
		aspect-ratio: 2.4 / 1;
		border-radius: 50%;
		/*
		 * Light adds up where lights overlap, the way real ones do. Overlapping
		 * opacity would only muddy towards grey.
		 */
		mix-blend-mode: screen;
		filter: blur(22px);
		opacity: 0.42;
		will-change: transform;
	}

	.glow-blob-a {
		left: -10%;
		top: -30%;
		background: radial-gradient(circle at 50% 50%, var(--glow-a), transparent 70%);
		/*
		 * Durations that share no common multiple. Round numbers would line the
		 * three up again every few seconds and the eye would find the loop.
		 */
		animation: glow-drift-a calc(var(--glow-duration, 3s) * 6.1) ease-in-out infinite;
	}

	.glow-blob-b {
		right: -15%;
		top: 10%;
		background: radial-gradient(circle at 50% 50%, var(--glow-b), transparent 70%);
		animation: glow-drift-b calc(var(--glow-duration, 3s) * 8.3) ease-in-out infinite;
	}

	.glow-blob-c {
		left: 25%;
		bottom: -35%;
		background: radial-gradient(circle at 50% 50%, var(--glow-c), transparent 70%);
		animation: glow-drift-c calc(var(--glow-duration, 3s) * 4.7) ease-in-out infinite;
	}

	/*
	 * Only transform moves. Animating the gradients themselves would repaint the
	 * blur on every frame, which is the expensive half of this.
	 */
	@keyframes glow-drift-a {
		0%,
		100% {
			transform: translate3d(0, 0, 0) scale(1);
		}
		50% {
			transform: translate3d(40%, 25%, 0) scale(1.25);
		}
	}

	@keyframes glow-drift-b {
		0%,
		100% {
			transform: translate3d(0, 0, 0) scale(1.1);
		}
		50% {
			transform: translate3d(-35%, 30%, 0) scale(0.85);
		}
	}

	@keyframes glow-drift-c {
		0%,
		100% {
			transform: translate3d(0, 0, 0) scale(0.9);
		}
		50% {
			transform: translate3d(25%, -40%, 0) scale(1.3);
		}
	}

	/*
	 * Film grain. The noise is a data URI rather than a live SVG filter: a
	 * filter is recomputed as it animates, while an image is decoded once and
	 * then only moved. What moves is the layer, not the turbulence.
	 */
	.glow-grain {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		overflow: hidden;
		pointer-events: none;
		opacity: calc(0.18 * var(--glow-energy, 0.5) + 0.07);
		mix-blend-mode: overlay;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
		/*
		 * Jumping the tile by whole steps is what makes grain read as grain. A
		 * smooth slide would look like a texture being dragged across the field.
		 */
		animation: glow-grain-shift 0.7s steps(1, end) infinite;
		will-change: background-position;
	}

	@keyframes glow-grain-shift {
		0% {
			background-position: 0 0;
		}
		20% {
			background-position: -37px 21px;
		}
		40% {
			background-position: 29px -43px;
		}
		60% {
			background-position: -17px 53px;
		}
		80% {
			background-position: 47px 13px;
		}
		100% {
			background-position: -31px -29px;
		}
	}

	/*
	 * While the prompt is being read, the ring stops travelling and fills to how
	 * far through it is. The wait before the first token is the least explained
	 * part of a generation and, on a long prompt, the longest; where a provider
	 * counts its way through, the frame can say so instead of spinning.
	 */
	.glow-reading::before,
	.glow-reading::after {
		background: conic-gradient(
			from -90deg,
			var(--glow-a) 0deg,
			var(--glow-b) calc(var(--glow-progress, 0) * 360deg),
			transparent calc(var(--glow-progress, 0) * 360deg)
		);
		animation: none;
		/* The fill catches up smoothly rather than stepping between reports. */
		transition: background 300ms linear;
	}

	/* ── ripple: a ring for every arrival of text ───────────────────────── */
	.glow-ripples {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		overflow: hidden;
	}

	.glow-ripple::before,
	.glow-ripple::after {
		background: linear-gradient(90deg, var(--glow-a), var(--glow-b), var(--glow-a));
		animation: glow-breathe calc(var(--glow-duration, 3s) * 2) ease-in-out infinite;
	}

	.glow-ring {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		border: 1.5px solid var(--glow-b);
		opacity: 0;
		/* Rings expand and fade; overlapping ones are the point, not a fault. */
		animation: glow-ring-out 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
		will-change: transform, opacity;
	}

	@keyframes glow-ring-out {
		0% {
			transform: scale(0.94);
			opacity: 0.75;
		}
		100% {
			transform: scale(1.06);
			opacity: 0;
		}
	}

	/*
	 * meter: the last few seconds of the rate.
	 *
	 * The bar strip is called histogram, not meter: the root element already
	 * carries glow-meter for the chosen style, and a layer sharing that name
	 * had the strip's own layout land on the root as well.
	 */
	.glow-histogram {
		position: absolute;
		right: 1.25rem;
		bottom: 0;
		left: 1.25rem;
		display: flex;
		align-items: flex-end;
		gap: 2px;
		/*
		 * A definite height, not a percentage: a percentage inside a flex
		 * container is resolved against a height the container does not have
		 * until its own children are laid out, and the bars came out a pixel tall.
		 */
		height: 20px;
		border-radius: inherit;
		/* Fades out towards the top so bars grow out of the edge, not off a shelf. */
		-webkit-mask: linear-gradient(to top, #000 10%, transparent 95%);
		mask: linear-gradient(to top, #000 10%, transparent 95%);
	}

	.glow-bar {
		flex: 1 1 0;
		min-width: 0;
		/* Measured off the same definite height the container was given. */
		height: calc(var(--bar, 0) * 20px);
		border-radius: 2px 2px 0 0;
		background: linear-gradient(to top, var(--glow-a), var(--glow-b));
		/* Each new reading rises into place instead of appearing at its height. */
		transition: height 240ms ease-out;
	}

	.glow-histogram::before,
	.glow-histogram::after {
		background: linear-gradient(90deg, var(--glow-a), var(--glow-b), var(--glow-a));
	}

	@keyframes glow-turn {
		to {
			--glow-angle: 360deg;
		}
	}

	@keyframes glow-breathe {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}

	/*
	 * Motion around a text field is exactly what a person who asked for less of
	 * it does not want. The frame still says a model is working, it just stops
	 * moving to say it, and the grain stops crawling entirely.
	 */
	@media (prefers-reduced-motion: reduce) {
		.generation-glow::before,
		.generation-glow::after,
		.glow-blob,
		.glow-grain,
		.glow-ring {
			animation: none;
		}

		/* A ring that cannot expand should not sit there as a static outline. */
		.glow-ring {
			display: none;
		}

		.generation-glow::before,
		.generation-glow::after {
			background: linear-gradient(90deg, var(--glow-a), var(--glow-b));
		}
	}

	/*
	 * Without a registered angle there is nothing to interpolate, so the sweep
	 * would sit still. A gradient that does not depend on the angle at least
	 * keeps the frame lit.
	 */
	@supports not (background: conic-gradient(from 0deg, red, blue)) {
		.generation-glow::before,
		.generation-glow::after {
			background: linear-gradient(90deg, var(--glow-a), var(--glow-b), var(--glow-a));
			animation: glow-breathe var(--glow-duration, 3s) ease-in-out infinite;
		}
	}
</style>
