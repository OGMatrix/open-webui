<script lang="ts">
	import { getContext } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import type { ComponentType } from 'svelte';

	import Tooltip from '$lib/components/common/Tooltip.svelte';

	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import CursorArrowRays from '$lib/components/icons/CursorArrowRays.svelte';
	import Terminal from '$lib/components/icons/Terminal.svelte';
	import Folder from '$lib/components/icons/Folder.svelte';
	import CodeBracket from '$lib/components/icons/CodeBracket.svelte';
	import Eye from '$lib/components/icons/Eye.svelte';
	import Play from '$lib/components/icons/Play.svelte';
	import Photo from '$lib/components/icons/Photo.svelte';
	import Camera from '$lib/components/icons/Camera.svelte';
	import Hashtag from '$lib/components/icons/Hashtag.svelte';
	import SoundHigh from '$lib/components/icons/SoundHigh.svelte';
	import Mic from '$lib/components/icons/Mic.svelte';
	import Cube from '$lib/components/icons/Cube.svelte';
	import TaskList from '$lib/components/icons/TaskList.svelte';
	import Database from '$lib/components/icons/Database.svelte';
	import Component from '$lib/components/icons/Component.svelte';
	import Search from '$lib/components/icons/Search.svelte';
	import QuestionMarkCircle from '$lib/components/icons/QuestionMarkCircle.svelte';
	import UserGroup from '$lib/components/icons/UserGroup.svelte';
	import ClockRotateRight from '$lib/components/icons/ClockRotateRight.svelte';
	import Home from '$lib/components/icons/Home.svelte';
	import Headphone from '$lib/components/icons/Headphone.svelte';
	import ChatBubbles from '$lib/components/icons/ChatBubbles.svelte';
	import UserBadgeCheck from '$lib/components/icons/UserBadgeCheck.svelte';
	import Sparkles from '$lib/components/icons/Sparkles.svelte';
	import Computer from '$lib/components/icons/Computer.svelte';
	import Link from '$lib/components/icons/Link.svelte';
	import Wrench from '$lib/components/icons/Wrench.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	type Toolset = {
		name: string;
		label: string;
		description?: string;
		enabled: boolean;
		configured: boolean;
		tool_count: number;
	};

	export let toolsets: Toolset[] = [];
	export let version = '';
	export let model = '';

	/**
	 * A drawn icon per toolset, keyed by the server's own stable name.
	 *
	 * Hermes labels its toolsets with emoji, which render as somebody else's
	 * typeface at somebody else's weight and sit badly beside the rest of the
	 * interface. The names are stable, so the picture is chosen here from the
	 * same icon set everything else uses.
	 */
	const ICONS: Record<string, ComponentType> = {
		web: GlobeAlt,
		browser: CursorArrowRays,
		terminal: Terminal,
		file: Folder,
		code_execution: CodeBracket,
		vision: Eye,
		video: Play,
		image_gen: Photo,
		video_gen: Camera,
		x_search: Hashtag,
		tts: SoundHigh,
		stt: Mic,
		skills: Cube,
		todo: TaskList,
		memory: Database,
		context_engine: Component,
		session_search: Search,
		clarify: QuestionMarkCircle,
		delegation: UserGroup,
		cronjob: ClockRotateRight,
		homeassistant: Home,
		spotify: Headphone,
		discord: ChatBubbles,
		discord_admin: UserBadgeCheck,
		yuanbao: Sparkles,
		computer_use: Computer,
		a2a: Link
	};

	/** A toolset this build has never heard of still gets a shape, not a gap. */
	const iconFor = (name: string) => ICONS[name] ?? Wrench;

	$: active = toolsets.filter((toolset) => toolset.enabled);
	$: inactive = toolsets.filter((toolset) => !toolset.enabled);

	/** Why a toolset is off: switched off, or never set up over there. */
	const reasonFor = (toolset: Toolset) =>
		toolset.configured
			? $i18n.t('Switched off on the server')
			: $i18n.t('Not set up on the server');
</script>

{#if toolsets.length > 0}
	<div class="mt-2 rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-white/[0.03]">
		<div class="mb-2 flex items-baseline justify-between gap-2">
			<div class="text-xs font-medium text-gray-700 dark:text-gray-200">
				{$i18n.t('Hermes Agent')}
				{#if version}
					<span class="font-normal text-gray-400 dark:text-gray-500">{version}</span>
				{/if}
			</div>
			<div class="shrink-0 text-[0.6875rem] text-gray-500 dark:text-gray-400">
				{$i18n.t('{{active}} of {{total}} toolsets active', {
					active: active.length,
					total: toolsets.length
				})}
			</div>
		</div>

		{#if model}
			<div class="mb-2 text-[0.6875rem] text-gray-500 dark:text-gray-400">
				{$i18n.t('Agent model')}: <span class="font-mono">{model}</span>
			</div>
		{/if}

		<!-- Tools run on the Hermes host, so this is what it brings, not what is
		     configured here. Active first: that is the answer to "what can it do". -->
		<div class="grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2">
			{#each [...active, ...inactive] as toolset (toolset.name)}
				{@const Icon = iconFor(toolset.name)}
				<Tooltip
					content={toolset.enabled ? (toolset.description ?? '') : reasonFor(toolset)}
					placement="top-start"
					className="min-w-0"
				>
					<div
						class="flex min-w-0 items-center gap-2 py-1 text-xs {toolset.enabled
							? 'text-gray-800 dark:text-gray-100'
							: 'text-gray-400 dark:text-gray-600'}"
					>
						<div class="shrink-0">
							<Icon className="size-3.5" strokeWidth="1.75" />
						</div>
						<span class="min-w-0 truncate">{toolset.label}</span>
						{#if toolset.enabled && toolset.tool_count > 0}
							<span class="shrink-0 tabular-nums text-gray-400 dark:text-gray-500">
								{toolset.tool_count}
							</span>
						{/if}
					</div>
				</Tooltip>
			{/each}
		</div>
	</div>
{/if}
