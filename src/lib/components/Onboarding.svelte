<script lang="ts">
	import { tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { app } from '../app.svelte.ts';
	import { prefersReducedMotion } from '../motion.ts';
	import Icon from './Icon.svelte';

	const slides = [
		{ kicker: 'Welcome', title: 'Your reading, in one place.' },
		{ kicker: 'One tap', title: 'Log it, then read straight on.' },
		{ kicker: 'Share', title: 'Show your shelf, keep your notes.' },
		{ kicker: 'Account', title: 'Keep it on every device.' }
	];

	let step = $state(0);
	let mode = $state<'create' | 'token'>('create');
	let name = $state('');
	let invite = $state('');
	let token = $state('');
	let busy = $state(false);
	let error = $state('');
	let nameInput: HTMLInputElement | undefined = $state();
	let wasOpen = false;

	$effect(() => {
		const open = app.onboardingOpen;
		if (open && !wasOpen) {
			wasOpen = true;
			step = 0;
			mode = 'create';
			name = '';
			invite = '';
			token = '';
			busy = false;
			error = '';
		} else if (!open) {
			wasOpen = false;
		}
	});

	$effect(() => {
		if (!app.onboardingOpen) return;
		document.body.classList.add('is-locked');
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') void app.dismissOnboarding();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			document.body.classList.remove('is-locked');
			window.removeEventListener('keydown', onKey);
		};
	});

	$effect(() => {
		if (app.onboardingOpen && step === 3 && !app.account) {
			void tick().then(() => nameInput?.focus());
		}
	});

	function next(): void {
		step = Math.min(3, step + 1);
		error = '';
	}

	function back(): void {
		step = Math.max(0, step - 1);
		error = '';
	}

	async function createAccount(event: Event): Promise<void> {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			const clean = name.trim();
			if (clean.length < 2) {
				error = 'Choose a name of at least two characters.';
				return;
			}
			const outcome = await app.createAccount(clean, invite.trim());
			if (!outcome.ok) {
				error = outcome.message;
				return;
			}
			await app.dismissOnboarding();
			app.showToast('Account created', {
				detail: `Signed in as ${app.account?.username ?? clean}. Your shelf will sync from now on.`
			});
		} finally {
			busy = false;
		}
	}

	async function connectToken(event: Event): Promise<void> {
		event.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			const clean = token.trim();
			if (!clean) {
				error = 'Paste the token saved on your other device.';
				return;
			}
			const outcome = await app.saveSyncSettings('', clean, app.device?.label ?? '');
			if (!outcome.ok) {
				error = outcome.message;
				return;
			}
			await app.dismissOnboarding();
			app.showToast('Connected', { detail: outcome.message });
		} finally {
			busy = false;
		}
	}

	async function useLocally(): Promise<void> {
		await app.dismissOnboarding();
		app.showToast('Using this device only', {
			detail: 'You can create an account later from Settings.'
		});
	}
</script>

{#if app.onboardingOpen}
	<div
		class="scrim"
		role="presentation"
		transition:fade={{ duration: prefersReducedMotion ? 0 : 140 }}
		onclick={() => void app.dismissOnboarding()}
	></div>

	<div
		class="tour"
		role="dialog"
		aria-modal="true"
		aria-labelledby="tour-title"
		transition:fly={{ y: prefersReducedMotion ? 0 : 16, duration: prefersReducedMotion ? 0 : 200 }}
	>
		<header class="tour__head">
			<div class="tour__brand">
				<span class="tour__hanko" lang="ja" aria-hidden="true">読</span>
				<div>
					<p class="eyebrow eyebrow--ink">Yomi · {slides[step].kicker}</p>
					<p class="tour__step mono">Step {step + 1} of {slides.length}</p>
				</div>
			</div>
			<button class="tour__close" aria-label="Close the tour" onclick={() => void app.dismissOnboarding()}>
				<Icon name="close" size={17} />
			</button>
		</header>

		<div class="tour__track" aria-hidden="true">
			{#each slides as _, index (index)}
				<span class:is-done={index <= step}></span>
			{/each}
		</div>

		<div class="tour__body">
			<h2 class="tour__title" id="tour-title">{slides[step].title}</h2>

			{#if step === 0}
				<p class="tour__lead">
					Yomi is a private reading ledger: one row per series, every site URL feeding the same
					chapter count. No feed, no recommendations, no one watching.
				</p>
				<ul class="tour__points">
					<li>
						<Icon name="book" size={16} />
						<span><strong>One row per series</strong> — title, cover, synopsis and total.</span>
					</li>
					<li>
						<Icon name="plus" size={16} />
						<span><strong>One tap logs a chapter</strong> — while sites change around you.</span>
					</li>
					<li>
						<Icon name="chart" size={16} />
						<span><strong>Stats without a profile</strong> — streaks, pages, a reading recap.</span>
					</li>
				</ul>
				{#if app.canInstall}
					<button class="btn btn--sm tour__install" onclick={() => app.promptInstall()}>
						<Icon name="download" size={13} />
						Install Yomi
					</button>
				{/if}
			{:else if step === 1}
				<p class="tour__lead">
					The shelf puts the next chapter first. Read it on the site, come back, and log it — the
					order is always the same.
				</p>
				<div class="tour__mock">
					<div class="mock__row">
						<span class="mock__title">Dandadan</span>
						<span class="mock__chapter">ch. 149 / 210</span>
						<span class="mock__plus">+1</span>
					</div>
					<p class="mock__caption mono">Tap the chapter number to open it · tap +1 when you are back</p>
				</div>
				<ul class="tour__points tour__points--tight">
					<li><span><strong>Read ch. 150</strong> opens the next page from your saved URL.</span></li>
					<li><span><strong>+1</strong> only changes your counter — it never opens a site.</span></li>
					<li><span>Paste a URL from the phone share sheet to add a series from anywhere.</span></li>
				</ul>
			{:else if step === 2}
				<p class="tour__lead">
					Share a read-only link to your shelf. Friends see titles, covers, progress and scores.
					Notes and anything you deleted never leave your account.
				</p>
				<ul class="tour__points">
					<li>
						<Icon name="share" size={16} />
						<span><strong>Share shelf</strong> opens your phone's share sheet, or copies a link.</span>
					</li>
					<li>
						<Icon name="book" size={16} />
						<span><strong>They can save a copy</strong> of a series to start their own shelf.</span>
					</li>
					<li>
						<Icon name="close" size={16} />
						<span><strong>Turn it off any time</strong> — the old address stops working immediately.</span>
					</li>
				</ul>
				<p class="tour__fine">
					The link can be opened by anyone who has it, so share it the way you would share a
					reading list.
				</p>
			{:else}
				{#if app.account}
					<div class="tour__connected">
						<p class="eyebrow eyebrow--ink">Connected</p>
						<p class="tour__connected-name">{app.account.username}</p>
						<p class="tour__fine">
							This shelf syncs with the account. Notes stay private, and only you can change it.
						</p>
						<button class="btn btn--ink" onclick={() => void app.dismissOnboarding()}>
							Open the shelf
							<Icon name="arrow-right" size={14} />
						</button>
					</div>
				{:else}
					<p class="tour__lead">
						An account gives every device the same shelf and makes share links possible. The
						token is stored in this browser only.
					</p>

					<div class="tour__tabs" role="group" aria-label="Account action">
						<button
							class="tour__tab"
							class:is-on={mode === 'create'}
							aria-pressed={mode === 'create'}
							onclick={() => {
								mode = 'create';
								error = '';
							}}>New account</button
						>
						<button
							class="tour__tab"
							class:is-on={mode === 'token'}
							aria-pressed={mode === 'token'}
							onclick={() => {
								mode = 'token';
								error = '';
							}}>I have a token</button
						>
					</div>

					{#if mode === 'create'}
						<form class="tour__form" onsubmit={createAccount}>
							<label class="field">
								<span class="field__label">Account name</span>
								<input
									class="input"
									bind:this={nameInput}
									bind:value={name}
									maxlength="32"
									autocomplete="username"
									placeholder="your name"
								/>
							</label>
							<label class="field">
								<span class="field__label">
									Invite code
									<span class="field__hint">only if this Worker asks</span>
								</span>
								<input
									class="input input--mono"
									bind:value={invite}
									autocomplete="off"
									spellcheck="false"
									placeholder="—"
								/>
							</label>
							<button
								class="btn btn--red btn--block"
								type="submit"
								disabled={busy || name.trim().length < 2}
							>
								{busy ? 'Creating…' : 'Create account'}
								<Icon name="arrow-right" size={14} />
							</button>
						</form>
					{:else}
						<form class="tour__form" onsubmit={connectToken}>
							<label class="field">
								<span class="field__label">
									Sync token
									<span class="field__hint">from your other device</span>
								</span>
								<input
									class="input input--mono"
									bind:value={token}
									type="password"
									autocomplete="off"
									spellcheck="false"
									placeholder="paste the token"
								/>
							</label>
							<button class="btn btn--ink btn--block" type="submit" disabled={busy}>
								{busy ? 'Connecting…' : 'Connect this device'}
								<Icon name="arrow-right" size={14} />
							</button>
						</form>
					{/if}

					{#if error}
						<p class="tour__error" role="alert">{error}</p>
					{/if}

					<p class="tour__fine">
						No email, no password, no analytics. If you lose the token, the shelf on the server
						cannot be recovered.
					</p>
				{/if}
			{/if}
		</div>

		<footer class="tour__foot">
			<button class="tour__skip" onclick={() => void useLocally()}>
				{step === 3 ? 'Maybe later — use this device only' : 'Use this device only'}
			</button>
			<div class="tour__nav">
				{#if step > 0}
					<button class="btn btn--sm btn--ghost" onclick={back}>Back</button>
				{/if}
				{#if step < 3}
					<button class="btn btn--sm btn--ink" onclick={next}>
						Next
						<Icon name="arrow-right" size={13} />
					</button>
				{/if}
			</div>
		</footer>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 90;
		background: color-mix(in srgb, var(--ink) 58%, transparent);
		backdrop-filter: blur(2px);
	}

	.tour {
		position: fixed;
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
		z-index: 91;
		display: flex;
		flex-direction: column;
		width: min(660px, calc(100vw - 24px));
		max-height: calc(100dvh - 24px);
		background: var(--paper);
		border: 2px solid var(--ink);
		box-shadow: 8px 8px 0 var(--red);
	}

	.tour__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 20px 14px;
		border-bottom: 1.5px solid var(--ink);
	}

	.tour__brand {
		display: flex;
		align-items: center;
		gap: 11px;
	}

	.tour__hanko {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		background: var(--red);
		color: var(--on-signal);
		font-family: var(--jp);
		font-size: 20px;
		font-weight: 700;
		transform: rotate(-3deg);
	}

	.tour__step {
		margin-top: 2px;
		font-size: 8px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.tour__close {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border: 1px solid var(--rule);
		color: var(--ink-2);
	}

	.tour__close:hover {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--paper);
	}

	.tour__track {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		border-bottom: 1px solid var(--rule);
	}

	.tour__track span {
		height: 4px;
		background: var(--paper-3);
		border-right: 1px solid var(--paper);
	}

	.tour__track span.is-done {
		background: var(--red);
	}

	.tour__body {
		overflow-y: auto;
		padding: 22px 22px 24px;
	}

	.tour__title {
		font-family: var(--display);
		font-size: clamp(27px, 5vw, 36px);
		font-weight: 400;
		line-height: 1.02;
		letter-spacing: -0.03em;
	}

	.tour__lead {
		margin-top: 10px;
		font-size: 13.5px;
		line-height: 1.6;
		color: var(--ink-2);
		max-width: 56ch;
	}

	.tour__points {
		display: grid;
		gap: 11px;
		margin-top: 18px;
	}

	.tour__points li {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr);
		gap: 10px;
		align-items: start;
		font-size: 13px;
		line-height: 1.5;
		color: var(--ink-2);
	}

	.tour__points li :global(svg) {
		margin-top: 2px;
		color: var(--red);
	}

	.tour__points strong {
		color: var(--ink);
	}

	.tour__points--tight {
		gap: 6px;
		margin-top: 14px;
		font-size: 12px;
	}

	/* These rows have no leading icon, so they must not sit in the icon column. */
	.tour__points--tight li {
		grid-template-columns: minmax(0, 1fr);
	}

	.tour__install {
		margin-top: 18px;
	}

	.tour__mock {
		margin-top: 18px;
		padding: 13px 14px;
		border: 1.5px solid var(--ink);
		border-left: 5px solid var(--red);
		background: var(--paper-2);
	}

	.mock__row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.mock__title {
		font-weight: 700;
		font-size: 15px;
	}

	.mock__chapter {
		margin-left: auto;
		font-family: var(--display);
		font-size: 20px;
	}

	.mock__plus {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border: 1.5px solid var(--ink);
		font-family: var(--mono);
		font-size: 11px;
	}

	.mock__caption {
		margin-top: 7px;
		font-size: 8px;
		letter-spacing: 0.05em;
		color: var(--ink-3);
	}

	.tour__fine {
		margin-top: 14px;
		font-size: 10.5px;
		line-height: 1.5;
		color: var(--ink-3);
	}

	.tour__tabs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		margin-top: 16px;
		border: 1px solid var(--ink);
	}

	.tour__tab {
		min-height: 38px;
		padding: 8px 10px;
		border-right: 1px solid var(--rule);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-2);
	}

	.tour__tab:last-child {
		border-right: 0;
	}

	.tour__tab.is-on {
		background: var(--ink);
		color: var(--paper);
	}

	.tour__form {
		display: grid;
		gap: 11px;
		margin-top: 14px;
	}

	.tour__error {
		margin-top: 10px;
		padding: 8px 10px;
		border-left: 4px solid var(--red);
		background: var(--paper-2);
		font-family: var(--mono);
		font-size: 10px;
		line-height: 1.45;
	}

	.tour__connected {
		display: grid;
		gap: 6px;
		margin-top: 16px;
		padding: 16px;
		border: 1.5px solid var(--ink);
		background: var(--paper-2);
		justify-items: start;
	}

	.tour__connected-name {
		font-family: var(--display);
		font-size: 30px;
		line-height: 1;
		margin-bottom: 4px;
	}

	.tour__connected .btn {
		margin-top: 8px;
	}

	.tour__foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 13px 20px calc(13px + env(safe-area-inset-bottom, 0px));
		border-top: 1.5px solid var(--ink);
	}

	.tour__skip {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.04em;
		text-align: left;
		color: var(--ink-3);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.tour__skip:hover {
		color: var(--ink);
	}

	.tour__nav {
		display: flex;
		gap: 7px;
		flex: 0 0 auto;
	}

	@media (max-width: 560px) {
		.tour {
			width: 100vw;
			height: 100dvh;
			max-height: 100dvh;
			top: 0;
			left: 0;
			transform: none;
			border: 0;
			box-shadow: none;
		}

		.tour__body {
			flex: 1;
		}

		.tour__head {
			padding-top: calc(13px + env(safe-area-inset-top, 0px));
		}

		.tour__body {
			padding: 18px 16px 20px;
		}

		.tour__foot {
			padding-inline: 16px;
		}

		.tour__skip {
			max-width: 150px;
			font-size: 8px;
		}
	}
</style>
