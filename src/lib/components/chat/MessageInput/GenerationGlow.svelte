<script lang="ts">
	import { glowStyleAttribute, glowMotion, type GlowStyle } from '$lib/utils/generationGlow';

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

	$: motion = glowMotion(tokensPerSecond, {
		prefilling,
		speedScale: speed,
		intensity
	});

	$: variables = [glowStyleAttribute(motion), hue === null ? '' : `--glow-hue: ${hue}`]
		.filter(Boolean)
		.join('; ');

	$: visible = active && style !== 'off';
</script>

{#if visible}
	<!--
		Sits over the frame it decorates and takes no clicks. Every value that
		changes while a model answers arrives as a custom property, so the
		animation itself keeps running on the compositor rather than being
		restarted whenever the measured rate moves.
	-->
	<div class="generation-glow glow-{style}" style={variables} aria-hidden="true"></div>
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
		z-index: 0;

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

	/* ── aurora: three lights drifting at their own speeds ──────────────── */
	.glow-aurora::before,
	.glow-aurora::after {
		background:
			conic-gradient(
				from var(--glow-angle),
				transparent 0deg,
				var(--glow-a) 60deg,
				transparent 140deg
			),
			conic-gradient(
				from calc(var(--glow-angle) * -1.6 + 120deg),
				transparent 0deg,
				var(--glow-b) 70deg,
				transparent 160deg
			),
			conic-gradient(
				from calc(var(--glow-angle) * 2.3 + 240deg),
				transparent 0deg,
				var(--glow-c) 50deg,
				transparent 130deg
			);
		animation: glow-turn var(--glow-duration, 3s) linear infinite;
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
	 * moving to say it.
	 */
	@media (prefers-reduced-motion: reduce) {
		.generation-glow::before,
		.generation-glow::after {
			animation: none;
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
