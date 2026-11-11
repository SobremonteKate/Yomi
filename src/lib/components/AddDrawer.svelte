<script lang="ts">
	import { tick } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { parseCapture, type ParsedCapture } from '../../../shared/parse.ts';
	import {
		parseChapterNumber,
		STATUS_LABEL,
		STATUSES,
		chapterText,
		type Series,
		type Source,
		type Status
	} from '../../../shared/model.ts';
	import { findSourceByPath } from '../db.ts';
	import { app } from '../app.svelte.ts';
	import { prefersReducedMotion } from '../motion.ts';
	import Cover from './Cover.svelte';
	import Icon from './Icon.svelte';

	let url = $state('');
	let pageTitle = $state('');
	let titleDraft = $state('');
	let titleTouched = $state(false);
	let chapterDraft = $state('');
	let chapterTouched = $state(false);
	let statusDraft = $state<Status>('reading');
	let statusTouched = $state(false);
	let logChapter = $state(true);
	let mode = $state<'link' | 'manual'>('link');
	let detection = $state<ParsedCapture | null>(null);
	let existing = $state<{ source: Source; series: Series } | null>(null);
	let checking = $state(false);
	let busy = $state(false);
	let error = $state('');
	let urlInput: HTMLInputElement | undefined = $state();
	let wasOpen = false;
	// A suggested row is a hint: creating the row anyway stays one tap away.
	let creatingAnyway = $state(false);

	const chapterNumber = $derived(
		chapterDraft.trim() ? parseChapterNumber(chapterDraft) : null
	);
	const keepChapter = $derived(logChapter && chapterNumber !== null);
	const canSubmit = $derived(
		busy ||
			titleDraft.trim().length === 0 ||
			(mode === 'link' && !detection) ||
			(mode === 'link' && !existing && !detection)
	);
	const existingStats = $derived(existing ? app.statsFor(existing.series) : null);
	const suggestions = $derived(
		mode === 'link' && detection && !existing && !creatingAnyway
			? app.similarSeries(titleDraft.trim() || detection.series_title || '')
			: []
	);

	$effect(() => {
		const open = app.add.open;
		if (open && !wasOpen) {
			wasOpen = true;
			url = app.add.url;
			pageTitle = app.add.title;
			mode = 'link';
			titleDraft = '';
			titleTouched = false;
			chapterDraft = '';
			chapterTouched = false;
			statusDraft = 'reading';
			statusTouched = false;
			logChapter = true;
			creatingAnyway = false;
			detection = null;
			existing = null;
			error = '';
			busy = false;
			void tick().then(() => urlInput?.focus());
		} else if (!open) {
			wasOpen = false;
		}
	});

	$effect(() => {
		if (!app.add.open) return;
		document.body.classList.add('is-locked');
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') app.closeAdd();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			document.body.classList.remove('is-locked');
			window.removeEventListener('keydown', onKey);
		};
	});

	$effect(() => {
		const raw = url;
		const fromTitle = pageTitle;
		const currentMode = mode;
		if (!app.add.open) return;
		if (currentMode !== 'link') {
			detection = null;
			existing = null;
			checking = false;
			return;
		}
		if (!raw.trim()) {
			detection = null;
			existing = null;
			checking = false;
			return;
		}
		let cancelled = false;
		const handle = setTimeout(async () => {
			const parsed = parseCapture({ url: raw, title: fromTitle });
			if (cancelled) return;
			detection = parsed;
			if (!parsed) {
				existing = null;
				checking = false;
				return;
			}
			if (!titleTouched) titleDraft = parsed.series_title ?? '';
			if (!chapterTouched && parsed.chapter !== null) chapterDraft = String(parsed.chapter);
			if (!statusTouched) {
				statusDraft = parsed.chapter !== null ? 'reading' : 'plan_to_read';
			}
			checking = true;
			try {
				const source = await findSourceByPath(parsed.normalized_path);
				if (cancelled) return;
				const found = source ? app.seriesById(source.series_id) : undefined;
				existing = source && found ? { source, series: found } : null;
			} finally {
				if (!cancelled) checking = false;
			}
		}, 220);
		return () => {
			cancelled = true;
			clearTimeout(handle);
		};
	});

	function onUrlInput(event: Event): void {
		url = (event.currentTarget as HTMLInputElement).value;
		titleTouched = false;
		chapterTouched = false;
		statusTouched = false;
		creatingAnyway = false;
		error = '';
		existing = null;
	}

	function commitTitle(event: Event): void {
		titleDraft = (event.currentTarget as HTMLInputElement).value;
		titleTouched = true;
		creatingAnyway = false;
	}

	/** Same capture, existing row: attach the URL and log the chapter in one go. */
	async function attachToExisting(series: Series): Promise<void> {
		if (!detection || busy) return;
		busy = true;
		error = '';
		try {
			await app.addToExisting(detection, series.id, {
				chapter: keepChapter ? chapterNumber : null,
				chapterLabel: detection.chapter_label,
				logChapter: keepChapter,
				method: 'manual'
			});
			app.closeAdd();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'That chapter could not be logged.';
		} finally {
			busy = false;
		}
	}

	function commitChapter(event: Event): void {
		chapterDraft = (event.currentTarget as HTMLInputElement).value;
		chapterTouched = true;
	}

	function commitStatus(event: Event): void {
		statusDraft = (event.currentTarget as HTMLSelectElement).value as Status;
		statusTouched = true;
	}

	async function submit(): Promise<void> {
		if (busy) return;
		error = '';
		if (!titleDraft.trim()) {
			error = 'Give the series a name.';
			return;
		}
		busy = true;
		try {
			if (mode === 'manual') {
				await app.addByHand(titleDraft, {
					status: statusDraft,
					chapter: keepChapter ? chapterNumber : null
				});
			} else if (detection) {
				await app.addParsed(detection, {
					title: titleDraft,
					status: statusDraft,
					chapter: keepChapter ? chapterNumber : null,
					chapterLabel: detection.chapter_label,
					logChapter: keepChapter,
					method: 'manual'
				});
			}
			app.closeAdd();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'That could not be added.';
		} finally {
			busy = false;
		}
	}

	async function logOnExisting(): Promise<void> {
		if (!existing || chapterNumber === null) {
			if (existing) {
				app.navigate('series', existing.series.id);
				app.closeAdd();
			}
			return;
		}
		busy = true;
		error = '';
		try {
			await app.log(existing.series.id, chapterNumber, {
				label: detection?.chapter_label,
				chapterUrl: detection?.url
			});
			app.closeAdd();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'That chapter could not be logged.';
		} finally {
			busy = false;
		}
	}

	function switchMode(next: 'link' | 'manual'): void {
		mode = next;
		error = '';
		existing = null;
		detection = null;
		if (next === 'manual') statusDraft = 'plan_to_read';
	}
</script>

{#if app.add.open}
	<div
		class="scrim"
		role="presentation"
		transition:fade={{ duration: prefersReducedMotion ? 0 : 130 }}
		onclick={() => app.closeAdd()}
	></div>

	<div
		class="drawer"
		role="dialog"
		aria-modal="true"
		aria-labelledby="add-title"
		transition:fly={{ x: prefersReducedMotion ? 0 : 30, duration: 200 }}
	>
		<header class="drawer__head">
			<div>
				<p class="eyebrow eyebrow--ink">Add</p>
				<h2 class="drawer__title" id="add-title">Put it on the shelf</h2>
			</div>
			<button class="icon-btn" aria-label="Close" onclick={() => app.closeAdd()}>
				<Icon name="close" size={18} />
			</button>
		</header>

		<div class="drawer__mode" role="group" aria-label="Add method">
			<button
				class="mode"
				class:mode--active={mode === 'link'}
				aria-pressed={mode === 'link'}
				onclick={() => switchMode('link')}>From a link</button
			>
			<button
				class="mode"
				class:mode--active={mode === 'manual'}
				aria-pressed={mode === 'manual'}
				onclick={() => switchMode('manual')}>By hand</button
			>
		</div>

		<div class="drawer__body">
			{#if mode === 'link'}
				<label class="field">
					<span class="field__label">
						Page URL
						<span class="field__hint">chapter or series page</span>
					</span>
					<input
						class="input input--mono"
						bind:this={urlInput}
						value={url}
						oninput={onUrlInput}
						placeholder="https://comix.to/title/…/chapter-149"
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						inputmode="url"
					/>
				</label>

				{#if checking}
					<p class="checking">Reading the URL…</p>
				{/if}

				{#if url.trim() && !detection && !checking}
					<div class="notice notice--red">
						That does not look like a readable page URL. Use the full URL from the address bar, or
						switch to <strong>By hand</strong>.
					</div>
				{/if}

				{#if existing}
					<div class="existing">
						<div class="existing__head">
							<span class="eyebrow" style="color:inherit;opacity:.6">Already on the shelf</span>
							<span class="tag" style="border-color:currentColor;color:inherit">
								{detection?.site_label}
							</span>
						</div>
						<div class="existing__body">
							<Cover url={existing.series.cover_url} title={existing.series.title} size="sm" />
							<div>
								<p class="existing__title">{existing.series.title}</p>
								<p class="existing__meta">
									{existingStats?.furthest ?? 0} logged
									{#if existing.series.total_chapters}
										of {existing.series.total_chapters}
									{/if}
									· {STATUS_LABEL[existing.series.status]}
								</p>
							</div>
						</div>
						{#if chapterNumber !== null}
							<p class="existing__note">
								Chapter {chapterText(chapterNumber)} is ready to log on this row.
							</p>
						{:else}
							<p class="existing__note">This page belongs to the series already on your shelf.</p>
						{/if}
					</div>
				{:else if detection}
					<div class="preview">
						<div class="preview__top">
							<span class="tag tag--solid">{detection.site_label}</span>
							<span class="preview__chapter">
								{detection.chapter !== null
									? detection.chapter_label || `Ch. ${chapterText(detection.chapter)}`
									: 'Series page'}
							</span>
						</div>
						<p class="preview__url">{detection.source_url}</p>
						{#if detection.needs_review}
							<p class="preview__warn">
								The title was inferred from the URL. Check it before saving.
							</p>
						{/if}
					</div>
				{/if}
			{/if}

			{#if mode === 'manual'}
				<p class="manual-hint">
					No link needed. A manual row still syncs, and you can attach a site URL later.
				</p>
			{/if}

			{#if suggestions.length > 0}
				<div class="similar">
					<p class="similar__lead">Already on your shelf?</p>
					<p class="similar__copy">
						A second row would split this series' chapter history. Attaching keeps one row.
					</p>
					<ul class="similar__list">
						{#each suggestions as candidate (candidate.id)}
							{@const candidateStats = app.statsFor(candidate)}
							<li class="similar__row">
								<Cover url={candidate.cover_url} title={candidate.title} size="sm" />
								<div class="similar__body">
									<p class="similar__title">{candidate.title}</p>
									<p class="similar__meta">
										{candidateStats.furthest ?? 0} logged
										· {STATUS_LABEL[candidate.status]}
									</p>
								</div>
								<button
									class="btn btn--sm"
									type="button"
									disabled={busy}
									onclick={() => attachToExisting(candidate)}
								>
									{keepChapter ? `Attach & log ${chapterText(chapterNumber ?? 0)}` : 'Attach URL'}
								</button>
							</li>
						{/each}
					</ul>
					<button
						class="similar__skip"
						type="button"
						onclick={() => (creatingAnyway = true)}
					>
						Different series — create a new row
					</button>
				</div>
			{/if}

			{#if mode === 'manual' || (detection && !existing)}
				<label class="field">
					<span class="field__label">Series title</span>
					<input
						class="input"
						value={titleDraft}
						oninput={commitTitle}
						placeholder="e.g. Chainsaw Man"
						maxlength="300"
					/>
				</label>

				<div class="form-row">
					<label class="field">
						<span class="field__label">Chapter</span>
						<input
							class="input input--mono"
							value={chapterDraft}
							oninput={commitChapter}
							placeholder="optional"
							inputmode="decimal"
						/>
					</label>
					<label class="field">
						<span class="field__label">Shelf</span>
						<select class="select" value={statusDraft} onchange={commitStatus}>
							{#each STATUSES as status}
								<option value={status}>{STATUS_LABEL[status]}</option>
							{/each}
						</select>
					</label>
				</div>

				{#if chapterNumber !== null}
					<label class="check">
						<input type="checkbox" bind:checked={logChapter} />
						<span>
							Log chapter {chapterText(chapterNumber)}
							<span class="muted">— adds it to the chapter history now.</span>
						</span>
					</label>
				{/if}
			{/if}

			{#if error}
				<p class="notice notice--red" role="alert">{error}</p>
			{/if}
		</div>

		<footer class="drawer__foot">
			{#if mode === 'link' && existing}
				{#if chapterNumber !== null}
					<button class="btn btn--red btn--lg" onclick={logOnExisting} disabled={busy}>
						{chapterText(chapterNumber)} · Log chapter
						<Icon name="arrow-right" size={16} />
					</button>
				{:else}
					<button
						class="btn btn--ink btn--lg"
						onclick={() => {
							app.navigate('series', existing?.series.id ?? '');
							app.closeAdd();
						}}
					>
						Open series
					</button>
				{/if}
				<button class="btn btn--ghost" onclick={() => app.closeAdd()}>Cancel</button>
			{:else}
				<button class="btn btn--red btn--lg" onclick={submit} disabled={canSubmit}>
					{#if mode === 'manual' && keepChapter}
						Add & log ch. {chapterText(chapterNumber ?? 0)}
					{:else if detection && keepChapter}
						Add & log ch. {chapterText(chapterNumber ?? 0)}
					{:else}
						Add to shelf
					{/if}
					<Icon name="plus" size={15} />
				</button>
				<button class="btn btn--ghost" onclick={() => app.closeAdd()}>Cancel</button>
			{/if}
		</footer>
	</div>
{/if}

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: color-mix(in srgb, var(--ink) 56%, transparent);
	}

	.scrim::after {
		content: '';
		position: absolute;
		inset: 0;
		background-image: radial-gradient(var(--paper) 0.6px, transparent 0.7px);
		background-size: 5px 5px;
		opacity: 0.05;
		pointer-events: none;
	}

	.similar {
		margin-bottom: 14px;
		padding: 11px 12px 10px;
		border: 1px solid var(--ink);
		border-left: 4px solid var(--red);
		background: var(--paper-2);
	}

	.similar__lead {
		font-size: 13px;
		font-weight: 700;
	}

	.similar__copy {
		margin-top: 2px;
		font-size: 11px;
		line-height: 1.5;
		color: var(--ink-2);
	}

	.similar__list {
		display: flex;
		flex-direction: column;
		gap: 7px;
		margin-top: 9px;
	}

	.similar__row {
		display: grid;
		grid-template-columns: 30px minmax(0, 1fr);
		align-items: center;
		gap: 9px;
		padding-top: 7px;
		border-top: 1px solid var(--rule);
	}

	.similar__body {
		min-width: 0;
	}

	.similar__row .btn {
		grid-column: 2;
		justify-self: start;
	}

	.similar__title {
		font-size: 13px;
		font-weight: 700;
		line-height: 1.25;
	}

	.similar__meta {
		margin-top: 1px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.similar__skip {
		margin-top: 9px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.04em;
		color: var(--ink-2);
		border-bottom: 1px solid var(--ink-3);
	}

	.similar__skip:hover {
		color: var(--ink);
	}

	.drawer {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 61;
		display: flex;
		flex-direction: column;
		width: min(486px, 100vw);
		background: var(--paper);
		border-left: 2px solid var(--ink);
		box-shadow: -8px 0 0 rgba(20, 20, 17, 0.12);
	}

	.drawer__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 20px 22px 16px;
		border-bottom: 1.5px solid var(--ink);
	}

	.drawer__title {
		margin-top: 4px;
		font-family: var(--display);
		font-size: 28px;
		font-weight: 400;
		line-height: 1.02;
		letter-spacing: -0.03em;
	}

	.drawer__mode {
		display: flex;
		border-bottom: 1px solid var(--rule);
	}

	.mode {
		flex: 1;
		min-height: 42px;
		padding: 10px 12px;
		border-right: 1px solid var(--rule);
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--ink-2);
	}

	.mode:last-child {
		border-right: 0;
	}

	.mode--active {
		background: var(--ink);
		color: var(--paper);
	}

	.drawer__body {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 20px 22px 24px;
	}

	.checking {
		margin-top: -8px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		color: var(--ink-3);
		text-transform: uppercase;
	}

	.notice {
		padding: 10px 12px;
		border: 1px solid var(--rule);
		background: var(--paper-2);
		font-size: 12px;
		line-height: 1.5;
	}

	.notice--red {
		border-color: var(--red);
		border-left-width: 4px;
		color: var(--ink);
		background: color-mix(in srgb, var(--red) 7%, var(--paper));
	}

	.manual-hint {
		font-size: 12px;
		line-height: 1.5;
		color: var(--ink-2);
		padding-bottom: 4px;
		border-bottom: 1px solid var(--rule);
	}

	.form-row {
		display: grid;
		grid-template-columns: 1fr 1.35fr;
		gap: 12px;
	}

	/* A recognised URL slides its preview in rather than popping. */
	.preview,
	.existing,
	.notice {
		animation: yomi-rise-soft 220ms ease-out both;
	}

	.preview {
		padding: 12px 13px;
		border: 1.5px solid var(--ink);
		background: var(--paper-2);
	}

	.preview__top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.preview__chapter {
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.04em;
	}

	.preview__url {
		margin-top: 9px;
		font-family: var(--mono);
		font-size: 10px;
		line-height: 1.45;
		color: var(--ink-2);
		overflow-wrap: anywhere;
	}

	.preview__warn {
		margin-top: 9px;
		padding-top: 8px;
		border-top: 1px dashed var(--red);
		font-size: 11px;
		line-height: 1.45;
		color: var(--ink);
	}

	.existing {
		padding: 14px;
		background: var(--ink);
		color: var(--paper);
	}

	.existing__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.existing__body {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
	}

	.existing__title {
		font-size: 18px;
		font-weight: 700;
		line-height: 1.2;
	}

	.existing__meta {
		margin-top: 3px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.04em;
		opacity: 0.7;
	}

	.existing__note {
		margin-top: 12px;
		padding-top: 10px;
		border-top: 1px solid color-mix(in srgb, var(--paper) 22%, transparent);
		font-size: 12px;
		line-height: 1.5;
		opacity: 0.82;
	}

	.drawer__foot {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 14px 22px calc(14px + env(safe-area-inset-bottom, 0px));
		border-top: 2px solid var(--ink);
		background: var(--paper);
	}

	.drawer__foot .btn--red,
	.drawer__foot .btn--ink {
		flex: 1;
		justify-content: space-between;
	}

	@media (max-width: 560px) {
		.drawer {
			width: 100vw;
			border-left: 0;
			box-shadow: none;
		}

		.drawer__head {
			padding-top: calc(16px + env(safe-area-inset-top, 0px));
		}

		.drawer__body {
			padding-inline: 16px;
		}

		.drawer__foot {
			padding-inline: 16px;
		}

		.form-row {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
