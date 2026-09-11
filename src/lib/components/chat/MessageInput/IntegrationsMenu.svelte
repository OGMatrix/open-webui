<script lang="ts">
	import { resolveLocalizedResource, resolveLocalizedFunction } from '$lib/utils/localizedContent';
	import { functions as localizedFunctions } from '$lib/stores';
	import { getContext, onDestroy, tick } from 'svelte';
	import { fly } from 'svelte/transition';

	import { settings, user, tools as _tools, skills as _skills, toolServers } from '$lib/stores';

	import { deleteOAuthSession } from '$lib/apis/auths';
	import { updateUserSettings } from '$lib/apis/users';
	import {
		readUserDefault,
		sameSelection,
		type ComposerSelection
	} from '$lib/utils/composerSelection';
	import {
		MAX_PRESETS,
		MAX_PRESET_NAME,
		addPreset,
		activePreset,
		readPresets,
		removePreset,
		renamePreset,
		presetName,
		replacePreset,
		summarize,
		type PresetError,
		type SelectionPreset
	} from '$lib/utils/selectionPresets';
	import { getTools } from '$lib/apis/tools';
	import { getSkills } from '$lib/apis/skills';

	import { toast } from 'svelte-sonner';

	import Knobs from '$lib/components/icons/Knobs.svelte';
	import Dropdown from '$lib/components/common/Dropdown.svelte';
	import DropdownMenu from '$lib/components/common/DropdownMenu.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Switch from '$lib/components/common/Switch.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import SearchInput from './InputMenu/SearchInput.svelte';
	import Wrench from '$lib/components/icons/Wrench.svelte';
	import Cube from '$lib/components/icons/Cube.svelte';
	import Sparkles from '$lib/components/icons/Sparkles.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import Photo from '$lib/components/icons/Photo.svelte';
	import Terminal from '$lib/components/icons/Terminal.svelte';
	import ChevronRight from '$lib/components/icons/ChevronRight.svelte';
	import ChevronLeft from '$lib/components/icons/ChevronLeft.svelte';
	import LinkSlash from '$lib/components/icons/LinkSlash.svelte';
	import Bookmark from '$lib/components/icons/Bookmark.svelte';
	import Bolt from '$lib/components/icons/Bolt.svelte';
	import InfoCircle from '$lib/components/icons/InfoCircle.svelte';
	import Check from '$lib/components/icons/Check.svelte';
	import Pencil from '$lib/components/icons/Pencil.svelte';
	import GarbageBin from '$lib/components/icons/GarbageBin.svelte';
	import ArrowPath from '$lib/components/icons/ArrowPath.svelte';

	const i18n = getContext('i18n') as any;

	type IntegrationItem = {
		id: string;
		name: string;
		description?: string;
		meta?: { description?: string };
		is_active?: boolean;
		authenticated?: boolean;
		has_user_valves?: boolean;
		[key: string]: any;
	};

	export let selectedToolIds: string[] = [];
	export let selectedSkillIds: string[] = [];

	export let selectedModels: string[] = [];
	export let fileUploadCapableModels: string[] = [];
	export let oauthRedirectHandler: Function = () => {};

	export let toggleFilters: {
		id: string;
		name: string;
		description?: string;
		icon?: string;
		has_user_valves?: boolean;
	}[] = [];
	export let selectedFilterIds: string[] = [];

	export let showWebSearchButton = false;
	export let webSearchEnabled = false;
	export let showImageGenerationButton = false;
	export let imageGenerationEnabled = false;
	export let showCodeInterpreterButton = false;
	export let codeInterpreterEnabled = false;

	export let onShowValves: Function;
	export let onClose: Function;
	/**
	 * Open the details of the tools or skills in use -- which functions each
	 * tool provides, which server it comes from.
	 *
	 * That used to be what clicking the tool count in the composer did. The count
	 * moved into this menu's button, so the way to the details moved in here too,
	 * beside the list it describes.
	 */
	export let onShowDetails: (kind: 'tools' | 'skills') => void = () => {};

	/**
	 * What the button says about itself, to a screen reader and in its tooltip.
	 *
	 * The button shows a bare number; this is where the number gets its nouns.
	 * Handed to the button through the slot, so the two can never disagree.
	 */
	let triggerLabel = '';
	$: {
		const activeSummary = [
			(selectedToolIds ?? []).length > 0
				? $i18n.t('{{count}} tools', { count: (selectedToolIds ?? []).length })
				: null,
			(selectedSkillIds ?? []).length > 0
				? $i18n.t('{{count}} skills', { count: (selectedSkillIds ?? []).length })
				: null
		]
			.filter(Boolean)
			.join(' \u00b7 ');

		triggerLabel = activeSummary
			? `${$i18n.t('Integrations')} \u00b7 ${activeSummary}`
			: $i18n.t('Integrations');
	}
	export let onWebSearchToggle: Function = () => {};
	export let closeOnOutsideClick = true;

	let show = false;
	/**
	 * For closing the menu from inside it the way the sidebar's chat menu does:
	 * through the dropdown's own close(), which also runs its close handling --
	 * clearing the searches and handing focus back -- where assigning `show`
	 * from here would skip it.
	 */
	let dropdown: Dropdown;

	/**
	 * Open a details dialog once the menu is out of the way.
	 *
	 * Closing hands focus back to the prompt a tick later; the dialog opens after
	 * that, so focus ends up in the dialog rather than behind it.
	 */
	const showDetails = async (kind: 'tools' | 'skills') => {
		dropdown?.close();
		await tick();
		await tick();
		onShowDetails(kind);
	};
	let tab = '';

	let tools: Record<string, IntegrationItem> | null = null;
	let skills: Record<string, IntegrationItem> | null = null;
	let toolQuery = '';
	let skillQuery = '';
	let searchedToolQuery = '';
	let searchedSkillQuery = '';
	let toolSearchDebounceTimer: ReturnType<typeof setTimeout>;
	let skillSearchDebounceTimer: ReturnType<typeof setTimeout>;
	let toolRequestId = 0;
	let skillRequestId = 0;

	$: toolIds = Object.keys(tools ?? {});
	$: skillIds = Object.keys(skills ?? {});

	$: if (show && toolQuery !== searchedToolQuery) {
		scheduleToolSearch();
	}

	$: if (show && skillQuery !== searchedSkillQuery) {
		scheduleSkillSearch();
	}

	$: if (show) {
		init();
	}

	/**
	 * What new conversations start with.
	 *
	 * A conversation remembers what it was using, so this is only about the empty
	 * one you have not started yet. Without it the only answer to "always give me
	 * these two tools" was to edit the model, which changes them for everyone.
	 */
	$: currentSelection = {
		toolIds: selectedToolIds ?? [],
		skillIds: selectedSkillIds ?? [],
		filterIds: selectedFilterIds ?? [],
		webSearch: webSearchEnabled === true,
		imageGeneration: imageGenerationEnabled === true,
		codeInterpreter: codeInterpreterEnabled === true
	} satisfies ComposerSelection;

	$: savedDefault = readUserDefault($settings);
	$: isDefault = savedDefault !== null && sameSelection(currentSelection, savedDefault);

	/**
	 * Change the reader's settings and put them on the server.
	 *
	 * The store is set first so the menu answers immediately; a failed write is
	 * reported rather than left to look like it worked.
	 */
	const saveSettings = async (
		change: (settings: Record<string, any>) => void
	): Promise<boolean> => {
		const updated = { ...$settings };
		change(updated);
		settings.set(updated);

		const res = await updateUserSettings(localStorage.token, { ui: updated }).catch((error) => {
			console.error('[composer settings]', error);
			return null;
		});
		return Boolean(res);
	};

	let savingDefault = false;
	const setAsDefault = async (state: boolean) => {
		if (savingDefault) return;
		savingDefault = true;

		// An empty default is a real answer -- "start me with nothing on" -- and it
		// has to be stored, not left absent, or the model's list comes back.
		const saved = await saveSettings((updated) => {
			if (state) {
				updated.defaultSelection = currentSelection;
			} else {
				delete updated.defaultSelection;
				// The older bare list of tool ids would otherwise take over again.
				delete updated.tools;
			}
		});
		savingDefault = false;

		if (!saved) {
			toast.error($i18n.t('Could not save your default'));
			return;
		}

		toast.success(
			state
				? $i18n.t('New chats will start with this')
				: $i18n.t('New chats follow the model again')
		);
	};

	/**
	 * Named selections, and the ways they change.
	 *
	 * Editing is a mode rather than three icons per row: at this width a row that
	 * carries apply, rename, overwrite and delete at once is a row nobody can hit
	 * on a phone.
	 */
	$: presets = readPresets($settings);
	$: currentPreset = activePreset(presets, currentSelection);

	let editingPresets = false;
	let newPresetName = '';
	let renameDrafts: Record<string, string> = {};
	let savingPresets = false;

	const presetErrorText = (error: PresetError): string =>
		({
			'empty-name': $i18n.t('Give the preset a name'),
			'duplicate-name': $i18n.t('A preset with that name already exists'),
			'too-many': $i18n.t('You can keep up to {{count}} presets', { count: MAX_PRESETS })
		})[error];

	/**
	 * Change the presets, one change at a time.
	 *
	 * Each change is worked out from the list as it stands when its turn comes,
	 * not from the list as it stood when the reader clicked. Renaming, replacing
	 * and deleting in quick succession would otherwise have the last of them
	 * write back a list read before the first had landed -- and a change that
	 * arrived while another was in flight used to be dropped without a word.
	 */
	let pending: Promise<void> = Promise.resolve();

	const editPresets = (
		change: (current: SelectionPreset[]) => { presets: SelectionPreset[]; error?: PresetError },
		message: (presets: SelectionPreset[]) => string
	): Promise<void> => {
		savingPresets = true;
		pending = pending
			.then(async () => {
				const { presets: next, error } = change(readPresets($settings));
				if (error) {
					toast.error(presetErrorText(error));
					return;
				}

				const saved = await saveSettings((updated) => {
					updated.selectionPresets = next;
				});
				if (saved) {
					toast.success(message(next));
				} else {
					toast.error($i18n.t('Could not save your presets'));
				}
			})
			.finally(() => {
				savingPresets = false;
			});

		return pending;
	};

	const createPreset = async () => {
		const name = presetName(newPresetName);
		if (name === '') {
			toast.error(presetErrorText('empty-name'));
			return;
		}

		newPresetName = '';
		await editPresets(
			(current) => addPreset(current, name, currentSelection),
			() => $i18n.t('Preset "{{name}}" saved', { name })
		);
	};

	const applyPreset = (preset: SelectionPreset) => {
		selectedToolIds = [...preset.selection.toolIds];
		selectedSkillIds = [...preset.selection.skillIds];
		selectedFilterIds = [...preset.selection.filterIds];
		webSearchEnabled = preset.selection.webSearch;
		imageGenerationEnabled = preset.selection.imageGeneration;
		codeInterpreterEnabled = preset.selection.codeInterpreter;
		onWebSearchToggle(webSearchEnabled);
	};

	const overwritePreset = (preset: SelectionPreset) =>
		editPresets(
			(current) => ({ presets: replacePreset(current, preset.id, currentSelection) }),
			() => $i18n.t('Preset "{{name}}" now holds what is switched on', { name: preset.name })
		);

	const commitRename = (preset: SelectionPreset) => {
		const draft = presetName(renameDrafts[preset.id] ?? preset.name);
		if (draft === preset.name) return Promise.resolve();

		// Put the old name back if the new one is refused, so the field never
		// shows a name the list does not have.
		return editPresets(
			(current) => {
				const result = renamePreset(current, preset.id, draft);
				if (result.error) {
					renameDrafts = { ...renameDrafts, [preset.id]: preset.name };
				}
				return result;
			},
			() => $i18n.t('Preset renamed')
		);
	};

	const deletePreset = (preset: SelectionPreset) =>
		editPresets(
			(current) => ({ presets: removePreset(current, preset.id) }),
			() => $i18n.t('Preset "{{name}}" deleted', { name: preset.name })
		);

	/** What a preset holds, as one line under its name. */
	const presetSummary = (preset: SelectionPreset): string => {
		const counts = summarize(preset.selection);
		if (counts.empty) return $i18n.t('Nothing switched on');

		const parts: string[] = [];
		if (counts.tools > 0) parts.push($i18n.t('{{count}} tools', { count: counts.tools }));
		if (counts.skills > 0) parts.push($i18n.t('{{count}} skills', { count: counts.skills }));
		if (counts.filters > 0) parts.push($i18n.t('{{count}} filters', { count: counts.filters }));
		if (counts.modes > 0) parts.push($i18n.t('{{count}} modes', { count: counts.modes }));
		return parts.join(' \u00b7 ');
	};

	/**
	 * Everything in the list at once.
	 *
	 * Acts on what is listed, so a search narrows what the button touches -- which
	 * is the useful reading when a search is what put those rows on screen.
	 * Integrations awaiting a sign-in are left out: switching one on by this route
	 * would not connect it.
	 */
	$: toggleableToolIds = Object.keys(tools ?? {}).filter(
		(id) => tools?.[id]?.authenticated ?? true
	);
	$: allToolsOn =
		toggleableToolIds.length > 0 && toggleableToolIds.every((id) => selectedToolIds.includes(id));

	const toggleAllTools = () => {
		selectedToolIds = allToolsOn
			? selectedToolIds.filter((id) => !toggleableToolIds.includes(id))
			: [...new Set([...selectedToolIds, ...toggleableToolIds])];
	};

	$: listedSkillIds = Object.keys(skills ?? {});
	$: allSkillsOn =
		listedSkillIds.length > 0 && listedSkillIds.every((id) => selectedSkillIds.includes(id));

	const toggleAllSkills = () => {
		selectedSkillIds = allSkillsOn
			? selectedSkillIds.filter((id) => !listedSkillIds.includes(id))
			: [...new Set([...selectedSkillIds, ...listedSkillIds])];
	};

	let fileUploadEnabled = true;
	$: fileUploadEnabled =
		fileUploadCapableModels.length === selectedModels.length &&
		($user?.role === 'admin' || $user?.permissions?.chat?.file_upload);

	const init = async () => {
		await Promise.all([loadTools(), loadSkills()]);
	};

	const setTools = (toolItems: IntegrationItem[] | null, query = '') => {
		const q = query.trim().toLowerCase();
		const items = (toolItems ?? [])
			.filter(
				(tool) =>
					!q ||
					`${tool.name} ${resolveLocalizedResource(tool, $i18n.language)} ${resolveLocalizedResource(tool, $i18n.language, 'description')}`
						.toLowerCase()
						.includes(q)
			)
			.reduce<Record<string, IntegrationItem>>((a, tool) => {
				a[tool.id] = {
					...tool,
					name: tool.name,
					description: tool.meta?.description
				};
				return a;
			}, {});

		for (const serverIdx in ($toolServers ?? []) as any[]) {
			const server = (($toolServers ?? []) as any[])[serverIdx];
			if (server.info) {
				const name = server?.info?.title ?? server.url;
				if (q && !name.toLowerCase().includes(q)) {
					continue;
				}

				items[`direct_server:${serverIdx}`] = {
					id: `direct_server:${serverIdx}`,
					name,
					description: server.info.description ?? ''
				};
			}
		}

		tools = items;

		if (!q) {
			selectedToolIds = selectedToolIds.filter((id) => Object.keys(tools ?? {}).includes(id));
		}
	};

	const setSkills = (skillItems: IntegrationItem[] | null, query = '') => {
		skills = (skillItems ?? [])
			.filter(
				(skill) =>
					skill.is_active &&
					(!query.trim() ||
						`${skill.name} ${resolveLocalizedResource(skill, $i18n.language)} ${resolveLocalizedResource(skill, $i18n.language, 'description')}`
							.toLowerCase()
							.includes(query.trim().toLowerCase()))
			)
			.reduce<Record<string, IntegrationItem>>((a, skill) => {
				a[skill.id] = {
					...skill,
					name: skill.name,
					description: skill.description
				};
				return a;
			}, {});

		if (!query.trim()) {
			selectedSkillIds = selectedSkillIds.filter((id) => Object.keys(skills ?? {}).includes(id));
		}
	};

	const loadTools = async (query = toolQuery) => {
		const requestId = ++toolRequestId;
		const q = query.trim();
		searchedToolQuery = query;

		if ($_tools === null) {
			await _tools.set(await getTools(localStorage.token));
		}
		if (requestId !== toolRequestId) return;
		setTools($_tools, q);
	};

	const loadSkills = async (query = skillQuery) => {
		const requestId = ++skillRequestId;
		const q = query.trim();
		searchedSkillQuery = query;

		if ($_skills === null) {
			await _skills.set(await getSkills(localStorage.token));
		}
		if (requestId !== skillRequestId) return;
		setSkills($_skills, q);
	};

	const scheduleToolSearch = () => {
		clearTimeout(toolSearchDebounceTimer);
		toolSearchDebounceTimer = setTimeout(() => {
			loadTools();
		}, 200);
	};

	const scheduleSkillSearch = () => {
		clearTimeout(skillSearchDebounceTimer);
		skillSearchDebounceTimer = setTimeout(() => {
			loadSkills();
		}, 200);
	};

	/**
	 * A row's own appearance carries whether it is on.
	 *
	 * Every entry here used to render identically, with the only difference a
	 * switch the width of a fingernail at the far right of the row. Telling at a
	 * glance which of a dozen tools were active meant reading the right edge,
	 * line by line.
	 */
	const rowClass = (on: boolean) =>
		`flex w-full justify-between gap-2 items-center h-[1.6875rem] px-2 text-[0.8125rem] font-normal cursor-pointer rounded-xl transition-colors ${
			on
				? 'bg-gray-100/80 text-gray-900 dark:bg-white/[0.07] dark:text-white'
				: 'text-gray-600 hover:bg-gray-50/40 dark:text-gray-300 dark:hover:bg-gray-800/40'
		}`;

	const toggleTool = async (toolId: string, e: MouseEvent) => {
		const tool = tools?.[toolId];
		if (!tool) return;

		if (!(tool.authenticated ?? true)) {
			e.preventDefault();

			const parts = toolId.split(':');
			oauthRedirectHandler({
				id: toolId,
				serverId: parts.at(-1) ?? toolId,
				authType: parts.length > 1 ? (parts[0] === 'server' ? parts[1] : parts[0]) : null
			});
			return;
		}

		const state = !selectedToolIds.includes(toolId);
		await tick();

		if (state) {
			selectedToolIds = [...selectedToolIds, toolId];
		} else {
			selectedToolIds = selectedToolIds.filter((id) => id !== toolId);
		}
	};

	const toggleSkill = async (skillId: string) => {
		const skill = skills?.[skillId];
		if (!skill) return;

		const state = !selectedSkillIds.includes(skillId);
		await tick();

		if (state) {
			selectedSkillIds = [...selectedSkillIds, skillId];
		} else {
			selectedSkillIds = selectedSkillIds.filter((id) => id !== skillId);
		}
	};

	onDestroy(() => {
		clearTimeout(toolSearchDebounceTimer);
		clearTimeout(skillSearchDebounceTimer);
	});
</script>

<Dropdown
	bind:this={dropdown}
	bind:show
	{closeOnOutsideClick}
	onOpenChange={(state) => {
		if (state === false) {
			toolQuery = '';
			skillQuery = '';
			onClose();
		}
	}}
>
	<Tooltip content={triggerLabel} placement="top">
		<slot {triggerLabel} />
	</Tooltip>
	<div slot="content">
		<DropdownMenu className="min-w-70 max-w-70 max-h-72 overflow-hidden">
			{#if tab === ''}
				<div
					class="max-h-64 overflow-y-auto overflow-x-hidden scrollbar-thin"
					in:fly={{ x: -20, duration: 150 }}
				>
					{#if tools}
						{#if Object.keys(tools).length > 0}
							<button
								class="flex w-full justify-between gap-2 items-center h-[1.6875rem] px-2 text-[0.8125rem] font-normal cursor-pointer rounded-xl hover:bg-gray-50/40 dark:hover:bg-gray-800/40"
								on:click={() => {
									tab = 'tools';
								}}
							>
								<Wrench />

								<div class="flex items-center w-full justify-between">
									<div class=" line-clamp-1">
										{$i18n.t('Tools')}
										<span class="ml-0.5 text-gray-500">{Object.keys(tools).length}</span>
									</div>

									<div class="text-gray-500">
										<ChevronRight />
									</div>
								</div>
							</button>
						{/if}

						{#if skills && Object.keys(skills).length > 0}
							<button
								class="flex w-full justify-between gap-2 items-center h-[1.6875rem] px-2 text-[0.8125rem] font-normal cursor-pointer rounded-xl hover:bg-gray-50/40 dark:hover:bg-gray-800/40"
								on:click={() => {
									tab = 'skills';
								}}
							>
								<Cube className="size-3.5" strokeWidth="1.75" />

								<div class="flex items-center w-full justify-between">
									<div class=" line-clamp-1">
										{$i18n.t('Skills')}
										<span class="ml-0.5 text-gray-500">{Object.keys(skills).length}</span>
									</div>

									<div class="text-gray-500">
										<ChevronRight />
									</div>
								</div>
							</button>
						{/if}
					{:else}
						<div class="py-4">
							<Spinner />
						</div>
					{/if}

					{#if toggleFilters && toggleFilters.length > 0}
						{#each toggleFilters.sort( (a, b) => a.name.localeCompare( b.name, undefined, { sensitivity: 'base' } ) ) as filter, filterIdx (filter.id)}
							<Tooltip
								content={resolveLocalizedFunction(
									filter,
									$localizedFunctions,
									$i18n.language,
									'description'
								)}
								placement="top-start"
							>
								<button
									class={rowClass(selectedFilterIds.includes(filter.id))}
									aria-pressed={selectedFilterIds.includes(filter.id)}
									on:click={() => {
										if (selectedFilterIds.includes(filter.id)) {
											selectedFilterIds = selectedFilterIds.filter((id) => id !== filter.id);
										} else {
											selectedFilterIds = [...selectedFilterIds, filter.id];
										}
									}}
								>
									<div class="flex-1 truncate">
										<div class="flex flex-1 items-center gap-2 overflow-hidden">
											<div class="shrink-0">
												{#if filter?.icon}
													<div class="size-3.5 items-center flex justify-center">
														<img
															src={filter.icon}
															class="size-3.5 {filter.icon.includes('data:image/svg')
																? 'dark:invert-[80%]'
																: ''}"
															style="fill: currentColor;"
															alt={resolveLocalizedFunction(
																filter,
																$localizedFunctions,
																$i18n.language
															)}
														/>
													</div>
												{:else}
													<Sparkles className="size-3.5" strokeWidth="1.75" />
												{/if}
											</div>

											<div class="min-w-0 truncate">
												{resolveLocalizedFunction(filter, $localizedFunctions, $i18n.language)}
											</div>
											{#if resolveLocalizedFunction(filter, $localizedFunctions, $i18n.language, 'description')}
												<div class="min-w-0 truncate text-gray-400 dark:text-gray-500">
													{resolveLocalizedFunction(
														filter,
														$localizedFunctions,
														$i18n.language,
														'description'
													)}
												</div>
											{/if}
										</div>
									</div>

									{#if filter?.has_user_valves && ($user?.role === 'admin' || ($user?.permissions?.chat?.valves ?? true))}
										<div class=" shrink-0">
											<Tooltip content={$i18n.t('Valves')}>
												<button
													class="self-center w-fit text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition rounded-full"
													type="button"
													on:click={(e) => {
														e.stopPropagation();
														e.preventDefault();
														onShowValves({
															type: 'function',
															id: filter.id
														});
													}}
												>
													<Knobs />
												</button>
											</Tooltip>
										</div>
									{/if}

									<div class=" shrink-0" inert>
										<Switch state={selectedFilterIds.includes(filter.id)} />
									</div>
								</button>
							</Tooltip>
						{/each}
					{/if}

					{#if showWebSearchButton}
						<Tooltip content={$i18n.t('Search the internet')} placement="top-start">
							<button
								class={rowClass(webSearchEnabled)}
								aria-pressed={webSearchEnabled}
								on:click={() => {
									webSearchEnabled = !webSearchEnabled;
									onWebSearchToggle(webSearchEnabled);
								}}
							>
								<div class="flex-1 truncate">
									<div class="flex flex-1 items-center gap-2 overflow-hidden">
										<div class="shrink-0">
											<GlobeAlt />
										</div>

										<div class="min-w-0 truncate">{$i18n.t('Web Search')}</div>
										<div class="min-w-0 truncate text-gray-400 dark:text-gray-500">
											{$i18n.t('Search the internet')}
										</div>
									</div>
								</div>

								<div class=" shrink-0" inert>
									<Switch state={webSearchEnabled} />
								</div>
							</button>
						</Tooltip>
					{/if}

					{#if showImageGenerationButton}
						<Tooltip content={$i18n.t('Generate an image')} placement="top-start">
							<button
								class={rowClass(imageGenerationEnabled)}
								aria-pressed={imageGenerationEnabled}
								on:click={() => {
									imageGenerationEnabled = !imageGenerationEnabled;
								}}
							>
								<div class="flex-1 truncate">
									<div class="flex flex-1 items-center gap-2 overflow-hidden">
										<div class="shrink-0">
											<Photo className="size-3.5" strokeWidth="1.5" />
										</div>

										<div class="min-w-0 truncate">{$i18n.t('Image')}</div>
										<div class="min-w-0 truncate text-gray-400 dark:text-gray-500">
											{$i18n.t('Generate an image')}
										</div>
									</div>
								</div>

								<div class=" shrink-0" inert>
									<Switch state={imageGenerationEnabled} />
								</div>
							</button>
						</Tooltip>
					{/if}

					{#if showCodeInterpreterButton}
						<Tooltip content={$i18n.t('Execute code for analysis')} placement="top-start">
							<button
								class={rowClass(codeInterpreterEnabled)}
								aria-pressed={codeInterpreterEnabled}
								on:click={() => {
									codeInterpreterEnabled = !codeInterpreterEnabled;
								}}
							>
								<div class="flex-1 truncate">
									<div class="flex flex-1 items-center gap-2 overflow-hidden">
										<div class="shrink-0">
											<Terminal className="size-3.5" strokeWidth="1.75" />
										</div>

										<div class="min-w-0 truncate">{$i18n.t('Code Interpreter')}</div>
										<div class="min-w-0 truncate text-gray-400 dark:text-gray-500">
											{$i18n.t('Execute code for analysis')}
										</div>
									</div>
								</div>

								<div class=" shrink-0" inert>
									<Switch state={codeInterpreterEnabled} />
								</div>
							</button>
						</Tooltip>
					{/if}
				</div>

				<div class="mt-1 pt-1 border-t border-gray-100 dark:border-gray-850">
					<Tooltip
						content={isDefault
							? $i18n.t('Turn this off to let new chats follow the model again.')
							: $i18n.t(
									'Every new chat starts with exactly this. Chats you have already started keep what they were using.'
								)}
						placement="top-start"
					>
						<button
							class={rowClass(isDefault)}
							aria-pressed={isDefault}
							disabled={savingDefault}
							on:click={() => setAsDefault(!isDefault)}
						>
							<div class="flex-1 truncate">
								<div class="flex flex-1 items-center gap-2 overflow-hidden">
									<div class="shrink-0">
										<Bookmark className="size-3.5" strokeWidth="1.75" />
									</div>

									<div class="min-w-0 truncate">{$i18n.t('Start new chats with this')}</div>
								</div>
							</div>

							<div class=" shrink-0" inert>
								<Switch state={isDefault} />
							</div>
						</button>
					</Tooltip>

					<Tooltip
						content={$i18n.t('Keep a combination under a name and put it back on in one click.')}
						placement="top-start"
					>
						<button
							class={rowClass(false)}
							on:click={() => {
								tab = 'presets';
							}}
						>
							<div class="flex-1 truncate">
								<div class="flex flex-1 items-center gap-2 overflow-hidden">
									<div class="shrink-0">
										<Bolt className="size-3.5" strokeWidth="1.75" />
									</div>

									<div class="min-w-0 truncate">
										{presets.length > 0 ? $i18n.t('Presets') : $i18n.t('Save as preset')}
									</div>

									{#if currentPreset}
										<div class="min-w-0 truncate text-gray-400 dark:text-gray-500">
											{currentPreset.name}
										</div>
									{:else if presets.length > 0}
										<div class="shrink-0 text-gray-400 dark:text-gray-500">{presets.length}</div>
									{/if}
								</div>
							</div>

							<div class="shrink-0 text-gray-500">
								<ChevronRight />
							</div>
						</button>
					</Tooltip>
				</div>
			{:else if tab === 'tools' && tools}
				<div class="flex max-h-72 min-h-0 flex-col gap-0.5" in:fly={{ x: 20, duration: 150 }}>
					<div class="flex w-full items-center gap-1">
						<button
							class="flex flex-1 min-w-0 gap-2 items-center h-[1.6875rem] px-2 text-[0.8125rem] font-normal cursor-pointer rounded-xl hover:bg-gray-50/40 dark:hover:bg-gray-800/40"
							on:click={() => {
								toolQuery = '';
								tab = '';
							}}
						>
							<ChevronLeft />

							<div class="min-w-0 truncate">
								{$i18n.t('Tools')}
								<span class="ml-0.5 text-gray-500">{toolIds.length}</span>
							</div>
						</button>

						{#if (selectedToolIds ?? []).length > 0}
							<Tooltip content={$i18n.t('Details of the tools in use')} placement="top-end">
								<button
									class="shrink-0 flex h-[1.6875rem] w-[1.6875rem] items-center justify-center rounded-xl text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50/40 dark:hover:bg-gray-800/40"
									aria-label={$i18n.t('Details of the tools in use')}
									on:click={() => showDetails('tools')}
								>
									<InfoCircle className="size-3.5" strokeWidth="1.75" />
								</button>
							</Tooltip>
						{/if}

						<Tooltip
							content={allToolsOn
								? $i18n.t('Switch off every tool in this list')
								: $i18n.t('Switch on every tool in this list')}
							placement="top-end"
						>
							<button
								class="shrink-0 h-[1.6875rem] px-2 text-[0.75rem] rounded-xl whitespace-nowrap text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50/40 dark:hover:bg-gray-800/40 disabled:opacity-40"
								disabled={toggleableToolIds.length === 0}
								on:click={toggleAllTools}
							>
								{allToolsOn ? $i18n.t('None') : $i18n.t('All')}
							</button>
						</Tooltip>
					</div>

					<SearchInput bind:value={toolQuery} placeholder={$i18n.t('Search tools')} />

					<div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
						{#if toolIds.length === 0}
							<div class="text-center text-xs text-gray-500 py-3">{$i18n.t('No tools found')}</div>
						{:else}
							<div class="flex flex-col gap-0.5">
								{#each toolIds as toolId}
									<button
										class="relative {rowClass(selectedToolIds.includes(toolId))}"
										aria-pressed={(tools?.[toolId]?.authenticated ?? true)
											? selectedToolIds.includes(toolId)
											: undefined}
										on:click={async (e) => {
											await toggleTool(toolId, e);
										}}
									>
										{#if !(tools?.[toolId]?.authenticated ?? true)}
											<!-- make it slighly darker and not clickable -->
											<div class="absolute inset-0 opacity-50 rounded-xl cursor-pointer z-10"></div>
										{/if}
										<div class="flex-1 truncate">
											<div class="flex flex-1 items-center gap-2 overflow-hidden">
												<Tooltip
													content={resolveLocalizedResource(
														tools?.[toolId],
														$i18n.language,
														'name'
													)}
													placement="top"
												>
													<div class="shrink-0">
														<Wrench />
													</div>
												</Tooltip>
												<Tooltip
													content={resolveLocalizedResource(
														tools?.[toolId],
														$i18n.language,
														'description'
													)}
													placement="top-start"
												>
													<div class="min-w-0 truncate">
														{resolveLocalizedResource(tools?.[toolId], $i18n.language, 'name')}
													</div>
													{#if resolveLocalizedResource(tools?.[toolId], $i18n.language, 'description')}
														<div class="min-w-0 truncate text-gray-400 dark:text-gray-500">
															{resolveLocalizedResource(
																tools?.[toolId],
																$i18n.language,
																'description'
															)}
														</div>
													{/if}
												</Tooltip>
											</div>
										</div>

										{#if tools?.[toolId]?.authenticated === true && toolId.startsWith('server:mcp:')}
											<div class="shrink-0">
												<Tooltip content={$i18n.t('Disconnect OAuth')}>
													<button
														class="self-center w-fit text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition rounded-full"
														type="button"
														on:click={async (e) => {
															e.stopPropagation();
															e.preventDefault();

															const parts = toolId.split(':');
															const serverId = parts.at(-1) ?? toolId;
															const provider = `mcp:${serverId}`;

															try {
																await deleteOAuthSession(localStorage.token, provider);
																toast.success($i18n.t('OAuth session disconnected'));

																// Refresh tools to update authenticated state
																_tools.set(await getTools(localStorage.token));
																selectedToolIds = selectedToolIds.filter((id) => id !== toolId);
																await init();
															} catch (err) {
																toast.error(err ?? $i18n.t('Failed to disconnect'));
															}
														}}
													>
														<LinkSlash className="size-3.5" />
													</button>
												</Tooltip>
											</div>
										{/if}

										{#if tools?.[toolId]?.has_user_valves && ($user?.role === 'admin' || ($user?.permissions?.chat?.valves ?? true))}
											<div class=" shrink-0">
												<Tooltip content={$i18n.t('Valves')}>
													<button
														class="self-center w-fit text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition rounded-full"
														type="button"
														on:click={(e) => {
															e.stopPropagation();
															e.preventDefault();
															onShowValves({
																type: 'tool',
																id: toolId
															});
														}}
													>
														<Knobs />
													</button>
												</Tooltip>
											</div>
										{/if}

										<div class=" shrink-0" inert>
											<Switch state={selectedToolIds.includes(toolId)} />
										</div>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{:else if tab === 'skills' && skills}
				<div class="flex max-h-72 min-h-0 flex-col gap-0.5" in:fly={{ x: 20, duration: 150 }}>
					<div class="flex w-full items-center gap-1">
						<button
							class="flex flex-1 min-w-0 gap-2 items-center h-[1.6875rem] px-2 text-[0.8125rem] font-normal cursor-pointer rounded-xl hover:bg-gray-50/40 dark:hover:bg-gray-800/40"
							on:click={() => {
								skillQuery = '';
								tab = '';
							}}
						>
							<ChevronLeft />

							<div class="min-w-0 truncate">
								{$i18n.t('Skills')}
								<span class="ml-0.5 text-gray-500">{skillIds.length}</span>
							</div>
						</button>

						{#if (selectedSkillIds ?? []).length > 0}
							<Tooltip content={$i18n.t('Details of the skills in use')} placement="top-end">
								<button
									class="shrink-0 flex h-[1.6875rem] w-[1.6875rem] items-center justify-center rounded-xl text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50/40 dark:hover:bg-gray-800/40"
									aria-label={$i18n.t('Details of the skills in use')}
									on:click={() => showDetails('skills')}
								>
									<InfoCircle className="size-3.5" strokeWidth="1.75" />
								</button>
							</Tooltip>
						{/if}

						<Tooltip
							content={allSkillsOn
								? $i18n.t('Switch off every skill in this list')
								: $i18n.t('Switch on every skill in this list')}
							placement="top-end"
						>
							<button
								class="shrink-0 h-[1.6875rem] px-2 text-[0.75rem] rounded-xl whitespace-nowrap text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50/40 dark:hover:bg-gray-800/40 disabled:opacity-40"
								disabled={listedSkillIds.length === 0}
								on:click={toggleAllSkills}
							>
								{allSkillsOn ? $i18n.t('None') : $i18n.t('All')}
							</button>
						</Tooltip>
					</div>

					<SearchInput bind:value={skillQuery} placeholder={$i18n.t('Search skills')} />

					<div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
						{#if skillIds.length === 0}
							<div class="text-center text-xs text-gray-500 py-3">{$i18n.t('No skills found')}</div>
						{:else}
							<div class="flex flex-col gap-0.5">
								{#each skillIds as skillId}
									<button
										class="relative {rowClass(selectedSkillIds.includes(skillId))}"
										aria-pressed={selectedSkillIds.includes(skillId)}
										on:click={async () => {
											await toggleSkill(skillId);
										}}
									>
										<div class="flex-1 truncate">
											<div class="flex flex-1 items-center gap-2 overflow-hidden">
												<Tooltip
													content={resolveLocalizedResource(
														skills?.[skillId],
														$i18n.language,
														'name'
													)}
													placement="top"
												>
													<div class="shrink-0">
														<Cube className="size-3.5" strokeWidth="1.75" />
													</div>
												</Tooltip>
												<Tooltip
													content={resolveLocalizedResource(
														skills?.[skillId],
														$i18n.language,
														'description'
													)}
													placement="top-start"
												>
													<div class="min-w-0 truncate">
														{resolveLocalizedResource(skills?.[skillId], $i18n.language, 'name')}
													</div>
													{#if resolveLocalizedResource(skills?.[skillId], $i18n.language, 'description')}
														<div class="min-w-0 truncate text-gray-400 dark:text-gray-500">
															{resolveLocalizedResource(
																skills?.[skillId],
																$i18n.language,
																'description'
															)}
														</div>
													{/if}
												</Tooltip>
											</div>
										</div>

										<div class=" shrink-0" inert>
											<Switch state={selectedSkillIds.includes(skillId)} />
										</div>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{:else if tab === 'presets'}
				<div class="flex max-h-72 min-h-0 flex-col gap-0.5" in:fly={{ x: 20, duration: 150 }}>
					<div class="flex w-full items-center gap-1">
						<button
							class="flex flex-1 min-w-0 gap-2 items-center h-[1.6875rem] px-2 text-[0.8125rem] font-normal cursor-pointer rounded-xl hover:bg-gray-50/40 dark:hover:bg-gray-800/40"
							on:click={() => {
								editingPresets = false;
								tab = '';
							}}
						>
							<ChevronLeft />

							<div class="min-w-0 truncate">
								{$i18n.t('Presets')}
								{#if presets.length > 0}
									<span class="ml-0.5 text-gray-500">{presets.length}</span>
								{/if}
							</div>
						</button>

						{#if presets.length > 0}
							<button
								class="shrink-0 h-[1.6875rem] px-2 text-[0.75rem] rounded-xl whitespace-nowrap text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50/40 dark:hover:bg-gray-800/40"
								on:click={() => {
									editingPresets = !editingPresets;
									renameDrafts = {};
								}}
							>
								{editingPresets ? $i18n.t('Done') : $i18n.t('Edit')}
							</button>
						{/if}
					</div>

					<div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
						{#if presets.length === 0}
							<div class="px-2 py-3 text-xs text-gray-500">
								{$i18n.t(
									'Switch on what you need, then name it here. One click puts it all back on later.'
								)}
							</div>
						{:else}
							<div class="flex flex-col gap-0.5">
								{#each presets as preset (preset.id)}
									{#if editingPresets}
										<div
											class="flex w-full items-center gap-1 px-2 py-0.5 rounded-xl text-[0.8125rem]"
										>
											<input
												class="min-w-0 flex-1 bg-transparent outline-hidden text-gray-700 dark:text-gray-200 placeholder:text-gray-400"
												value={renameDrafts[preset.id] ?? preset.name}
												maxlength={MAX_PRESET_NAME}
												aria-label={$i18n.t('Preset name')}
												on:input={(e) => {
													renameDrafts = {
														...renameDrafts,
														[preset.id]: e.currentTarget.value
													};
												}}
												on:blur={() => commitRename(preset)}
												on:keydown={(e) => {
													if (e.key === 'Enter') {
														e.preventDefault();
														e.currentTarget.blur();
													} else if (e.key === 'Escape') {
														e.preventDefault();
														renameDrafts = { ...renameDrafts, [preset.id]: preset.name };
													}
												}}
											/>

											<Tooltip content={$i18n.t('Replace with what is switched on now')}>
												<button
													class="shrink-0 p-1 rounded-lg text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50/40 dark:hover:bg-gray-800/40 disabled:opacity-40"
													aria-label={$i18n.t('Replace with what is switched on now')}
													on:click={() => overwritePreset(preset)}
												>
													<ArrowPath className="size-3.5" strokeWidth="1.75" />
												</button>
											</Tooltip>

											<Tooltip content={$i18n.t('Delete preset')}>
												<button
													class="shrink-0 p-1 rounded-lg text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-50/40 dark:hover:bg-gray-800/40 disabled:opacity-40"
													aria-label={$i18n.t('Delete preset')}
													on:click={() => deletePreset(preset)}
												>
													<GarbageBin className="size-3.5" strokeWidth="1.75" />
												</button>
											</Tooltip>
										</div>
									{:else}
										<button
											class={rowClass(currentPreset?.id === preset.id)}
											aria-pressed={currentPreset?.id === preset.id}
											on:click={() => applyPreset(preset)}
										>
											<div class="flex-1 truncate">
												<div class="flex flex-1 items-center gap-2 overflow-hidden">
													<div class="shrink-0">
														<Bolt className="size-3.5" strokeWidth="1.75" />
													</div>

													<div class="min-w-0 truncate">{preset.name}</div>
													<div class="min-w-0 truncate text-gray-400 dark:text-gray-500">
														{presetSummary(preset)}
													</div>
												</div>
											</div>

											{#if currentPreset?.id === preset.id}
												<div class="shrink-0 text-gray-500">
													<Check className="size-3.5" strokeWidth="2.5" />
												</div>
											{/if}
										</button>
									{/if}
								{/each}
							</div>
						{/if}
					</div>

					<div class="mt-1 pt-1 border-t border-gray-100 dark:border-gray-850">
						<form
							class="flex w-full items-center gap-1 px-2 h-[1.6875rem] text-[0.8125rem]"
							on:submit|preventDefault={createPreset}
						>
							<div class="shrink-0 text-gray-500">
								<Pencil className="size-3.5" strokeWidth="1.75" />
							</div>

							<input
								class="min-w-0 flex-1 bg-transparent outline-hidden text-gray-700 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-500"
								bind:value={newPresetName}
								maxlength={MAX_PRESET_NAME}
								placeholder={$i18n.t('Name this combination')}
								aria-label={$i18n.t('Name this combination')}
								disabled={savingPresets || presets.length >= MAX_PRESETS}
							/>

							<button
								class="shrink-0 px-2 rounded-lg text-[0.75rem] text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50/40 dark:hover:bg-gray-800/40 disabled:opacity-40 whitespace-nowrap"
								type="submit"
								disabled={savingPresets ||
									newPresetName.trim() === '' ||
									presets.length >= MAX_PRESETS}
							>
								{$i18n.t('Save')}
							</button>
						</form>
					</div>
				</div>
			{/if}
		</DropdownMenu>
	</div>
</Dropdown>
