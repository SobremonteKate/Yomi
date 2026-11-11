<script lang="ts">
	import type { MergeRecord, ProgressEvent, Source, Status } from '../../../shared/model.ts';
	import {
		STATUSES,
		STATUS_LABEL,
		chapterText,
		clockLabel,
		dayLabel,
		parseChapterNumber,
		relativeTime
	} from '../../../shared/model.ts';
	import { parseCapture } from '../../../shared/parse.ts';
	import { app } from '../app.svelte.ts';
	import { coverSearchTerms } from '../covers.ts';
	import Cover from './Cover.svelte';
	import Icon from './Icon.svelte';
	import MergeDialog from './MergeDialog.svelte';
	import CoverPicker from './CoverPicker.svelte';

	let { seriesId }: { seriesId: string } = $props();

	const series = $derived(app.seriesById(seriesId));
	const stats = $derived(series ? app.statsFor(series) : null);
	const readingLink = $derived(series ? app.readingLinkFor(series) : null);
	const events = $derived(app.eventsFor(seriesId));
	const sources = $derived(app.sourcesFor(seriesId));
	const absorbedBy = $derived(app.absorbedInto(seriesId));
	const absorbedRows = $derived(
		app.activeMerges.filter((merge) => merge.to_series_id === seriesId)
	);
	const coverTerms = $derived(series ? coverSearchTerms(series, sources) : []);

	let titleDraft = $state('');
	let notesDraft = $state('');
	let totalDraft = $state('');
	let coverDraft = $state('');
	let chapterInput = $state('');
	let sourceChoice = $state('');
	let pendingDeleteEvent = $state('');
	let confirmingDelete = $state(false);
	let notesTimer: ReturnType<typeof setTimeout> | null = null;
	let mergeOpen = $state(false);
	let coverPickerOpen = $state(false);
	let attachUrl = $state('');
	let attachError = $state('');
	let attaching = $state(false);
	let synopsisOpen = $state(false);
	let editingSynopsis = $state(false);
	let synopsisDraft = $state('');
	let loadingDetails = $state(false);
	let editingTags = $state(false);
	let tagsDraft = $state('');
	let loadedId = '';

	$effect(() => {
		const current = series;
		if (!current) return;
		if (loadedId !== current.id) {
			loadedId = current.id;
			titleDraft = current.title;
			notesDraft = current.notes;
			totalDraft = current.total_chapters ? String(current.total_chapters) : '';
			coverDraft = current.cover_url ?? '';
			synopsisDraft = current.description;
			synopsisOpen = false;
			editingSynopsis = false;
			editingTags = false;
			tagsDraft = current.tags.join(', ');
			chapterInput = '';
			attachUrl = '';
			attachError = '';
			confirmingDelete = false;
		}
	});

	$effect(() => {
		const list = sources;
		if (!list.some((source) => source.id === sourceChoice)) {
			sourceChoice = list[0]?.id ?? '';
		}
	});

	$effect(() => {
		const current = series;
		const draft = notesDraft;
		if (!current || loadedId !== current.id || draft === current.notes) return;
		if (notesTimer) clearTimeout(notesTimer);
		notesTimer = setTimeout(() => {
			notesTimer = null;
			void app.setField(current.id, { notes: draft });
		}, 800);
		return () => {
			if (notesTimer) {
				clearTimeout(notesTimer);
				notesTimer = null;
			}
		};
	});

	const groups = $derived.by(() => {
		const map = new Map<string, { label: string; rows: ProgressEvent[] }>();
		for (const event of events) {
			if (event.deleted_at) continue;
			const label = dayLabel(event.read_at, app.now);
			const group = map.get(label) ?? { label, rows: [] };
			group.rows.push(event);
			map.set(label, group);
		}
		return [...map.values()];
	});

	const liveEvents = $derived(events.filter((event) => !event.deleted_at));
	// The plate is narrow, so a long chapter number steps down a size or two
	// instead of spilling out of its left edge and losing the leading digit.
	const furthestDigits = $derived(String(stats?.furthest ?? '').length);
	const nudge = $derived.by(() => {
		if (!series || !stats || !stats.lastReadAt) return false;
		if (series.status !== 'dropped' && series.status !== 'completed') return false;
		const statusStamp = series.field_ts.status?.t;
		if (!statusStamp) return false;
		return Date.parse(stats.lastReadAt) - Date.parse(statusStamp) > 60_000;
	});

	function sourceFor(event: ProgressEvent): Source | undefined {
		return sources.find((source) => source.id === event.source_id);
	}

	function sourceLabel(source: Source): string {
		if (source.normalized_path.startsWith('manual:')) return 'Manual';
		if (source.site === 'comix') return 'Comix';
		if (source.site === 'mangadot') return 'MangaDot';
		return source.url ? new URL(source.url).hostname : 'Web';
	}

	function methodLabel(method: ProgressEvent['method']): string {
		if (method === 'plus_one') return '+1';
		if (method === 'userscript') return 'Script';
		if (method === 'shortcut') return 'Shortcut';
		if (method === 'import') return 'Import';
		return 'Manual';
	}

	function eventLink(event: ProgressEvent): string {
		return event.chapter_url || sourceFor(event)?.url || '';
	}

	function hostOf(url: string): string {
		try {
			const parsed = new URL(url);
			return `${parsed.hostname}${parsed.pathname}`;
		} catch {
			return url;
		}
	}

	function addedLabel(): string {
		if (!series) return '';
		const date = new Date(series.created_at);
		return Number.isFinite(date.getTime())
			? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
			: '';
	}

	async function saveTitle(): Promise<void> {
		if (!series) return;
		const clean = titleDraft.trim();
		if (!clean) {
			titleDraft = series.title;
			return;
		}
		if (clean !== series.title) await app.setField(series.id, { title: clean });
	}

	async function saveNotes(): Promise<void> {
		if (!series) return;
		if (notesDraft !== series.notes) {
			await app.setField(series.id, { notes: notesDraft });
		}
	}

	async function saveTotal(): Promise<void> {
		if (!series) return;
		const raw = totalDraft.trim().replace(',', '.');
		const parsed = raw ? Number(raw) : null;
		const value = parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
		totalDraft = value === null ? '' : String(value);
		if (value !== series.total_chapters) {
			await app.setField(series.id, { total_chapters: value });
		}
	}

	async function saveCover(): Promise<void> {
		if (!series) return;
		const value = coverDraft.trim() || null;
		await app.setField(series.id, { cover_url: value });
	}

	async function saveSynopsis(): Promise<void> {
		if (!series) return;
		editingSynopsis = false;
		const value = synopsisDraft.trim();
		if (value !== series.description) {
			await app.setField(series.id, { description: value }, 'Synopsis saved');
		}
	}

	function cancelSynopsis(): void {
		editingSynopsis = false;
		synopsisDraft = series?.description ?? '';
	}

	async function fetchDetails(): Promise<void> {
		if (!series) return;
		loadingDetails = true;
		await app.fetchDetails(series.id);
		loadingDetails = false;
		synopsisDraft = app.seriesById(series.id)?.description ?? synopsisDraft;
	}

	async function pickCover(cover: string): Promise<void> {
		if (!series) return;
		coverPickerOpen = false;
		coverDraft = cover;
		await app.setField(series.id, { cover_url: cover }, 'Cover updated');
	}

	async function setStatus(status: Status): Promise<void> {
		if (!series || series.status === status) return;
		await app.setField(series.id, { status }, `Moved to ${STATUS_LABEL[status]}`);
	}

	async function saveTags(): Promise<void> {
		if (!series) return;
		editingTags = false;
		await app.setTags(series, tagsDraft);
	}

	async function confirmReview(): Promise<void> {
		if (!series) return;
		await app.setField(series.id, { needs_review: false }, 'Marked as confirmed');
	}

	async function logTyped(): Promise<void> {
		if (!series) return;
		const value = parseChapterNumber(chapterInput);
		if (value === null) {
			app.showToast('Enter a chapter above 0');
			return;
		}
		await app.log(series.id, value, { sourceId: sourceChoice || undefined });
		chapterInput = '';
	}

	async function attach(): Promise<void> {
		if (!series) return;
		attachError = '';
		const parsed = parseCapture({ url: attachUrl });
		if (!parsed) {
			attachError = 'Use a full page URL from the address bar.';
			return;
		}
		attaching = true;
		await app.attachSource(parsed, series.id);
		attaching = false;
		attachUrl = '';
	}

	function requestDeleteEvent(event: ProgressEvent): void {
		if (pendingDeleteEvent === event.id) {
			pendingDeleteEvent = '';
			void app.removeChapter(event.id);
		} else {
			pendingDeleteEvent = event.id;
		}
	}

	async function deleteSeries(): Promise<void> {
		if (!series) return;
		if (!confirmingDelete) {
			confirmingDelete = true;
			return;
		}
		await app.removeSeries(series.id);
	}

	async function undo(merge: MergeRecord): Promise<void> {
		await app.undoMerge(merge.id);
	}
</script>

{#if !series}
	<section class="missing">
		<p class="eyebrow eyebrow--ink">Not found</p>
		<h1>That row is gone.</h1>
		<p class="lead">It may have been deleted or merged. The shelf still has everything else.</p>
		<a class="btn btn--ink" href="#/">Back to the shelf</a>
	</section>
{:else}
	<div class="detail">
		<nav class="detail__top" aria-label="Series actions">
			<a class="back" href="#/">
				<Icon name="arrow-left" size={14} />
				Shelf
			</a>
			<div class="detail__actions">
				<button
					class="btn btn--sm"
					class:btn--ink={series.queue_rank !== null}
					onclick={() => app.toggleQueue(series)}
					title={series.queue_rank !== null
						? 'Remove from the Up next queue'
						: 'Add to the Up next queue on the shelf'}
				>
					<Icon name="book" size={13} />
					{series.queue_rank !== null ? 'Queued' : 'Up next'}
				</button>
				<button class="btn btn--sm" onclick={() => (mergeOpen = true)}>
					<Icon name="merge" size={13} />
					Merge
				</button>
				<button
					class="btn btn--sm"
					class:btn--danger={confirmingDelete}
					onclick={deleteSeries}
				>
					{confirmingDelete ? 'Confirm delete' : 'Delete'}
				</button>
			</div>
		</nav>

		{#if confirmingDelete}
			<div class="delete-strip">
				<p>
					Delete <strong>{series.title}</strong> on every device? Its chapter history is removed too.
				</p>
				<div>
					<button class="btn btn--sm btn--danger" onclick={deleteSeries}>Delete it</button>
					<button class="btn btn--sm btn--ghost" onclick={() => (confirmingDelete = false)}>
						Keep
					</button>
				</div>
			</div>
		{/if}

		{#if absorbedBy}
			<div class="absorbed">
				<p>
					Merged into
					<a class="link" href={`#/s/${absorbedBy.to_series_id}`}>
						{app.titleById(absorbedBy.to_series_id)}
					</a>
					. Its URLs and chapters live there now.
				</p>
				<button class="btn btn--sm" onclick={() => undo(absorbedBy)}>
					<Icon name="undo" size={13} />
					Undo merge
				</button>
			</div>
		{/if}

		<header class="hero">
			<div class="hero__art">
				<Cover url={series.cover_url} title={series.title} size="lg" />
			</div>

			<div class="hero__copy">
				<p class="eyebrow">Series · added {addedLabel()}</p>
				<input
					class="input input--title"
					bind:value={titleDraft}
					onblur={saveTitle}
					onkeydown={(event) => {
						if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
					}}
					aria-label="Series title"
					maxlength="300"
				/>

				<div class="hero__meta">
					{#each sources as source (source.id)}
						<span class="tag">{sourceLabel(source)}</span>
					{/each}
					<span class="tag">
						{liveEvents.length}
						{liveEvents.length === 1 ? 'chapter' : 'chapters'} logged
					</span>
					{#if series.needs_review}
						<span class="tag tag--red">Check parsing</span>
					{/if}
					{#if series.total_chapters}
						<span class="tag">
							{stats?.percent !== null && stats?.percent !== undefined
								? `${Math.round(stats.percent)}%`
								: '—'}
						</span>
					{/if}
				</div>

				<div class="chapter-cta">
					{#if readingLink}
						<a
							class="btn btn--red"
							href={readingLink.url}
							target="_blank"
							rel="noreferrer"
							title={readingLink.url}
							aria-label={`${app.readingLabel(readingLink)} in a new tab`}
						>
							<Icon name="external" size={14} />
							{app.readingLabel(readingLink)}
						</a>
					{/if}
					<button class="btn btn--ink" onclick={() => app.plusOne(series)}>
						<Icon name="plus" size={13} stroke={2} />
						Log ch. {chapterText(stats?.nextChapter ?? 1)}
					</button>
				</div>

				{#if series.needs_review}
					<div class="review">
						<p>
							This row was inferred from a URL. The title or chapter may need a look before you rely
							on it.
						</p>
						<button class="btn btn--sm" onclick={confirmReview}>
							<Icon name="check" size={13} />
							Looks right
						</button>
					</div>
				{/if}

				<div class="statuses" role="group" aria-label="Shelf">
					{#each STATUSES as status (status)}
						<button
							class="status"
							class:status--active={series.status === status}
							aria-pressed={series.status === status}
							onclick={() => setStatus(status)}
						>
							{STATUS_LABEL[status]}
						</button>
					{/each}
				</div>

				<div class="verdict">
					<div class="rating" role="group" aria-label="Your score out of ten">
						<span class="verdict__label mono">Score</span>
						<span class="rating__dots">
							{#each Array(10) as _, index (index)}
								<button
									class="rating__dot"
									class:is-on={(series.rating ?? 0) > index}
									aria-label={`Rate ${index + 1} of 10`}
									aria-pressed={series.rating === index + 1}
									onclick={() => app.setRating(series, index + 1)}
								></button>
							{/each}
						</span>
						<span class="rating__value mono">
							{series.rating !== null ? `${series.rating}/10` : 'unrated'}
						</span>
						{#if series.rating !== null}
							<button class="rating__clear" onclick={() => app.setRating(series, null)}>
								clear
							</button>
						{/if}
					</div>
					<div class="verdict__tags">
						<span class="verdict__label mono">Tags</span>
						{#if editingTags}
							<input
								class="input input--tags"
								bind:value={tagsDraft}
								onblur={saveTags}
								onkeydown={(event) => {
									if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
								if (event.key === 'Escape') {
									editingTags = false;
									tagsDraft = series.tags.join(', ');
								}
							}}
								placeholder="isekai, romance, slow burn"
								aria-label="Tags, separated by commas"
							/>
						{:else}
							{#each series.tags as tag (tag)}
								<button
									class="tag tag--link"
									title={`Filter the shelf by ${tag}`}
									onclick={() => {
										app.tagFilter = tag;
										app.navigate('library');
									}}
								>
									{tag}
								</button>
							{/each}
							<button
								class="tag-add"
								onclick={() => {
									tagsDraft = series.tags.join(', ');
									editingTags = true;
								}}
							>
								{series.tags.length > 0 ? 'Edit tags' : '+ Add tags'}
							</button>
						{/if}
					</div>
				</div>

				{#if nudge}
					<div class="nudge">
						<p>
							You logged chapter {stats?.furthest} after marking this as
							{STATUS_LABEL[series.status].toLowerCase()}.
						</p>
						<button class="btn btn--sm" onclick={() => setStatus('reading')}>
							Set to reading
						</button>
					</div>
				{/if}
			</div>

			<div
				class="counter plate"
				aria-label={`Furthest chapter ${stats?.furthest ?? 0}${series.total_chapters ? ` of ${series.total_chapters}` : ''}; ${liveEvents.length} logged`}
			>
				<span class="counter__label">Furthest</span>
				<div class="counter__fraction">
					{#key stats?.furthest}
						<strong
							class="counter__number"
							class:is-three={furthestDigits === 3}
							class:is-four={furthestDigits >= 4}
						>
							{stats?.furthest ?? '—'}
						</strong>
					{/key}
					<span class="counter__slash" aria-hidden="true">/</span>
					<input
						class="counter__total"
						bind:value={totalDraft}
						onblur={saveTotal}
						onkeydown={(event) => {
							if (event.key === 'Enter') (event.currentTarget as HTMLInputElement).blur();
						}}
						placeholder="—"
						inputmode="decimal"
						aria-label="Total chapters"
						title="Total chapters — the latest chapter out, even while the series is ongoing"
					/>
				</div>
				<div class="counter__bar" aria-hidden="true">
					<span style={`width:${Math.max(stats?.percent ?? 0, liveEvents.length ? 3 : 0)}%`}></span>
				</div>
				<span class="counter__last">
					{stats?.lastReadAt ? `Last read ${relativeTime(stats.lastReadAt, app.now)}` : 'Not started'}
				</span>
			</div>
		</header>

		<div class="detail__grid">
			<div class="main-col">
				<section class="synopsis" aria-labelledby="synopsis-title">
					<header class="synopsis__head">
						<p class="eyebrow eyebrow--ink" id="synopsis-title">Synopsis</p>
						<div class="synopsis__tools">
							{#if !editingSynopsis}
								<button
									class="btn btn--sm btn--ghost"
									type="button"
									onclick={fetchDetails}
									disabled={loadingDetails}
									title="Fetch the synopsis, cover and chapter total from AniList"
								>
									<Icon name="search" size={12} />
									{loadingDetails ? 'Looking…' : 'Fetch'}
								</button>
								<button
									class="btn btn--sm btn--ghost"
									type="button"
									onclick={() => {
										synopsisDraft = series.description;
										editingSynopsis = true;
										synopsisOpen = true;
									}}
								>
									{series.description ? 'Edit' : 'Write one'}
								</button>
							{/if}
						</div>
					</header>

					{#if editingSynopsis}
						<textarea
							class="textarea synopsis__area"
							bind:value={synopsisDraft}
							placeholder="What this series is about. Kept as plain text, synced everywhere."
							maxlength="4000"
							rows="6"
							aria-label="Synopsis"
						></textarea>
						<div class="synopsis__actions">
							<button class="btn btn--sm" type="button" onclick={saveSynopsis}>
								Save synopsis
							</button>
							<button class="btn btn--sm btn--ghost" type="button" onclick={cancelSynopsis}>
								Cancel
							</button>
							<span class="mono synopsis__count">{synopsisDraft.length} / 4000</span>
						</div>
					{:else if series.description}
						<p
							class="synopsis__text"
							class:is-clamped={!synopsisOpen && series.description.length > 320}
						>
							{series.description}
						</p>
						{#if series.description.length > 320}
							<button
								class="synopsis__more"
								type="button"
								onclick={() => (synopsisOpen = !synopsisOpen)}
							>
								{synopsisOpen ? 'Show less' : 'Read on'}
							</button>
						{/if}
					{:else}
						<p class="synopsis__empty">
							No synopsis yet. Fetch one from AniList, or write your own — it stays plain text
							and syncs with the rest of the row.
						</p>
					{/if}
				</section>

				<section class="logform" aria-labelledby="logform-title">
					<header class="logform__head">
						<div>
							<p class="eyebrow eyebrow--ink">Append-only</p>
							<h2 class="section-title" id="logform-title">Log a chapter</h2>
						</div>
						<span class="logform__next">Next: ch. {chapterText(stats?.nextChapter ?? 1)}</span>
					</header>
					<div class="logform__row">
						<input
							class="input input--mono"
							bind:value={chapterInput}
							placeholder="Chapter, e.g. 149 or 42.5"
							inputmode="decimal"
							aria-label="Chapter number"
							onkeydown={(event) => {
								if (event.key === 'Enter') void logTyped();
							}}
						/>
						{#if sources.length > 1}
							<select class="select select--source" bind:value={sourceChoice} aria-label="Site">
								{#each sources as source (source.id)}
									<option value={source.id}>{sourceLabel(source)}</option>
								{/each}
							</select>
						{/if}
						<button class="btn btn--ink logform__submit" onclick={logTyped}>
							Log chapter
						</button>
						<button
							class="btn btn--red logform__plus"
							onclick={() => app.plusOne(series)}
							aria-label={`Log chapter ${chapterText(stats?.nextChapter ?? 1)}`}
							title={`Log chapter ${chapterText(stats?.nextChapter ?? 1)}`}
						>
							+1
						</button>
					</div>
					<p class="logform__hint">
						Typing a lower chapter records a re-read without moving the counter backwards.
					</p>
				</section>

				<section class="log" aria-labelledby="log-title">
					<header class="log__head">
						<h2 class="section-title" id="log-title">Chapter log</h2>
						<span class="mono log__count">
							{liveEvents.length}
							{liveEvents.length === 1 ? 'entry' : 'entries'}
						</span>
					</header>

					{#if groups.length === 0}
						<div class="log__empty">
							<p>No chapters yet. Use <span class="mono">+1</span> above to log the first one.</p>
						</div>
					{:else}
						{#each groups as group (group.label)}
							<div class="day">
								<span class="day__label">{group.label}</span>
								<span class="day__rule" aria-hidden="true"></span>
							</div>
							{#each group.rows as event, row (event.id)}
								{@const source = sourceFor(event)}
								{@const link = eventLink(event)}
								<div class="event" style={`animation-delay:${Math.min(row, 8) * 26}ms`}>
									<div class="event__main">
										<p class="event__chapter">{event.chapter_label}</p>
										<p class="event__meta">
											{source ? sourceLabel(source) : 'Unknown site'}
											<span class="slash">/</span>
											{methodLabel(event.method)}
											<span class="slash">/</span>
											{clockLabel(event.read_at)}
											<span class="slash">/</span>
											<span class="event__no">#{chapterText(event.chapter)}</span>
										</p>
									</div>
									<div class="event__actions">
										{#if link}
											<a
												class="event__link"
												href={link}
												target="_blank"
												rel="noreferrer"
												aria-label={`Open ${event.chapter_label}`}
												title={link}
											>
												<Icon name="external" size={14} />
											</a>
										{/if}
										<button
											class="event__remove"
											class:event__remove--ask={pendingDeleteEvent === event.id}
											onclick={() => requestDeleteEvent(event)}
											onblur={() => (pendingDeleteEvent = '')}
											aria-label={
												pendingDeleteEvent === event.id ? 'Confirm remove chapter' : 'Remove chapter'
											}
											title="Remove this entry"
										>
											{#if pendingDeleteEvent === event.id}
												<span>Remove?</span>
											{:else}
												<Icon name="trash" size={13} />
											{/if}
										</button>
									</div>
								</div>
							{/each}
						{/each}
					{/if}
				</section>

				<section class="notes" aria-labelledby="notes-title">
					<header class="notes__head">
						<h2 class="section-title" id="notes-title">Notes</h2>
						<span class="mono notes__hint">saved automatically</span>
					</header>
					<textarea
						class="textarea notes__area"
						bind:value={notesDraft}
						onblur={saveNotes}
						placeholder="Where you left off, translation quirks, the arc you're waiting on…"
						maxlength="20000"
					></textarea>
				</section>
			</div>

			<aside class="side-col">
				<section class="sources" aria-labelledby="sources-title">
					<header class="side-head">
						<h2 class="section-title" id="sources-title">Site URLs</h2>
						<span class="mono">{sources.length}</span>
					</header>
					<ul class="source-list">
						{#each sources as source (source.id)}
							<li class="source">
								<span class="source__site">{sourceLabel(source)}</span>
								{#if source.url}
									<a
										class="source__url"
										href={source.url}
										target="_blank"
										rel="noreferrer"
										title={source.url}
									>
										{hostOf(source.url)}
									</a>
								{:else}
									<span class="source__url source__url--muted">Added by hand</span>
								{/if}
								{#if source.url}
									<a
										class="source__open"
										href={source.url}
										target="_blank"
										rel="noreferrer"
										aria-label={`Open ${sourceLabel(source)}`}
									>
										<Icon name="external" size={12} />
									</a>
								{/if}
							</li>
						{/each}
					</ul>

					<form
						class="attach"
						onsubmit={(event) => {
							event.preventDefault();
							void attach();
						}}
					>
						<label class="field">
							<span class="field__label">Attach another URL</span>
							<input
								class="input input--mono"
								bind:value={attachUrl}
								placeholder="https://mangadot.net/manga/…"
								spellcheck="false"
								autocapitalize="off"
							/>
						</label>
						{#if attachError}
							<p class="attach__error">{attachError}</p>
						{/if}
						<button class="btn btn--sm" type="submit" disabled={!attachUrl.trim() || attaching}>
							{attaching ? 'Attaching…' : 'Attach URL'}
						</button>
					</form>

					<button class="merge-link" onclick={() => (mergeOpen = true)}>
						<Icon name="merge" size={13} />
						Merge this row into another
					</button>
				</section>

				<section class="meta-block">
					<header class="side-head">
						<h2 class="section-title">Details</h2>
					</header>
					<div class="meta-fields">
						<label class="field">
							<span class="field__label">Total chapters</span>
							<input
								class="input input--mono"
								bind:value={totalDraft}
								onblur={saveTotal}
								placeholder="unknown"
								inputmode="decimal"
							/>
						</label>
						<label class="field">
							<span class="field__label">Cover image URL</span>
							<input
								class="input input--mono"
								bind:value={coverDraft}
								onblur={saveCover}
								placeholder="optional, link only"
								spellcheck="false"
							/>
						</label>
						<button
							class="btn btn--sm btn--ghost cover-find"
							type="button"
							onclick={() => (coverPickerOpen = true)}
						>
							<Icon name="search" size={13} />
							Find cover
						</button>
						{#if series.alt_titles.length > 0}
							<p class="alt-titles">
								<span class="field__label">Also known as</span>
								{series.alt_titles.join(' · ')}
							</p>
						{/if}
					</div>
				</section>

				{#if absorbedRows.length > 0}
					<section class="absorbed-list">
						<header class="side-head">
							<h2 class="section-title">Absorbed rows</h2>
						</header>
						{#each absorbedRows as merge (merge.id)}
							<div class="absorbed-row">
								<p>
									{app.titleById(merge.from_series_id)}
									<span class="mono">· {merge.moved_source_ids.length} URL(s)</span>
								</p>
								<button class="btn btn--sm btn--ghost" onclick={() => undo(merge)}>
									Undo
								</button>
							</div>
						{/each}
					</section>
				{/if}
			</aside>
		</div>
	</div>
{/if}

{#if coverPickerOpen && series}		<CoverPicker
			queries={coverTerms}
			onClose={() => (coverPickerOpen = false)}
			onPick={pickCover}
		/>
{/if}

{#if mergeOpen && series}
	<MergeDialog fromId={series.id} onClose={() => (mergeOpen = false)} />
{/if}

<style>
	.detail {
		padding-block: 22px 70px;
	}

	.detail__top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
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

	.detail__actions {
		display: flex;
		gap: 6px;
	}

	.delete-strip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-top: 12px;
		padding: 10px 12px;
		border: 1px solid var(--red);
		border-left-width: 4px;
		background: color-mix(in srgb, var(--red) 5%, var(--paper));
		font-size: 12px;
	}

	.delete-strip > div {
		display: flex;
		gap: 6px;
		flex: 0 0 auto;
	}

	.absorbed {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-top: 14px;
		padding: 12px 14px;
		background: var(--ink);
		color: var(--paper);
		font-size: 12px;
	}

	.absorbed .link {
		color: var(--paper);
	}

	.hero {
		display: grid;
		grid-template-columns: 92px minmax(0, 1fr) 196px;
		gap: clamp(16px, 2.6vw, 28px);
		align-items: start;
		margin-top: 22px;
		padding-bottom: 26px;
		border-bottom: 2px solid var(--ink);
	}

	.hero__art {
		padding-top: 5px;
	}

	.hero__copy {
		min-width: 0;
	}

	.synopsis {
		padding: 16px 0 18px;
		border-bottom: 1px solid var(--rule);
	}

	.synopsis__head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
	}

	.synopsis__tools {
		display: flex;
		gap: 6px;
	}

	.synopsis__text {
		font-size: 13.5px;
		line-height: 1.65;
		color: var(--ink-2);
		white-space: pre-line;
		max-width: 66ch;
	}

	.synopsis__text.is-clamped {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		line-clamp: 4;
		-webkit-line-clamp: 4;
		overflow: hidden;
	}

	.synopsis__more {
		margin-top: 6px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink);
		border-bottom: 1px solid var(--red);
	}

	.synopsis__more:hover {
		color: var(--red);
	}

	.synopsis__empty {
		max-width: 60ch;
		font-size: 12px;
		line-height: 1.6;
		color: var(--ink-3);
	}

	.synopsis__area {
		min-height: 132px;
	}

	.synopsis__actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 8px;
	}

	.synopsis__count {
		margin-left: auto;
		font-size: 8px;
		letter-spacing: 0.06em;
		color: var(--ink-3);
	}

	.input--title {
		width: calc(100% + 8px);
		margin-left: -4px;
		margin-top: 5px;
	}

	.hero__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-top: 10px;
	}

	.review {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		margin-top: 13px;
		padding: 9px 11px;
		border: 1px solid var(--red);
		border-left-width: 4px;
		background: color-mix(in srgb, var(--red) 6%, var(--paper));
		font-size: 11px;
		line-height: 1.45;
	}

	.review .btn {
		flex: 0 0 auto;
	}

	.chapter-cta {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 14px;
	}

	.chapter-cta .btn {
		min-height: 38px;
	}

	.statuses {
		display: flex;
		flex-wrap: wrap;
		gap: 0;
		margin-top: 16px;
		border: 1px solid var(--ink);
		width: fit-content;
	}

	.status {
		min-height: 31px;
		padding: 6px 9px;
		border-right: 1px solid var(--rule);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
	}

	.status:last-child {
		border-right: 0;
	}

	.status:hover {
		background: var(--paper-2);
		color: var(--ink);
	}

	.status--active,
	.status--active:hover {
		background: var(--ink);
		color: var(--paper);
	}

	.verdict {
		display: grid;
		gap: 7px;
		margin-top: 12px;
	}

	.rating,
	.verdict__tags {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex-wrap: wrap;
	}

	.verdict__label {
		font-size: 8px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-3);
		min-width: 38px;
	}

	.rating__dots {
		display: inline-flex;
		gap: 3px;
	}

	.rating__dot {
		width: 13px;
		height: 13px;
		padding: 0;
		border: 1px solid var(--ink-3);
		background: transparent;
		cursor: pointer;
		transition: background 120ms ease, border-color 120ms ease;
	}

	.rating__dot:hover {
		border-color: var(--red);
	}

	.rating__dot.is-on {
		background: var(--red);
		border-color: var(--red);
	}

	.rating__value {
		font-size: 8px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-2);
		min-width: 46px;
	}

	.rating__clear {
		padding: 0;
		border: 0;
		background: none;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-3);
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}

	.input--tags {
		flex: 1 1 180px;
		min-width: 0;
		padding: 5px 8px;
		font-size: 11px;
	}

	.tag--link,
	.tag-add {
		padding: 3px 8px;
		border: 1px solid var(--rule);
		background: var(--paper);
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
		cursor: pointer;
	}

	.tag--link:hover,
	.tag-add:hover {
		border-color: var(--ink);
		color: var(--ink);
	}

	.tag-add {
		border-style: dashed;
		color: var(--ink-3);
	}

	.nudge {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		margin-top: 10px;
		padding: 9px 11px;
		border-left: 4px solid var(--red);
		background: var(--paper-2);
		font-size: 11px;
		line-height: 1.45;
	}

	.counter {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		min-width: 0;
		padding: 12px 14px 13px;
		box-shadow: 4px 4px 0 var(--red);
	}

	.counter__label {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		opacity: 0.62;
	}

	.counter__number {
		font-family: var(--display);
		font-size: clamp(46px, 6vw, 62px);
		font-weight: 400;
		line-height: 0.98;
		letter-spacing: -0.04em;
		animation: yomi-stamp 220ms ease-out;
	}

	.counter__fraction {
		display: flex;
		align-items: baseline;
		justify-content: flex-end;
		gap: 2px;
		max-width: 100%;
	}

	.counter__number.is-three {
		font-size: 46px;
	}

	.counter__number.is-four {
		font-size: 34px;
	}

	.counter__slash {
		font-family: var(--mono);
		font-size: 15px;
		opacity: 0.45;
	}

	.counter__total {
		width: 4.2ch;
		padding: 0 0 1px;
		border: 0;
		border-bottom: 1px dotted color-mix(in srgb, currentColor 40%, transparent);
		background: transparent;
		color: inherit;
		font-family: var(--mono);
		font-size: 15px;
		line-height: 1.4;
		letter-spacing: 0;
		text-align: left;
	}

	.counter__total::placeholder {
		color: inherit;
		opacity: 0.45;
	}

	.counter__total:focus {
		outline: none;
		border-bottom-color: var(--red);
		border-bottom-style: solid;
	}

	.counter__bar {
		width: 100%;
		height: 3px;
		margin-top: 9px;
		background: color-mix(in srgb, var(--paper) 24%, transparent);
	}

	.counter__bar span {
		display: block;
		height: 100%;
		background: var(--red);
	}

	.counter__last {
		margin-top: 6px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.03em;
		opacity: 0.62;
		text-align: right;
	}

	.detail__grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 310px;
		gap: clamp(24px, 4vw, 46px);
		align-items: start;
		margin-top: 30px;
	}

	.main-col {
		min-width: 0;
	}

	.side-col {
		display: flex;
		flex-direction: column;
		gap: 26px;
		position: sticky;
		top: 96px;
	}

	.section-title {
		font-family: var(--display);
		font-size: 21px;
		font-weight: 400;
		line-height: 1.05;
		letter-spacing: -0.02em;
	}

	.side-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 14px;
		padding-bottom: 9px;
		border-bottom: 1.5px solid var(--ink);
	}

	.logform {
		padding: 16px 17px 14px;
		border: 1.5px solid var(--ink);
		background: var(--paper-2);
	}

	.logform__head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 14px;
	}

	.logform__next {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
	}

	.logform__row {
		display: flex;
		align-items: stretch;
		gap: 7px;
		margin-top: 13px;
	}

	.logform__row .input {
		flex: 1;
		min-width: 0;
	}

	.select--source {
		width: auto;
		max-width: 130px;
		font-family: var(--mono);
		font-size: 10px;
		text-transform: uppercase;
	}

	.logform__submit {
		flex: 0 0 auto;
	}

	.logform__plus {
		width: 48px;
		flex: 0 0 auto;
		font-size: 14px;
		font-family: var(--mono);
		padding-inline: 0;
	}

	.logform__hint {
		margin-top: 8px;
		font-size: 10px;
		line-height: 1.45;
		color: var(--ink-3);
	}

	.log {
		margin-top: 28px;
	}

	.log__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 14px;
		padding-bottom: 9px;
		border-bottom: 2px solid var(--ink);
	}

	.log__count {
		font-size: 9px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-2);
	}

	.log__empty {
		padding: 26px 2px;
		border-bottom: 1px solid var(--rule);
		font-size: 13px;
		color: var(--ink-2);
	}

	.event {
		animation: yomi-rise-soft 280ms ease-out both;
	}

	.day {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-top: 15px;
	}

	.day__label {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
		white-space: nowrap;
	}

	.day__rule {
		flex: 1;
		height: 1px;
		background: var(--rule);
	}

	.event {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 9px 2px;
		border-bottom: 1px solid var(--rule);
	}

	.event__main {
		min-width: 0;
	}

	.event__chapter {
		font-size: 13px;
		font-weight: 700;
		line-height: 1.3;
	}

	.event__meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px;
		margin-top: 2px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.035em;
		color: var(--ink-3);
		text-transform: uppercase;
	}

	.slash {
		opacity: 0.5;
	}

	.event__no {
		color: var(--ink-2);
	}

	.event__actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex: 0 0 auto;
	}

	.event__link,
	.event__remove {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		color: var(--ink-2);
	}

	.event__link:hover {
		color: var(--red);
	}

	.event__remove:hover {
		color: var(--red);
	}

	.event__remove--ask {
		width: auto;
		padding-inline: 6px;
		font-family: var(--mono);
		font-size: 8px;
		text-transform: uppercase;
		color: var(--red);
	}

	.notes {
		margin-top: 28px;
	}

	.notes__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding-bottom: 9px;
		border-bottom: 1.5px solid var(--ink);
	}

	.notes__hint {
		font-size: 8px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.notes__area {
		margin-top: 11px;
		min-height: 120px;
		border-color: var(--rule);
		background: transparent;
	}

	.notes__area:focus {
		border-color: var(--ink);
	}

	.source-list {
		border-top: 1px solid var(--rule);
	}

	.source {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 24px;
		align-items: center;
		gap: 8px;
		padding: 9px 0;
		border-bottom: 1px solid var(--rule);
	}

	.source__site {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		padding: 2px 5px;
		border: 1px solid var(--ink);
		white-space: nowrap;
	}

	.source__url {
		font-family: var(--mono);
		font-size: 9px;
		color: var(--ink-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.source__url:hover {
		color: var(--red);
	}

	.source__url--muted {
		font-style: italic;
	}

	.source__open {
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		color: var(--ink-2);
	}

	.source__open:hover {
		color: var(--red);
	}

	.attach {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 15px;
	}

	.attach .btn {
		align-self: flex-start;
	}

	.attach__error {
		font-size: 11px;
		line-height: 1.4;
		color: var(--red);
	}

	.merge-link {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-top: 18px;
		padding-top: 12px;
		border-top: 1px solid var(--rule);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.03em;
		color: var(--ink-2);
		text-align: left;
	}

	.merge-link:hover {
		color: var(--red);
	}

	.meta-block {
		padding-top: 2px;
	}

	.meta-fields {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-top: 12px;
	}

	.cover-find {
		align-self: flex-start;
	}

	.alt-titles {
		font-size: 11px;
		line-height: 1.5;
		color: var(--ink-2);
	}

	.alt-titles .field__label {
		display: block;
		margin-bottom: 3px;
	}

	.absorbed-list {
		padding-top: 2px;
	}

	.absorbed-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 9px 0;
		border-bottom: 1px solid var(--rule);
		font-size: 11px;
	}

	.absorbed-row .mono {
		font-size: 8px;
		color: var(--ink-3);
	}

	.missing {
		padding-block: 70px;
		max-width: 480px;
	}

	.missing h1 {
		margin-top: 6px;
		font-family: var(--display);
		font-size: 40px;
		font-weight: 400;
		line-height: 1;
	}

	.missing .lead {
		margin-top: 12px;
		margin-bottom: 20px;
	}

	@media (max-width: 980px) {
		.hero {
			grid-template-columns: 80px minmax(0, 1fr);
		}

		.hero__art :global(.cover) {
			width: 80px;
			height: 112px;
		}

		.counter {
			grid-column: 1 / -1;
			display: grid;
			grid-template-columns: auto auto 1fr;
			align-items: baseline;
			column-gap: 10px;
			padding: 10px 13px;
		}

		.counter__fraction {
			grid-column: 1 / 3;
			grid-row: 2;
		}

		/* The plate is full-width here, so the number is never squeezed. */
		.counter__number,
		.counter__number.is-three,
		.counter__number.is-four {
			font-size: 40px;
		}

		.counter__label {
			grid-column: 1 / -1;
			grid-row: 1;
		}

		.counter__bar {
			grid-column: 3;
			grid-row: 2;
			margin: 0;
			align-self: center;
		}

		.counter__last {
			grid-column: 1 / -1;
			margin-top: 5px;
			text-align: left;
		}

		.detail__grid {
			grid-template-columns: 1fr;
		}

		.side-col {
			position: static;
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 28px;
			align-items: start;
		}

		.absorbed-list {
			grid-column: 1 / -1;
		}
	}

	@media (max-width: 640px) {
		.detail {
			padding-top: 16px;
		}

		.detail__top {
			align-items: flex-start;
			flex-direction: column;
			gap: 10px;
		}

		.detail__actions {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			width: 100%;
			gap: 5px;
		}

		.detail__actions .btn {
			width: 100%;
			min-height: 38px;
			padding-inline: 5px;
			font-size: 9px;
		}

		.chapter-cta .btn {
			flex: 1 1 140px;
			min-height: 44px;
		}

		.hero {
			grid-template-columns: 64px minmax(0, 1fr);
			gap: 13px;
		}

		.hero__art :global(.cover) {
			width: 64px;
			height: 90px;
		}

		.hero__copy {
			grid-column: 1 / -1;
		}

		.hero__art {
			display: none;
		}

		.input--title {
			font-size: 28px;
		}

		.statuses {
			width: 100%;
			display: grid;
			grid-template-columns: repeat(3, 1fr);
		}

		.status {
			min-height: 42px;
			border-bottom: 1px solid var(--rule);
		}

		.rating__dots {
			gap: 4px;
		}

		.rating__dot {
			width: 20px;
			height: 20px;
		}

		.rating__clear,
		.tag-add {
			min-height: 32px;
		}

		.event__link,
		.event__remove {
			width: 38px;
			height: 38px;
		}

		.logform__plus {
			min-height: 44px;
		}

		.logform__submit {
			min-height: 44px;
		}

		.status:nth-child(3n) {
			border-right: 0;
		}

		.status:nth-last-child(-n + 2) {
			border-bottom: 0;
		}

		.logform__row {
			flex-wrap: wrap;
		}

		.logform__row .input {
			flex-basis: 100%;
		}

		.logform__submit {
			flex: 1;
		}

		.side-col {
			grid-template-columns: 1fr;
		}

		.delete-strip,
		.absorbed,
		.review,
		.nudge {
			align-items: flex-start;
			flex-direction: column;
		}

		.event__chapter {
			font-size: 12px;
		}
	}
</style>
