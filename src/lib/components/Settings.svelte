<script lang="ts">
	import { onMount } from 'svelte';
	import { adapterVersions } from '../../../shared/adapters/index.ts';
	import { relativeTime } from '../../../shared/model.ts';
	import { getMeta, pendingCount } from '../db.ts';
	import { app } from '../app.svelte.ts';
	import { resolveEndpoint, syncState, testConnection } from '../sync.ts';
	import Icon from './Icon.svelte';

	let endpoint = $state('');
	let token = $state('');
	let deviceLabel = $state('');
	let lastExportAt = $state<string | null>(null);
	let loading = $state(true);
	let showToken = $state(false);
	let saving = $state(false);
	let testing = $state(false);
	let result = $state<{ ok: boolean; message: string } | null>(null);
	let confirmingWipe = $state(false);
	let importLabel = $state('');
	let pending = $state(0);
	let accountName = $state('');
	let inviteCode = $state('');
	let accountBusy = $state(false);
	let accountResult = $state<{ ok: boolean; message: string } | null>(null);
	let shareBusy = $state(false);
	let confirmingSwitch = $state(false);
	let switching = $state(false);

	const shareLink = $derived(app.shareToken ? app.shareUrl(app.shareToken) : '');

	const endpointUrl = $derived(resolveEndpoint(endpoint));
	const persistedLabel = $derived(
		app.persisted === true
			? 'Persistent'
			: app.persisted === false
				? 'Best effort'
				: 'Checking…'
	);
	const adapters = adapterVersions();
	const captureLink = `${location.origin}/c/`;

	// iOS never fires beforeinstallprompt, and a Home Screen copy keeps its own
	// storage, so telling the two copies apart is the difference between a
	// synced log and a silent second one.
	const onIphone =
		typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
	const standalone =
		typeof window !== 'undefined' &&
		(window.matchMedia('(display-mode: standalone)').matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true);
	const copyLabel = standalone
		? onIphone
			? 'Home Screen app'
			: 'Installed app'
		: onIphone
			? 'Safari'
			: 'Browser tab';
	const weekMs = 7 * 86_400_000;
	const exportDue = $derived(
		app.series.length > 0 &&
			(!lastExportAt || Date.now() - Date.parse(lastExportAt) > weekMs)
	);

	onMount(() => {
		void (async () => {
			const [endpointValue, tokenValue, exportValue, pendingValue] = await Promise.all([
				getMeta<string>('endpoint', ''),
				getMeta<string>('token', ''),
				getMeta<string | null>('last_export_at', null),
				pendingCount()
			]);
			endpoint = String(endpointValue ?? '');
			token = String(tokenValue ?? '');
			lastExportAt = exportValue;
			pending = pendingValue;
			deviceLabel = app.device?.label ?? '';
			loading = false;
		})();
	});

	$effect(() => {
		if (!deviceLabel && app.device?.label) deviceLabel = app.device.label;
	});

	$effect(() => {
		pending = syncState.pending;
	});

	async function save(): Promise<void> {
		saving = true;
		result = null;
		try {
			const outcome = await app.saveSyncSettings(endpoint, token, deviceLabel);
			result = outcome;
			lastExportAt = await getMeta<string | null>('last_export_at', lastExportAt);
			pending = await pendingCount();
		} catch (error) {
			result = {
				ok: false,
				message: error instanceof Error ? error.message : 'Could not save the sync settings.'
			};
		} finally {
			saving = false;
		}
	}

	async function check(): Promise<void> {
		testing = true;
		result = null;
		result = await testConnection(endpoint, token);
		testing = false;
	}

	async function exportNow(): Promise<void> {
		await app.exportJson();
		lastExportAt = await getMeta<string | null>('last_export_at', null);
	}

	async function importFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const payload = JSON.parse(await file.text());
			await app.importJson(payload);
			importLabel = `Imported ${file.name}`;
		} catch (error) {
			app.showToast(error instanceof Error ? error.message : 'That file could not be imported.');
		} finally {
			input.value = '';
		}
	}

	async function copyToken(): Promise<void> {
		if (!token) {
			app.showToast('No token saved yet');
			return;
		}
		await app.copy(token, 'Token copied');
	}

	async function createAccount(event: Event): Promise<void> {
		event.preventDefault();
		if (accountBusy) return;
		accountBusy = true;
		accountResult = null;
		try {
			const outcome = await app.createAccount(accountName, inviteCode);
			accountResult = { ok: outcome.ok, message: outcome.message };
			if (outcome.ok) {
				accountName = '';
				inviteCode = '';
				token = String(await getMeta('token', ''));
				pending = await pendingCount();
			}
		} finally {
			accountBusy = false;
		}
	}

	async function switchAccount(): Promise<void> {
		if (switching) return;
		switching = true;
		try {
			await app.switchAccount();
		} finally {
			switching = false;
		}
	}

	async function importListFile(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const result = await app.importReadingList(await file.text());
			importLabel = `Imported ${file.name} · ${result.created} new, ${result.matched} matched`;
		} catch (error) {
			app.showToast(error instanceof Error ? error.message : 'That list could not be imported.');
		} finally {
			input.value = '';
		}
	}

	async function enableShare(): Promise<void> {
		if (shareBusy) return;
		shareBusy = true;
		try {
			await app.enableShare();
		} finally {
			shareBusy = false;
		}
	}

	async function copyShare(): Promise<void> {
		if (!shareLink) return;
		await app.copy(shareLink, 'Share link copied');
	}

	async function copyEndpoint(): Promise<void> {
		await app.copy(`${endpointUrl}/ingest`, 'Endpoint copied');
	}

	async function copyCaptureLink(): Promise<void> {
		await app.copy(captureLink, 'Capture link copied');
	}

	async function wipe(): Promise<void> {
		if (!confirmingWipe) {
			confirmingWipe = true;
			return;
		}
		await app.wipeLocal();
	}

	function mergeDate(iso: string): string {
		const date = new Date(iso);
		return Number.isFinite(date.getTime())
			? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
			: '';
	}
</script>

<div class="settings">
	<nav class="settings__top" aria-label="Back">
		<a class="back" href="#/">
			<Icon name="arrow-left" size={14} />
			Shelf
		</a>
	</nav>

	<header class="settings__head">
		<p class="eyebrow eyebrow--ink">Setup</p>
		<h1 class="settings__title">Settings</h1>
		<p class="settings__lead">
			One private log. The server only sees chapter events, titles, URLs and your notes.
		</p>
	</header>

	<div class="settings__grid">
		<div class="settings__main">
			<section aria-labelledby="account-title">
				<header class="section-head">
					<h2 class="section-title" id="account-title">Account</h2>
					<span class="tag" class:tag--red={!app.account}>
						{app.account
							? app.account.legacy
								? 'Owner token'
								: 'Signed in'
							: 'Local only'}
					</span>
				</header>

				<p class="section-copy">
					Each account on this Worker keeps its own shelf. Two people can use the same Worker
					without ever seeing each other's rows.
				</p>

				<div class="account-card">
					{#if app.accountChecking}
						<p class="tiny">Checking the token…</p>
					{:else if app.account}
						<p class="account-card__name">{app.account.username}</p>
						<p class="tiny">
							{app.account.legacy
								? 'Connected with the Worker owner token. Create an account below to keep a separate log.'
								: 'This log is private to this account. Its token is the key — keep it with you.'}
						</p>
					{:else}
						<p class="account-card__name">Not connected</p>
						<p class="tiny">
							The shelf lives in this browser only. Create an account to sync it, or paste an
							existing token in Sync below.
						</p>
					{/if}
				</div>

				<form class="form form--account" onsubmit={createAccount}>
					<div class="field-row">
						<label class="field">
							<span class="field__label">New account name</span>
							<input
								class="input"
								bind:value={accountName}
								maxlength="32"
								autocomplete="username"
								placeholder="your name"
							/>
						</label>
						<label class="field">
							<span class="field__label">
								Invite code
								<span class="field__hint">only if the Worker asks</span>
							</span>
							<input
								class="input input--mono"
								bind:value={inviteCode}
								autocomplete="off"
								spellcheck="false"
								placeholder="—"
							/>
						</label>
					</div>
					<div class="form__actions">
						<button
							class="btn btn--sm"
							type="submit"
							disabled={accountBusy || accountName.trim().length < 2}
						>
							{accountBusy ? 'Creating…' : 'Create account'}
						</button>
						<button
							class="btn btn--sm btn--ghost"
							type="button"
							onclick={() => app.openOnboarding()}
						>
							Take the tour
						</button>
						<span class="tiny">Uses the Worker address in Sync below.</span>
					</div>
					{#if accountResult}
						<p class="result" class:result--bad={!accountResult.ok}>
							{accountResult.ok ? '✓' : '×'}
							{accountResult.message}
						</p>
					{/if}
				</form>

				<p class="tiny backup-note">
					The token is shown once when the account is created and spends the rest of its life in
					this browser. Copy it from Sync to sign in on a second device.
				</p>

				<div class="switch">
					{#if confirmingSwitch}
						<p class="switch__warning">
							Start over on this browser? The server copy of this account is not deleted. Any
							changes that have not synced
							{#if pending > 0}({pending} waiting){/if} are lost.
						</p>
						<div class="switch__actions">
							<button class="btn btn--sm btn--danger" onclick={switchAccount} disabled={switching}>
								{switching ? 'Clearing…' : 'Clear this browser'}
							</button>
							<button class="btn btn--sm btn--ghost" onclick={() => (confirmingSwitch = false)}>
								Cancel
							</button>
						</div>
					{:else}
						<button class="switch__open" onclick={() => (confirmingSwitch = true)}>
							Switch account on this device
						</button>
					{/if}
				</div>
			</section>

			<section aria-labelledby="sync-title">
				<header class="section-head">
					<h2 class="section-title" id="sync-title">Sync</h2>
					<span class="tag" class:tag--red={syncState.phase === 'error'}>
						{syncState.phase === 'local'
							? 'Local only'
							: syncState.phase === 'error'
								? 'Needs attention'
								: syncState.phase === 'offline'
									? 'Offline'
									: syncState.phase === 'syncing'
										? 'Syncing'
										: 'Connected'}
					</span>
				</header>

				{#if loading}
					<p class="muted">Reading local settings…</p>
				{:else}
					<form
						class="form"
						onsubmit={(event) => {
							event.preventDefault();
							void save();
						}}
					>
						<label class="field">
							<span class="field__label">
								Worker address
								<span class="field__hint">blank = this site</span>
							</span>
							<input
								class="input input--mono"
								bind:value={endpoint}
								placeholder="https://yomi.you.workers.dev/api"
								autocapitalize="off"
								spellcheck="false"
								inputmode="url"
							/>
						</label>
						<p class="under-field">
							Resolved: <code>{endpointUrl}</code>
						</p>

						<label class="field">
							<span class="field__label">
								Sync token
								<span class="field__hint">one bearer token, all devices</span>
							</span>
							<div class="input-wrap">
								<input
									class="input input--mono input--token"
									bind:value={token}
									type={showToken ? 'text' : 'password'}
									placeholder="paste the Worker's SYNC_TOKEN"
									autocomplete="off"
									spellcheck="false"
								/>
								<button
									type="button"
									class="input-wrap__btn"
									onclick={() => (showToken = !showToken)}
									aria-label={showToken ? 'Hide token' : 'Show token'}
								>
									{showToken ? 'Hide' : 'Show'}
								</button>
								<button
									type="button"
									class="input-wrap__btn"
									onclick={copyToken}
									aria-label="Copy token"
								>
									Copy
								</button>
							</div>
						</label>
						<p class="under-field">
							Kept in this browser's IndexedDB, never in an export. Rotate it with
							<code>wrangler secret put SYNC_TOKEN</code>.
						</p>

						<label class="field">
							<span class="field__label">This device</span>
							<input class="input" bind:value={deviceLabel} maxlength="60" placeholder="Desktop" />
						</label>

						<div class="form__actions">
							<button class="btn btn--red" type="submit" disabled={saving}>
								{saving ? 'Saving…' : 'Save and sync'}
								<Icon name="arrow-right" size={15} />
							</button>
							<button
								class="btn btn--ghost"
								type="button"
								onclick={check}
								disabled={testing}
							>
								{testing ? 'Testing…' : 'Test connection'}
							</button>
						</div>

						{#if result}
							<p class="result" class:result--bad={!result.ok}>
								{result.ok ? '✓' : '×'}
								{result.message}
							</p>
						{/if}
					</form>

					<dl class="status-grid">
						<div>
							<dt>Last sync</dt>
							<dd>
								{syncState.lastSyncAt
									? relativeTime(syncState.lastSyncAt, app.now)
									: 'never'}
							</dd>
						</div>
						<div>
							<dt>Waiting to sync</dt>
							<dd>{pending}</dd>
						</div>
						<div>
							<dt>Device</dt>
							<dd>{app.device?.label ?? '—'}</dd>
						</div>
					</dl>
					{#if syncState.error}
						<p class="notice-red">{syncState.error}</p>
					{/if}
				{/if}
			</section>

			<section aria-labelledby="capture-title">
				<header class="section-head">
					<h2 class="section-title" id="capture-title">Capture</h2>
					<span class="mono section-note">two clients</span>
				</header>

				<div class="capture-grid">
					<div class="capture">
						<p class="eyebrow eyebrow--ink">PC · zero taps</p>
						<h3>Tampermonkey userscript</h3>
						<p>
							Reads the chapter page you already opened and posts it once. SPA route changes are
							handled.
						</p>
						<a class="btn btn--sm" href="/yomi.user.js" target="_blank" rel="noreferrer">
							Install userscript
							<Icon name="external" size={12} />
						</a>
						<p class="tiny">After install: open the script's menu → set Worker + token.</p>
					</div>
					<div class="capture">
						<p class="eyebrow eyebrow--ink">iPhone · two taps</p>
						<h3>Safari Shortcut</h3>
						<p>
							Share Sheet hands the page URL to this app through the capture link below, and the
							app does the posting with the token you saved here. The Shortcut itself carries no
							headers and no token.
						</p>
						<a class="btn btn--sm" href="/capture.html" target="_blank" rel="noreferrer">
							Open setup guide
							<Icon name="external" size={12} />
						</a>
						<p class="tiny">No Mac, no Xcode, no App Store.</p>
					</div>
				</div>

				<div class="capture-links">
					<div class="endpoint">
						<div>
							<span class="field__label">Capture link · iPhone Shortcut</span>
							<code>{captureLink}</code>
						</div>
						<button class="btn btn--sm btn--ghost" type="button" onclick={copyCaptureLink}>
							Copy
						</button>
					</div>
					<div class="endpoint">
						<div>
							<span class="field__label">Capture endpoint · userscript</span>
							<code>{endpointUrl}/ingest</code>
						</div>
						<button class="btn btn--sm btn--ghost" type="button" onclick={copyEndpoint}>
							Copy
						</button>
					</div>
				</div>
				<div class="recipe">
					<p class="field__label">Build the Shortcut once</p>
					<ol>
						<li>In Shortcuts, tap <strong>+</strong> and name it <strong>Log chapter</strong>.</li>
						<li>
							Open its <strong>Details</strong> panel, turn on
							<strong>Show in Share Sheet</strong>, and accept <strong>URLs</strong> and
							<strong>Safari web pages</strong>.
						</li>
						<li>
							Add <strong>Get URLs from Input</strong> and set its input to
							<strong>Shortcut Input</strong>. This is the step that decides whether you track the
							chapter or its name: a shared Safari page is a page object whose default text is
							the <em>title</em>, and this action turns it into the address.
						</li>
						<li>
							Add <strong>URL Encode</strong> and set its input to the <strong>URLs</strong>
							variable from the step above — not to <strong>Shortcut Input</strong>.
						</li>
						<li>
							Add <strong>Get Details of Safari Web Pages</strong>, keep the property
							<strong>Name</strong>, then add a second <strong>URL Encode</strong> for it. That is
							the page's real title: it names a new series properly and gives cover matching
							something better than the URL slug. Optional on Comix, <em>required</em> on
							MangaDot — its addresses carry only a database id
							(<code>/chapter/265763</code>), so the page name is the only place the series
							title and chapter number exist.
						</li>
						<li>
							Add <strong>Text</strong>: paste the capture link (it ends in
							<code>/c/</code>), insert the first <strong>URL Encoded Text</strong> right after
							it, type <code>?title=</code>, then insert the second
							<strong>URL Encoded Text</strong>. Both variables share that name — the lower one
							in the picker is the page title.
						</li>
						<li>
							Add <strong>Open URLs</strong> and point it at that <strong>Text</strong>.
						</li>
						<li>
							Share any chapter page → <strong>Log chapter</strong>. Yomi opens, logs the
							chapter and offers <strong>Undo</strong>.
						</li>
					</ol>
					<p class="tiny">
						If Yomi opens saying the value was not a page URL, the page <em>title</em>
						arrived instead of the link — check that <strong>Get URLs from Input</strong> sits
						before <strong>URL Encode</strong>. If the panel shows the address ending at
						<code>/c/</code>, the variable is on a new line in the Text action:
						<strong>Open URLs</strong> only opens the first URL it finds. Sharing a plain link
						instead of a Safari page carries no name, so the title step comes up empty: on
						Comix the series falls back to the URL slug, and on MangaDot the capture is
						refused rather than saved nameless because its address holds only an id. If a
						capture says “this device only”, press
						<strong>Connect</strong> and paste the token once in that copy of the app —
						Safari and the Home Screen app keep separate storage.
					</p>
				</div>
			</section>

			<section aria-labelledby="data-title">
				<header class="section-head">
					<h2 class="section-title" id="data-title">Data</h2>
					<span class="mono section-note">JSON</span>
				</header>
				<p class="section-copy">
					The export contains every series, site URL, chapter event, merge and tombstone. It never
					contains the token. Import merges by timestamp, so it is safe to restore into a fresh
					browser.
				</p>
				<dl class="status-grid status-grid--wide">
					<div>
						<dt>Series</dt>
						<dd>{app.series.length}</dd>
					</div>
					<div>
						<dt>Chapters</dt>
						<dd>{app.events.length}</dd>
					</div>
					<div>
						<dt>Site URLs</dt>
						<dd>{app.sources.length}</dd>
					</div>
					<div>
						<dt>Last export</dt>
						<dd>{lastExportAt ? relativeTime(lastExportAt, app.now) : 'never'}</dd>
					</div>
				</dl>
				{#if exportDue}
					<p class="export-due">
						<strong>{lastExportAt ? 'Your last export is over a week old.' : 'No export yet.'}</strong>
						iOS can clear a web app's local storage when it goes unused. Download a JSON
						backup, or keep the server authoritative with sync on.
					</p>
				{/if}
				<div class="data-actions">
					<button class="btn" type="button" onclick={exportNow}>
						<Icon name="download" size={14} />
						Export JSON
					</button>
					<label class="btn">
						<Icon name="upload" size={14} />
						Import JSON
						<input type="file" accept="application/json,.json" hidden onchange={importFile} />
					</label>
					<label class="btn btn--ghost">
						<Icon name="book" size={14} />
						Import AniList / MAL
						<input
							type="file"
							accept="application/json,.json,.xml,text/xml,application/xml"
							hidden
							onchange={importListFile}
						/>
					</label>
					{#if importLabel}
						<span class="tiny">{importLabel}</span>
					{/if}
					<button
						class="btn btn--ghost"
						type="button"
						onclick={() => app.fillMissingDetails()}
						disabled={app.detailsFilling}
						title="Look up missing covers, chapter totals and synopses on AniList"
					>
						<Icon name="search" size={14} />
						{app.detailsFilling
							? `Filling ${app.detailsProgress.done} / ${app.detailsProgress.total}…`
							: 'Fetch missing details'}
					</button>
				</div>
				<p class="tiny backup-note">
					AniList lookups run on this device, not on the Worker. A series with two rows keeps
					the first one that matches.
				</p>
				<p class="tiny backup-note">
					Storage is <strong>{persistedLabel}</strong>. On iPhone, install to the Home Screen and
					keep the server authoritative; Safari can clear script-writable storage when a site is
					unused.
				</p>
			</section>

			{#if app.recentlyDeleted.length > 0}
				<section aria-labelledby="deleted-title">
					<header class="section-head">
						<h2 class="section-title" id="deleted-title">Recently deleted</h2>
						<span class="mono section-note">{app.recentlyDeleted.length}</span>
					</header>
					<p class="section-copy">
						Deletes are tombstones, not erasures. Restoring one brings its URLs and chapter log
						back exactly as they were.
					</p>
					<ul class="deleted">
						{#each app.recentlyDeleted as row (row.id)}
							<li class="deleted__row">
								<div>
									<p class="deleted__title">{row.title}</p>
									<p class="deleted__meta mono">deleted {relativeTime(row.deleted_at, app.now)}</p>
								</div>
								<button
									class="btn btn--sm btn--ghost"
									onclick={() => app.restoreDeleted(row.id)}
								>
									<Icon name="undo" size={12} />
									Restore
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section aria-labelledby="share-title">
				<header class="section-head">
					<h2 class="section-title" id="share-title">Share</h2>
					<span class="mono section-note">read-only</span>
				</header>
				<p class="section-copy">
					A link shows titles, covers, scores, tags and chapter progress to anyone who has it.
					Your notes are never included, and turning the link off retires the old address.
				</p>
				{#if !app.account}
					<p class="tiny">Connect an account first — a local-only shelf has no server to share from.</p>
				{:else if app.shareToken}
					<div class="share-link">
						<code>{shareLink}</code>
					</div>
					<div class="data-actions">
						<button class="btn btn--sm" type="button" onclick={copyShare}>
							Copy link
						</button>
						<a class="btn btn--sm btn--ghost" href={shareLink} target="_blank" rel="noreferrer">
							<Icon name="external" size={12} />
							Preview
						</a>
						<button class="btn btn--sm btn--ghost" type="button" onclick={() => app.disableShare()}>
							<Icon name="close" size={12} />
							Turn off
						</button>
					</div>
				{:else}
					<button class="btn" type="button" onclick={enableShare} disabled={shareBusy}>
						<Icon name="share" size={14} />
						{shareBusy ? 'Creating…' : 'Create share link'}
					</button>
				{/if}
			</section>

			<section aria-labelledby="merges-title">
				<header class="section-head">
					<h2 class="section-title" id="merges-title">Merge history</h2>
					<span class="mono section-note">{app.allMerges.length}</span>
				</header>
				{#if app.allMerges.length === 0}
					<p class="section-copy">No merges yet. Duplicates can be merged from any series page.</p>
				{:else}
					<ul class="merges">
						{#each app.allMerges as merge (merge.id)}
							<li class="merge">
								<div class="merge__copy">
									<p>
										<span>{app.titleById(merge.from_series_id)}</span>
										<Icon name="arrow-right" size={12} />
										<strong>{app.titleById(merge.to_series_id)}</strong>
									</p>
									<p class="merge__date">
										{mergeDate(merge.created_at)}
										{#if merge.undone_at}
											<span class="tag">undone</span>
										{:else}
											<span class="tag tag--red">active</span>
										{/if}
									</p>
								</div>
								{#if !merge.undone_at}
									<button class="btn btn--sm btn--ghost" onclick={() => app.undoMerge(merge.id)}>
										<Icon name="undo" size={12} />
										Undo
									</button>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<aside class="settings__side">
			<section class="side-panel">
				<header class="side-head">
					<h2 class="section-title">App</h2>
				</header>
				{#if app.canInstall}
					<button class="btn btn--ink btn--block" onclick={() => app.promptInstall()}>
						<Icon name="download" size={14} />
						Install Yomi
					</button>
				{:else if onIphone && !standalone}
					<div class="install-card">
						<p class="field__label">Add to Home Screen</p>
						<ol>
							<li>Open this page in <strong>Safari</strong>.</li>
							<li>Tap the <strong>Share</strong> button.</li>
							<li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
						</ol>
						<p class="tiny">
							The Home Screen copy has its own storage: paste the token and link it once,
							and both copies stay in step.
						</p>
					</div>
				{:else}
					<p class="side-copy">
						Install it from your browser's menu. Standalone mode keeps the shelf one tap away.
					</p>
				{/if}
				<div class="app-lines">
					<p><span>This copy</span><strong>{copyLabel}</strong></p>
					<p><span>Storage</span><strong>{persistedLabel}</strong></p>
					<p><span>Schema</span><strong class="mono">1</strong></p>
					<p><span>Adapter</span><strong class="mono">comix {adapters.comix}</strong></p>
					<p><span>Adapter</span><strong class="mono">mangadot {adapters.mangadot}</strong></p>
				</div>
			</section>

			<section class="side-panel">
				<header class="side-head">
					<h2 class="section-title">Danger</h2>
				</header>
				<p class="side-copy">
					Erase this browser's copy, including the token and outbox. If sync is configured, the
					server still holds the log.
				</p>
				<button class="btn btn--danger btn--block" onclick={wipe}>
					{confirmingWipe ? 'Tap again to erase this device' : 'Erase this device'}
				</button>
				{#if confirmingWipe}
					<button class="btn btn--ghost btn--block" onclick={() => (confirmingWipe = false)}>
						Keep it
					</button>
				{/if}
			</section>

			<section class="side-panel">
				<header class="side-head">
					<h2 class="section-title">About</h2>
				</header>
				<p class="side-copy">
					Yomi (読み) — “reading”. A private reading ledger, built to be boring in the best
					way: local first, append-only progress, a private shelf per account.
				</p>
				<p class="colophon">No analytics · no third parties · token-guarded Worker</p>
			</section>
		</aside>
	</div>
</div>

<style>
	.settings {
		padding-block: 22px 80px;
		max-width: 1120px;
	}

	.settings__top {
		display: flex;
		align-items: center;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-2);
	}

	.back:hover {
		color: var(--ink);
	}

	.settings__head {
		margin-top: 18px;
		padding-bottom: 22px;
		border-bottom: 2px solid var(--ink);
	}

	.settings__title {
		margin-top: 4px;
		font-family: var(--display);
		font-size: clamp(40px, 6vw, 60px);
		font-weight: 400;
		line-height: 0.98;
		letter-spacing: -0.035em;
	}

	.settings__lead {
		max-width: 560px;
		margin-top: 12px;
		font-size: 14px;
		line-height: 1.55;
		color: var(--ink-2);
	}

	.settings__grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 318px;
		gap: clamp(26px, 5vw, 54px);
		align-items: start;
		margin-top: 12px;
	}

	/* Each panel settles in order, like pages being set down. */
	.settings__main > section,
	.settings__side > section,
	.settings__head {
		animation: yomi-rise-soft 320ms ease-out both;
	}

	.settings__head {
		animation-delay: 40ms;
	}

	.settings__main > section:nth-of-type(1) { animation-delay: 90ms; }
	.settings__main > section:nth-of-type(2) { animation-delay: 140ms; }
	.settings__main > section:nth-of-type(3) { animation-delay: 190ms; }
	.settings__main > section:nth-of-type(4) { animation-delay: 240ms; }

	.settings__side > section:nth-of-type(1) { animation-delay: 120ms; }
	.settings__side > section:nth-of-type(2) { animation-delay: 170ms; }
	.settings__side > section:nth-of-type(3) { animation-delay: 220ms; }

	.settings__main {
		min-width: 0;
	}

	.settings__main > section {
		padding-block: 26px;
		border-bottom: 1px solid var(--rule);
	}

	.section-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
	}

	.section-title {
		font-family: var(--display);
		font-size: 22px;
		font-weight: 400;
		line-height: 1.05;
		letter-spacing: -0.02em;
	}

	.section-note {
		font-size: 8px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 14px;
		max-width: 560px;
	}

	.under-field {
		margin-top: -6px;
		font-size: 10px;
		line-height: 1.5;
		color: var(--ink-3);
	}

	.under-field code,
	.endpoint code {
		font-family: var(--mono);
		font-size: 10px;
		overflow-wrap: anywhere;
	}

	.input-wrap {
		display: flex;
		border: var(--line) solid var(--ink);
		background: var(--paper);
	}

	.input-wrap:focus-within {
		outline: 2px solid var(--red);
		outline-offset: 1px;
	}

	.input-wrap .input {
		border: 0;
		outline: 0;
		min-width: 0;
		flex: 1;
	}

	.input-wrap__btn {
		flex: 0 0 auto;
		padding: 0 9px;
		border-left: 1px solid var(--rule);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
	}

	.input-wrap__btn:hover {
		background: var(--ink);
		color: var(--paper);
	}

	.form__actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}

	.account-card {
		margin-top: 12px;
		display: grid;
		gap: 4px;
		padding: 11px 12px;
		border: 1px solid var(--rule);
		border-left: 4px solid var(--ink);
		background: var(--paper-2);
	}

	.account-card__name {
		font-family: var(--display);
		font-size: 22px;
		line-height: 1.1;
	}

	.form--account {
		margin-top: 14px;
	}

	.switch {
		margin-top: 16px;
		padding-top: 13px;
		border-top: 1px solid var(--rule);
	}

	.switch__open {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.05em;
		color: var(--ink-3);
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.switch__open:hover {
		color: var(--red);
	}

	.switch__warning {
		padding: 9px 11px;
		border-left: 4px solid var(--red);
		background: var(--paper-2);
		font-size: 11px;
		line-height: 1.5;
	}

	.switch__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}

	.field-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 10px;
	}

	.share-link {
		margin-top: 12px;
		padding: 9px 11px;
		border: 1px solid var(--rule);
		background: var(--paper);
		overflow-wrap: anywhere;
	}

	.share-link code {
		font-family: var(--mono);
		font-size: 10px;
		line-height: 1.5;
		user-select: all;
	}

	.result {
		padding: 9px 11px;
		border-left: 4px solid var(--ink);
		background: var(--paper-2);
		font-family: var(--mono);
		font-size: 10px;
		line-height: 1.45;
	}

	.result--bad {
		border-left-color: var(--red);
		color: var(--red);
	}

	.notice-red {
		margin-top: 12px;
		padding: 9px 11px;
		border: 1px solid var(--red);
		border-left-width: 4px;
		font-size: 11px;
	}

	.status-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0;
		margin-top: 20px;
		border-top: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
	}

	.status-grid--wide {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}

	.status-grid > div {
		padding: 10px 12px 11px 0;
		border-right: 1px solid var(--rule);
	}

	.status-grid > div + div {
		padding-left: 12px;
	}

	.status-grid > div:last-child {
		border-right: 0;
	}

	.status-grid dt {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.status-grid dd {
		margin: 3px 0 0;
		font-family: var(--mono);
		font-size: 11px;
		line-height: 1.35;
	}

	.capture-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 22px;
	}

	.capture {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 7px;
		padding: 14px;
		border: 1.5px solid var(--ink);
	}

	.capture h3 {
		font-size: 15px;
		font-weight: 700;
		line-height: 1.3;
	}

	.capture p {
		font-size: 11px;
		line-height: 1.5;
		color: var(--ink-2);
	}

	.capture .btn {
		margin-top: 3px;
	}

	.capture .tiny {
		font-size: 9px;
		color: var(--ink-3);
	}

	.endpoint {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 14px;
		padding: 10px 0;
		border-top: 1px solid var(--rule);
	}

	.capture-links .endpoint + .endpoint {
		margin-top: 0;
	}

	.capture-links .endpoint:last-child {
		border-bottom: 1px solid var(--rule);
	}

	.recipe {
		margin-top: 14px;
		max-width: 640px;
	}

	.recipe ol {
		margin: 6px 0 8px;
		padding-left: 18px;
		font-size: 12px;
		line-height: 1.55;
		color: var(--ink-2);
	}

	.recipe li {
		margin: 5px 0;
	}

	.recipe li::marker {
		font-family: var(--mono);
		font-size: 10px;
		color: var(--red);
	}

	.recipe strong {
		color: var(--ink);
		font-weight: 600;
	}

	.recipe code {
		padding: 0 3px;
		border: 1px solid var(--rule);
		font-family: var(--mono);
		font-size: 10.5px;
		overflow-wrap: anywhere;
	}

	.endpoint > div {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.endpoint code {
		color: var(--ink-2);
	}

	.section-copy {
		max-width: 600px;
		font-size: 12px;
		line-height: 1.55;
		color: var(--ink-2);
	}

	.data-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 14px;
	}

	.tiny {
		font-size: 10px;
		line-height: 1.45;
		color: var(--ink-3);
	}

	.install-card {
		margin-top: 10px;
		padding: 10px 11px;
		border: 1px solid var(--rule);
		background: var(--paper-2);
	}

	.install-card ol {
		margin: 6px 0;
		padding-left: 16px;
		font-size: 11px;
		line-height: 1.6;
		color: var(--ink-2);
	}

	.install-card li::marker {
		font-family: var(--mono);
		font-size: 9px;
		color: var(--red);
	}

	.install-card strong {
		color: var(--ink);
		font-weight: 600;
	}

	.export-due {
		margin-top: 14px;
		padding: 10px 12px;
		border: 1px solid var(--red);
		border-left-width: 4px;
		background: color-mix(in srgb, var(--red) 5%, var(--paper));
		font-size: 11px;
		line-height: 1.55;
		color: var(--ink-2);
	}

	.export-due strong {
		display: block;
		margin-bottom: 2px;
		color: var(--ink);
	}

	.backup-note {
		margin-top: 10px;
		max-width: 560px;
	}

	.deleted {
		margin-top: 10px;
		border-top: 1px solid var(--rule);
	}

	.deleted__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--rule);
	}

	.deleted__title {
		font-size: 12px;
		font-weight: 600;
	}

	.deleted__meta {
		margin-top: 1px;
		font-size: 8px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.merges {
		border-top: 1px solid var(--rule);
	}

	.merge {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 9px 0;
		border-bottom: 1px solid var(--rule);
	}

	.merge__copy p:first-child {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 12px;
	}

	.merge__copy strong {
		font-weight: 700;
	}

	.merge__date {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 3px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.04em;
		color: var(--ink-3);
	}

	.settings__side {
		display: flex;
		flex-direction: column;
		gap: 0;
		position: sticky;
		top: 96px;
		margin-top: 26px;
		border-top: 2px solid var(--ink);
	}

	.side-panel {
		padding: 16px 0;
		border-bottom: 1px solid var(--rule);
	}

	.side-head {
		padding-bottom: 9px;
		margin-bottom: 10px;
		border-bottom: 1px solid var(--rule);
	}

	.side-copy {
		font-size: 11px;
		line-height: 1.55;
		color: var(--ink-2);
	}

	.side-panel .btn--block {
		margin-top: 10px;
	}

	.app-lines {
		display: flex;
		flex-direction: column;
		gap: 5px;
		margin-top: 14px;
	}

	.app-lines p {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.app-lines strong {
		font-weight: 400;
		color: var(--ink);
		text-align: right;
	}

	.colophon {
		margin-top: 12px;
		padding-top: 10px;
		border-top: 1px solid var(--rule);
		font-family: var(--mono);
		font-size: 8px;
		line-height: 1.5;
		letter-spacing: 0.03em;
		color: var(--ink-3);
	}

	@media (max-width: 960px) {
		.settings__grid {
			grid-template-columns: 1fr;
		}

		.settings__side {
			position: static;
			margin-top: 0;
		}

		.capture-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 600px) {
		.settings__grid {
			gap: 18px;
		}

		.settings__main > section {
			padding-block: 20px;
		}

		.settings__lead {
			font-size: 13px;
		}

		.field-row {
			grid-template-columns: 1fr;
		}

		.status-grid,
		.status-grid--wide {
			grid-template-columns: 1fr 1fr;
		}

		.status-grid > div:nth-child(2n) {
			border-right: 0;
			padding-left: 12px;
		}

		.status-grid > div:nth-child(2n + 1) {
			padding-left: 0;
		}

		.status-grid > div:nth-child(n + 3) {
			border-top: 1px solid var(--rule);
		}

		.settings__title {
			font-size: 38px;
		}
	}
</style>
