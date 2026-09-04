<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import type { Writable } from 'svelte/store';
	import type { i18n as i18nType } from 'i18next';
	import { toast } from 'svelte-sonner';

	import {
		confirmTotp,
		disableTotp,
		getTotpStatus,
		regenerateRecoveryCodes,
		setupTotp
	} from '$lib/apis/auths';
	import { copyToClipboard } from '$lib/utils';
	import SensitiveInput from '$lib/components/common/SensitiveInput.svelte';

	const i18n: Writable<i18nType> = getContext('i18n');

	const actionButtonClass =
		'text-xs text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-500 dark:hover:text-white';
	const fieldClass =
		'my-0.5 w-full bg-transparent text-sm outline-hidden placeholder:text-gray-300 dark:placeholder:text-gray-600';

	/**
	 * Which of the four things this panel is doing.
	 *
	 * A flat state rather than a handful of booleans that can disagree: there is
	 * no such thing as enrolling and disabling at once, and a set of flags is a
	 * set of ways to end up in a shape nobody designed.
	 */
	type Stage = 'idle' | 'enrolling' | 'regenerating' | 'showing-codes' | 'disabling';

	let stage: Stage = 'idle';
	let busy = false;

	let enabled = false;
	let recoveryLeft = 0;

	let password = '';
	let code = '';

	/** The shared secret, readable only between staging it and confirming it. */
	let secret = '';
	let uri = '';

	/** Readable exactly once, here, because they are stored hashed. */
	let recoveryCodes: string[] = [];

	const reset = () => {
		password = '';
		code = '';
		secret = '';
		uri = '';
	};

	const refresh = async () => {
		const status = await getTotpStatus(localStorage.token).catch(() => null);
		if (status) {
			enabled = status.enabled;
			recoveryLeft = status.recovery_codes_left;
		}
	};

	onMount(refresh);

	/** The key in fours, because it gets typed by hand when a scan is not an option. */
	$: readableSecret = secret.replace(/(.{4})/g, '$1 ').trim();

	const beginHandler = async () => {
		busy = true;
		const res = await setupTotp(localStorage.token, password).catch((error) => {
			toast.error(`${error}`);
			return null;
		});
		busy = false;

		if (res) {
			secret = res.secret;
			uri = res.uri;
			password = '';
			stage = 'enrolling';
		}
	};

	const confirmHandler = async () => {
		busy = true;
		const res = await confirmTotp(localStorage.token, code).catch((error) => {
			toast.error(`${error}`);
			return null;
		});
		busy = false;

		if (res) {
			recoveryCodes = res.recovery_codes;
			reset();
			stage = 'showing-codes';
			await refresh();
		}
	};

	const regenerateHandler = async () => {
		busy = true;
		const res = await regenerateRecoveryCodes(localStorage.token, password).catch((error) => {
			toast.error(`${error}`);
			return null;
		});
		busy = false;

		if (res) {
			recoveryCodes = res.recovery_codes;
			reset();
			stage = 'showing-codes';
			await refresh();
		}
	};

	const disableHandler = async () => {
		busy = true;
		const res = await disableTotp(localStorage.token, password, code).catch((error) => {
			toast.error(`${error}`);
			return null;
		});
		busy = false;

		if (res) {
			toast.success($i18n.t('Two-factor authentication is off.'));
			reset();
			stage = 'idle';
			await refresh();
		}
	};

	const copyCodes = async () => {
		await copyToClipboard(recoveryCodes.join('\n'));
		toast.success($i18n.t('Copied to clipboard'));
	};
</script>

<div class="flex flex-col gap-2 text-xs text-gray-600 dark:text-gray-400">
	{#if stage === 'idle'}
		<div class="flex items-center justify-between gap-2">
			<div class="min-w-0">
				{#if enabled}
					<div>{$i18n.t('On')}</div>
					<div class="mt-0.5 text-gray-400 dark:text-gray-600">
						{$i18n.t('{{count}} recovery codes left', { count: recoveryLeft })}
					</div>
				{:else}
					<div class="text-gray-400 dark:text-gray-600">
						{$i18n.t('A code from an authenticator app, asked for after your password.')}
					</div>
				{/if}
			</div>

			<div class="flex shrink-0 items-center gap-3">
				{#if enabled}
					<button class={actionButtonClass} type="button" on:click={() => (stage = 'disabling')}>
						{$i18n.t('Turn off')}
					</button>
				{:else}
					<button class={actionButtonClass} type="button" on:click={() => (stage = 'enrolling')}>
						{$i18n.t('Set up')}
					</button>
				{/if}
			</div>
		</div>

		{#if enabled && recoveryLeft <= 3}
			<!--
				Said here rather than left to be discovered on the day the phone is
				gone, which is the one day it cannot be acted on.
			-->
			<div class="text-amber-600 dark:text-amber-500">
				{$i18n.t('Few recovery codes left. Generate a new set while you still can.')}
			</div>
		{/if}
	{/if}

	{#if stage === 'enrolling' && !secret}
		<form
			class="flex flex-col gap-2"
			on:submit|preventDefault={() => {
				if (!busy) beginHandler();
			}}
		>
			<div class="text-gray-400 dark:text-gray-600">
				{$i18n.t('Confirm your password to begin.')}
			</div>
			<SensitiveInput
				bind:value={password}
				type="password"
				class={fieldClass}
				autocomplete="current-password"
				placeholder={$i18n.t('Enter Your Password')}
				required
			/>
			<div class="flex items-center gap-3">
				<button class={actionButtonClass} type="submit" disabled={busy}>
					{$i18n.t('Continue')}
				</button>
				<button
					class={actionButtonClass}
					type="button"
					on:click={() => {
						reset();
						stage = 'idle';
					}}
				>
					{$i18n.t('Cancel')}
				</button>
			</div>
		</form>
	{/if}

	{#if stage === 'enrolling' && secret}
		<div class="flex flex-col gap-2">
			<div class="text-gray-400 dark:text-gray-600">
				{$i18n.t('Add this key to your authenticator app, then enter the code it shows.')}
			</div>

			<!--
				The key itself, and a link that hands it straight to an app on this
				device. No QR: drawing one needs an encoder, and the only honest way
				to add one is a dependency this fork has been careful not to take on.
				Every authenticator accepts a typed key, and on the machine you are
				reading this on, the link is quicker than a camera anyway.
			-->
			<div
				class="rounded-lg bg-gray-50 px-3 py-2 font-mono text-[0.8125rem] tracking-wider break-all select-all dark:bg-white/[0.04]"
			>
				{readableSecret}
			</div>

			<div class="flex flex-wrap items-center gap-3">
				<button
					class={actionButtonClass}
					type="button"
					on:click={async () => {
						await copyToClipboard(secret);
						toast.success($i18n.t('Copied to clipboard'));
					}}
				>
					{$i18n.t('Copy key')}
				</button>
				<a class={actionButtonClass} href={uri}>{$i18n.t('Open in authenticator app')}</a>
			</div>

			<form
				class="mt-1 flex flex-col gap-2"
				on:submit|preventDefault={() => {
					if (!busy) confirmHandler();
				}}
			>
				<input
					bind:value={code}
					class={fieldClass}
					type="text"
					inputmode="numeric"
					autocomplete="one-time-code"
					spellcheck="false"
					placeholder="123456"
					required
				/>
				<div class="flex items-center gap-3">
					<button class={actionButtonClass} type="submit" disabled={busy}>
						{$i18n.t('Turn on')}
					</button>
					<button
						class={actionButtonClass}
						type="button"
						on:click={() => {
							reset();
							stage = 'idle';
						}}
					>
						{$i18n.t('Cancel')}
					</button>
				</div>
			</form>
		</div>
	{/if}

	{#if stage === 'showing-codes'}
		<div class="flex flex-col gap-2">
			<div>{$i18n.t('Save these now. They will not be shown again.')}</div>
			<div class="text-gray-400 dark:text-gray-600">
				{$i18n.t('Each one signs you in once, if your authenticator is unavailable.')}
			</div>

			<div
				class="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 font-mono text-[0.8125rem] select-all dark:bg-white/[0.04]"
			>
				{#each recoveryCodes as recoveryCode (recoveryCode)}
					<div>{recoveryCode}</div>
				{/each}
			</div>

			<div class="flex items-center gap-3">
				<button class={actionButtonClass} type="button" on:click={copyCodes}>
					{$i18n.t('Copy')}
				</button>
				<button
					class={actionButtonClass}
					type="button"
					on:click={() => {
						recoveryCodes = [];
						stage = 'idle';
					}}
				>
					{$i18n.t('Done')}
				</button>
			</div>
		</div>
	{/if}

	{#if stage === 'disabling'}
		<form
			class="flex flex-col gap-2"
			on:submit|preventDefault={() => {
				if (!busy) disableHandler();
			}}
		>
			<div class="text-gray-400 dark:text-gray-600">
				{$i18n.t('Your password and a current code, so a borrowed session cannot undo this.')}
			</div>
			<SensitiveInput
				bind:value={password}
				type="password"
				class={fieldClass}
				autocomplete="current-password"
				placeholder={$i18n.t('Enter Your Password')}
				required
			/>
			<input
				bind:value={code}
				class={fieldClass}
				type="text"
				inputmode="numeric"
				autocomplete="one-time-code"
				spellcheck="false"
				placeholder="123456"
				required
			/>
			<div class="flex items-center gap-3">
				<button class={actionButtonClass} type="submit" disabled={busy}>
					{$i18n.t('Turn off')}
				</button>
				<button
					class={actionButtonClass}
					type="button"
					on:click={() => {
						reset();
						stage = 'idle';
					}}
				>
					{$i18n.t('Cancel')}
				</button>
			</div>
		</form>
	{/if}

	{#if stage === 'idle' && enabled}
		<div class="flex items-center gap-3">
			<button
				class={actionButtonClass}
				type="button"
				on:click={() => {
					reset();
					stage = 'regenerating';
				}}
			>
				{$i18n.t('New recovery codes')}
			</button>
		</div>
	{/if}

	{#if stage === 'regenerating'}
		<!--
			Its own stage, not a detour through enrolment. Enrolment stages a new
			secret and switches the factor off until a code confirms it — running
			that against an account that already has one would turn off the very
			protection this button was pressed to keep.
		-->
		<form
			class="flex flex-col gap-2"
			on:submit|preventDefault={() => {
				if (!busy) regenerateHandler();
			}}
		>
			<div class="text-gray-400 dark:text-gray-600">
				{$i18n.t('The old codes stop working. Confirm your password.')}
			</div>
			<SensitiveInput
				bind:value={password}
				type="password"
				class={fieldClass}
				autocomplete="current-password"
				placeholder={$i18n.t('Enter Your Password')}
				required
			/>
			<div class="flex items-center gap-3">
				<button class={actionButtonClass} type="submit" disabled={busy}>
					{$i18n.t('Generate')}
				</button>
				<button
					class={actionButtonClass}
					type="button"
					on:click={() => {
						reset();
						stage = 'idle';
					}}
				>
					{$i18n.t('Cancel')}
				</button>
			</div>
		</form>
	{/if}
</div>
