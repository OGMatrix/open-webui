<script lang="ts">
	import { getContext, onDestroy, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';

	import GenerationGlow from '$lib/components/chat/MessageInput/GenerationGlow.svelte';
	import Switch from '$lib/components/common/Switch.svelte';
	import ChevronDown from '$lib/components/icons/ChevronDown.svelte';
	import LightBulb from '$lib/components/icons/LightBulb.svelte';
	import Mic from '$lib/components/icons/Mic.svelte';
	import PlusAlt from '$lib/components/icons/PlusAlt.svelte';
	import Sparkles from '$lib/components/icons/Sparkles.svelte';
	import Voice from '$lib/components/icons/Voice.svelte';
	import { GLOW_STYLES, type GlowStyle } from '$lib/utils/generationGlow';
	import { previewFrame, type PreviewFrame } from '$lib/utils/generationPreview';

	const i18n: Writable<i18nType> = getContext('i18n');

	/** Typed as the surrounding settings components type it. */
	export let saveSettings: Function;

	export let style: GlowStyle = 'sweep';
	export let speed = 1;
	export let intensity = 1;
	export let spill = 1;
	export let hue: number | null = null;
	export let grain = false;

	/**
	 * How often the preview asks the simulation where it is.
	 *
	 * The animations run on the compositor from custom properties, so this only
	 * has to move those properties often enough to look continuous - not once
	 * per frame. Seven times a second is under the threshold where a changing
	 * rate reads as stepped, and a fraction of the cost of tracking the display.
	 */
	const TICK_MS = 140;

	let frame: PreviewFrame = previewFrame(0);
	let started = Date.now();
	let timer: ReturnType<typeof setInterval> | null = null;

	/** Nothing to animate means nothing to spend time on. */
	$: shouldRun = style !== 'off' || grain;

	const tick = () => {
		frame = previewFrame(Date.now() - started);
	};

	const start = () => {
		if (timer || !shouldRun) return;
		tick();
		timer = setInterval(tick, TICK_MS);
	};

	const stop = () => {
		if (!timer) return;
		clearInterval(timer);
		timer = null;
	};

	$: if (shouldRun) start();
	else stop();

	// A settings page left open in a background tab should cost nothing.
	const onVisibility = () => (document.hidden ? stop() : start());

	onMount(() => {
		started = Date.now();
		start();
		document.addEventListener('visibilitychange', onVisibility);
	});

	onDestroy(() => {
		stop();
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', onVisibility);
		}
	});

	const STYLE_LABELS: Record<GlowStyle, string> = {
		off: 'Off',
		sweep: 'Sweep',
		pulse: 'Pulse',
		aurora: 'Aurora',
		nebula: 'Nebula',
		ripple: 'Ripple',
		meter: 'Meter'
	};

	/** A still hint of each style's character. Painted, never animated. */
	const SWATCHES: Record<GlowStyle, string> = {
		off: 'linear-gradient(135deg, rgb(148 148 158 / 0.25), rgb(148 148 158 / 0.1))',
		sweep:
			'conic-gradient(from 200deg, transparent, var(--sw-a) 90deg, var(--sw-b) 150deg, transparent 220deg)',
		pulse: 'linear-gradient(90deg, var(--sw-a), var(--sw-b), var(--sw-a))',
		aurora:
			'radial-gradient(circle at 25% 30%, var(--sw-a), transparent 60%), radial-gradient(circle at 75% 70%, var(--sw-b), transparent 60%)',
		nebula:
			'radial-gradient(circle at 30% 65%, var(--sw-b), transparent 55%), radial-gradient(circle at 70% 30%, var(--sw-a), transparent 55%)',
		ripple: 'repeating-radial-gradient(circle at 50% 50%, var(--sw-a) 0 2px, transparent 2px 7px)',
		meter: 'repeating-linear-gradient(90deg, var(--sw-a) 0 2px, transparent 2px 5px)'
	};

	$: swatchVars = `--sw-a: hsl(${hue ?? 250} 90% 62%); --sw-b: hsl(${(hue ?? 250) + 70} 92% 66%)`;

	/** What the simulation is doing, said plainly beside the picture. */
	$: phaseLine =
		frame.phase === 'reading'
			? $i18n.t('Reading the prompt: {{percent}}%', {
					percent: Math.round(frame.prefill?.percent ?? 0)
				})
			: frame.phase === 'writing'
				? $i18n.t('Answering: {{rate}} tokens/s', { rate: frame.tokensPerSecond ?? 0 })
				: $i18n.t('Finished');

	const chooseStyle = (next: GlowStyle) => {
		style = next;
		saveSettings({ generationGlow: next });
	};

	// Taken from the page this lives in rather than invented again: a panel that
	// styles itself is a panel that looks bolted on.
	const settingRowClass = 'flex items-center justify-between gap-2.5';
	const settingLabelClass = 'min-w-0 text-xs text-gray-600 dark:text-gray-400';
	const settingControlClass = 'flex shrink-0 items-center justify-end gap-1.5';
	const actionButtonClass =
		'text-xs text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-500 dark:hover:text-white';
</script>

<div class="flex flex-col gap-2.5">
	<!--
		The real component, on real numbers from a simulated run. Anything else
		here would be a drawing of the feature rather than the feature, and the
		two would drift apart the first time either changed.

		Held off the sides on purpose. This pane scrolls, and a box that scrolls
		in one axis clips in the other, so a preview sitting flush against its
		edge would have the outer glow cut off left and right - showing something
		the chat does not do, in the one place meant to show what the chat does.
	-->
	<div class="px-6">
		<div
			class="relative flex w-full flex-col rounded-3xl border border-gray-100/30 bg-white/5 px-0.5 shadow-lg backdrop-blur-sm dark:border-gray-850/30 dark:bg-gray-500/5"
		>
			<GenerationGlow
				active={true}
				tokensPerSecond={frame.tokensPerSecond}
				prefilling={frame.prefilling}
				prefill={frame.prefill}
				tokens={frame.tokens}
				{style}
				{speed}
				{intensity}
				{spill}
				{hue}
				{grain}
			/>

			<!--
				The chat's own shape, not a rectangle standing in for it. The frame
				is drawn around whatever it contains, and a single line of text is
				not the height or the weight of the real thing — the light would sit
				differently around it and the preview would be quietly wrong.

				Inert on purpose: nothing here is a control, so none of it is a
				button and none of it takes focus. What it has to do is take up the
				same room.
			-->
			<div class="relative z-10 flex flex-col gap-1 px-3.5 pt-3 pb-2" aria-hidden="true">
				<div class="truncate text-sm text-gray-400 dark:text-gray-500">
					{$i18n.t('Send a Message')}
				</div>

				<div class="flex items-center justify-between gap-2">
					<div class="flex shrink-0 items-center gap-0.5 text-gray-500 dark:text-gray-400">
						<div class="p-1"><PlusAlt className="size-[1.125rem]" /></div>
						<div class="p-1"><Sparkles className="size-[1.125rem]" /></div>
						<div class="p-1"><Voice className="size-[1.125rem]" /></div>
						<div class="p-1"><LightBulb className="size-[1.125rem]" /></div>
					</div>

					<div class="flex min-w-0 items-center gap-1.5">
						<span
							class="truncate font-mono text-[0.625rem] tracking-tight text-gray-400 tabular-nums dark:text-gray-500"
						>
							{phaseLine}
						</span>
						<ChevronDown className="size-2.5 shrink-0 text-gray-400 dark:text-gray-500" />
						<div class="p-1 text-gray-500 dark:text-gray-400">
							<Mic className="size-[1.125rem]" />
						</div>
						<div
							class="flex size-7 shrink-0 items-center justify-center rounded-full bg-black text-white dark:bg-white dark:text-black"
						>
							<Voice className="size-4" />
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Styles as a row of chips: the whole set visible at once, one click apart. -->
	<div class="flex flex-wrap gap-1.5" style={swatchVars}>
		{#each GLOW_STYLES as option (option)}
			<button
				type="button"
				aria-pressed={style === option}
				class="group flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-xs transition {style ===
				option
					? 'bg-gray-900 text-white dark:bg-white dark:text-black'
					: 'bg-gray-100/70 text-gray-600 hover:bg-gray-200/70 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]'}"
				on:click={() => chooseStyle(option)}
			>
				<span
					class="size-4 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
					style="background: {SWATCHES[option]}"
				></span>
				{$i18n.t(STYLE_LABELS[option])}
			</button>
		{/each}
	</div>

	{#if style !== 'off' || grain}
		<div class="flex flex-col gap-2.5">
			<div>
				<div class={settingRowClass}>
					<label class={settingLabelClass} for="glow-speed">{$i18n.t('Animation Speed')}</label>
					<div class={settingControlClass}>
						<span class={actionButtonClass}>{speed}x</span>
					</div>
				</div>
				<div class="flex items-center px-1 pt-1">
					<input
						id="glow-speed"
						class="w-full"
						type="range"
						min="0.25"
						max="3"
						step="0.05"
						bind:value={speed}
						on:change={() => saveSettings({ generationGlowSpeed: speed })}
					/>
				</div>
			</div>

			<div>
				<div class={settingRowClass}>
					<label class={settingLabelClass} for="glow-intensity">
						{$i18n.t('Animation Intensity')}
					</label>
					<div class={settingControlClass}>
						<span class={actionButtonClass}>{intensity}</span>
					</div>
				</div>
				<div class="flex items-center px-1 pt-1">
					<input
						id="glow-intensity"
						class="w-full"
						type="range"
						min="0"
						max="2"
						step="0.05"
						bind:value={intensity}
						on:change={() => saveSettings({ generationGlowIntensity: intensity })}
					/>
				</div>
			</div>

			<div>
				<div class={settingRowClass}>
					<label class={settingLabelClass} for="glow-spill">{$i18n.t('Outer Glow')}</label>
					<div class={settingControlClass}>
						<span class={actionButtonClass}>{spill === 0 ? $i18n.t('Off') : spill}</span>
					</div>
				</div>
				<div class="flex items-center px-1 pt-1">
					<input
						id="glow-spill"
						class="w-full"
						type="range"
						min="0"
						max="2"
						step="0.05"
						bind:value={spill}
						on:change={() => saveSettings({ generationGlowSpill: spill })}
					/>
				</div>
			</div>

			<div>
				<div class={settingRowClass}>
					<label class={settingLabelClass} for="glow-hue">{$i18n.t('Animation Colour')}</label>
					<div class={settingControlClass}>
						<!--
							Unset is not a reset: following the theme is a choice, and the
							button says which of the two is in force.
						-->
						<button
							type="button"
							class={actionButtonClass}
							aria-pressed={hue === null}
							on:click={() => {
								hue = null;
								saveSettings({ generationGlowHue: null });
							}}
						>
							{hue === null ? $i18n.t('Auto') : `${hue}°`}
						</button>
					</div>
				</div>
				<div class="flex items-center px-1 pt-1">
					<!-- The track is the choice: a grey slider for a colour is a riddle. -->
					<input
						id="glow-hue"
						class="glow-hue-track w-full"
						type="range"
						min="0"
						max="360"
						step="1"
						value={hue ?? 250}
						on:input={(event) => (hue = Number(event.currentTarget.value))}
						on:change={() => saveSettings({ generationGlowHue: hue })}
					/>
				</div>
			</div>

			<div class={settingRowClass}>
				<div id="glow-grain-label" class={settingLabelClass}>{$i18n.t('Film Grain')}</div>
				<div class={settingControlClass}>
					<Switch
						ariaLabelledbyId="glow-grain-label"
						tooltip={true}
						bind:state={grain}
						on:change={() => saveSettings({ generationGlowGrain: grain })}
					/>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/*
	 * The hue slider carries the hues it selects from. Both engines need their
	 * own selector for the track, and neither accepts the other's.
	 */
	.glow-hue-track {
		appearance: none;
		-webkit-appearance: none;
		height: 6px;
		border-radius: 999px;
		background: linear-gradient(
			90deg,
			hsl(0 90% 62%),
			hsl(60 90% 62%),
			hsl(120 90% 62%),
			hsl(180 90% 62%),
			hsl(240 90% 62%),
			hsl(300 90% 62%),
			hsl(360 90% 62%)
		);
	}

	.glow-hue-track::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		border: 2px solid rgb(0 0 0 / 0.25);
		cursor: pointer;
	}

	.glow-hue-track::-moz-range-thumb {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: #fff;
		border: 2px solid rgb(0 0 0 / 0.25);
		cursor: pointer;
	}
</style>
