<script lang="ts">
	import { onDestroy } from 'svelte';
	import { STATUSES, STATUS_LABEL } from '../../../shared/model.ts';
	import type { Status } from '../../../shared/model.ts';
	import { statusLabel } from '../app.svelte.ts';
	import { app } from '../app.svelte.ts';
	import { pruneSelection, toggleSelection } from '../selection.ts';
	import ContinuePanel from './ContinuePanel.svelte';
	import Icon from './Icon.svelte';
	import SeriesRow from './SeriesRow.svelte';
	import UpNext from './UpNext.svelte';
	import { SHELF_SORTS, SHELF_SORT_LABEL } from '../shelf.ts';
	import type { Filter } from '../app.svelte.ts';

	const filters = $derived<{ key: Filter; label: string }[]>([
		{ key: 'reading', label: 'Reading' },
		{ key: 'all', label: 'All' },
		{ key: 'plan_to_read', label: 'Plan' },
		{ key: 'on_hold', label: 'On hold' },
		{ key: 'completed', label: 'Completed' },
		{ key: 'dropped', label: 'Dropped' },
		...(app.counts.review > 0 ? [{ key: 'review' as Filter, label: 'Check' }] : [])
	]);

	const continuation = $derived(app.continueEntry);
	const rows = $derived(app.filteredSeries);
	const searching = $derived(app.shelfQuery.trim().length > 0);

	// Selection mode is shelf-local: it resets on navigation and on any filter
	// change, so a count never includes rows you cannot see.
	let selecting = $state(false);
	let chosen = $state<string[]>([]);
	let anchor = $state<string | null>(null);
	let searchInput: HTMLInputElement | undefined = $state();

	// Delete takes two taps: the first only arms it, briefly.
	let deleteArmed = $state(false);
	let armTimer: ReturnType<typeof setTimeout> | undefined;
	onDestroy(() => clearTimeout(armTimer));

	const rowIds = $derived(rows.map((row) => row.id));
	const selected = $derived(pruneSelection(chosen, rowIds));
	const selectedRows = $derived(rows.filter((row) => selected.includes(row.id)));
	const reviewCount = $derived(selectedRows.filter((row) => row.needs_review).length);
	const allSelected = $derived(rows.length > 0 && selected.length === rows.length);

	// The action bar parks under the masthead while a long shelf scrolls past,
	// so it needs to know how tall that masthead actually is at this width.
	$effect(() => {
		const masthead = document.querySelector<HTMLElement>('.masthead');
		const measure = () => {
			if (!masthead) return;
			document.documentElement.style.setProperty(
				'--bulk-top',
				`${Math.round(masthead.getBoundingClientRect().height)}px`
			);
		};
		measure();
		const observer = masthead ? new ResizeObserver(measure) : null;
		if (masthead && observer) observer.observe(masthead);
		return () => {
			observer?.disconnect();
			document.documentElement.style.removeProperty('--bulk-top');
		};
	});

	function startSelecting(): void {
		selecting = true;
		chosen = [];
		anchor = null;
	}

	function stopSelecting(): void {
		selecting = false;
		chosen = [];
		anchor = null;
		disarmDelete();
	}

	function toggleRow(id: string, event: MouseEvent): void {
		chosen = toggleSelection(selected, rowIds, id, event.shiftKey ? anchor : null);
		// The anchor stays put across a shift-click so the run can be grown.
		if (!event.shiftKey) anchor = id;
		disarmDelete();
	}

	function toggleAll(): void {
		chosen = allSelected ? [] : [...rowIds];
		anchor = null;
		disarmDelete();
	}

	async function moveSelected(status: Status): Promise<void> {
		const ids = selected;
		if (ids.length === 0) return;
		stopSelecting();
		await app.setStatusMany(ids, status);
	}

	async function confirmParsing(): Promise<void> {
		const ids = selectedRows.filter((row) => row.needs_review).map((row) => row.id);
		if (ids.length === 0) return;
		stopSelecting();
		await app.confirmParsingMany(ids);
	}

	async function logNext(): Promise<void> {
		const ids = selected;
		if (ids.length === 0) return;
		stopSelecting();
		await app.plusOneMany(ids);
	}

	function disarmDelete(): void {
		clearTimeout(armTimer);
		deleteArmed = false;
	}

	function armDelete(): void {
		if (selected.length === 0) return;
		if (deleteArmed) {
			disarmDelete();
			void removeSelected();
			return;
		}
		deleteArmed = true;
		clearTimeout(armTimer);
		armTimer = setTimeout(disarmDelete, 4000);
	}

	async function removeSelected(): Promise<void> {
		const ids = selected;
		if (ids.length === 0) return;
		stopSelecting();
		await app.deleteMany(ids);
	}

	/** A shelf every selected row already sits on has nothing to do. */
	function settledOn(status: Status): boolean {
		return selectedRows.length > 0 && selectedRows.every((row) => row.status === status);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (selecting) {
			if (event.key === 'Escape') {
				stopSelecting();
				return;
			}
			// "a" takes the whole shelf. Ignore it while a field has focus so
			// typing stays typing.
			if (
				event.key.toLowerCase() !== 'a' ||
				event.metaKey ||
				event.ctrlKey ||
				event.altKey ||
				isTyping(event)
			) {
				return;
			}
			event.preventDefault();
			toggleAll();
			return;
		}

		if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event)) return;
		if (event.key === '/') {
			event.preventDefault();
			searchInput?.focus();
			searchInput?.select();
			return;
		}
		if (event.key.toLowerCase() === 'n') {
			event.preventDefault();
			app.openAdd();
		}
	}

	function isTyping(event: KeyboardEvent): boolean {
		const target = event.target as HTMLElement | null;
		return Boolean(
			target &&
				(target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.tagName === 'SELECT' ||
					target.isContentEditable)
		);
	}

	function countFor(key: Filter): string {
		return String(app.counts[key]).padStart(2, '0');
	}

	function setFilter(key: Filter): void {
		app.filter = key;
		// A selection belongs to the shelf it was made on.
		chosen = [];
		anchor = null;
		disarmDelete();
	}

	function shelfTitle(): string {
		if (app.filter === 'review') return 'Check parsing';
		if (app.filter === 'all') return 'Everything';
		return statusLabel(app.filter as Status);
	}

	function clearSearch(): void {
		app.shelfQuery = '';
	}

	// A query narrows the shelf, so a selection made before typing must not
	// survive into a different set of rows.
	$effect(() => {
		app.shelfQuery;
		chosen = [];
		anchor = null;
		disarmDelete();
	});
</script>

<svelte:window onkeydown={onKeydown} />	<div class="library">
	<aside class="rail" aria-label="Shelf filters">
		<div class="rail__head">
			<span class="eyebrow eyebrow--ink">Shelf</span>
			<span class="rail__count mono">{countFor('all')}</span>
		</div>

		<nav class="filters">
			{#each filters as item (item.key)}
				<button
					class="filter"
					class:filter--active={app.filter === item.key}
					aria-pressed={app.filter === item.key}
					onclick={() => setFilter(item.key)}
				>
					<span class="filter__label">{item.label}</span>
					<span class="filter__count">{countFor(item.key)}</span>
				</button>
			{/each}
		</nav>

		{#if app.allTags.length > 0}
			<div class="rail__tags">
				<div class="rail__tags-head">
					<span class="eyebrow eyebrow--ink">Tags</span>
					{#if app.tagFilter}
						<button class="rail__tags-clear" onclick={() => (app.tagFilter = '')}>
							clear
						</button>
					{/if}
				</div>
				<div class="tag-cloud">
					{#each app.allTags.slice(0, 10) as entry (entry.tag)}
						<button
							class="tag-chip"
							class:tag-chip--on={app.tagFilter === entry.tag}
							aria-pressed={app.tagFilter === entry.tag}
							onclick={() => (app.tagFilter = app.tagFilter === entry.tag ? '' : entry.tag)}
						>
							{entry.tag}
							<span class="tag-chip__count">{entry.count}</span>
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<div class="rail__foot">
			<p class="rail__note">
				One series. Every site URL. Progress adds up, never overwrites.
			</p>
			<a class="rail__link" href="#/settings">
				Set up capture
				<Icon name="arrow-right" size={13} />
			</a>
		</div>
	</aside>

	<main class="main">
		{#if continuation}
			<ContinuePanel series={continuation.series} stats={continuation.stats} />
		{:else if app.liveSeries.length > 0}
			<div class="next-up">
				<div>
					<p class="eyebrow eyebrow--ink">Nothing in progress</p>
					<p class="next-up__copy">
						{#if app.counts.plan_to_read > 0}
							{app.counts.plan_to_read}
							{app.counts.plan_to_read === 1 ? 'series is' : 'series are'} waiting in Plan to read.
						{:else}
							Pick a shelf, or start a new series.
						{/if}
					</p>
				</div>
				<button
					class="btn btn--sm"
					onclick={() => setFilter(app.counts.plan_to_read > 0 ? 'plan_to_read' : 'all')}
				>
					{app.counts.plan_to_read > 0 ? 'Show plan to read' : 'Show all'}
				</button>
			</div>
		{/if}

		{#if app.liveSeries.length > 0}
			<UpNext />
		{/if}

		{#if app.liveSeries.length === 0}
			<section class="empty" aria-labelledby="empty-title">
				<span class="empty__mark" lang="ja" aria-hidden="true">読</span>
				<p class="eyebrow eyebrow--ink">Shelf empty</p>
				<h1 class="empty__title" id="empty-title">Start the log.</h1>
				<p class="empty__lead">
					Paste a chapter link. Confirm the series once. From then on, log chapters from the shelf,
					the PC userscript, or an iPhone Shortcut.
				</p>				<div class="empty__actions">
					<button class="btn btn--red btn--lg" onclick={() => app.openAdd()}>
						<Icon name="plus" size={15} />
						Add a series
					</button>
					<button class="btn btn--ghost" onclick={() => app.openOnboarding()}>
						Take the tour
					</button>
					<button class="btn btn--ghost" onclick={() => void app.shareShelf()}>
						<Icon name="share" size={13} />
						Share shelf
					</button>
					<a class="btn btn--ghost" href="#/settings">Set up capture</a>
				</div>

				<ol class="steps">
					<li>
						<span class="steps__no">01</span>
						<div>
							<strong>Paste a URL</strong>
							<p>A chapter or series page. Yomi reads the site, title and chapter.</p>
						</div>
					</li>
					<li>
						<span class="steps__no">02</span>
						<div>
							<strong>Own one row</strong>
							<p>Add the other site's URL later. Both feed the same chapter count.</p>
						</div>
					</li>
					<li>
						<span class="steps__no">03</span>
						<div>
							<strong>Log the next one</strong>
							<p>
								One tap on the shelf. The <span class="mono">+1</span> is always there when a site
								changes.
							</p>
						</div>
					</li>
				</ol>
			</section>
		{:else}
			<section class="list" aria-labelledby="list-title">
				<header class="list__head">
					<div>
						<h2 class="list__title" id="list-title">
							{searching ? 'Matches' : shelfTitle()}
						</h2>
						<p class="list__sub">
							{rows.length}
							{rows.length === 1 ? 'series' : 'series'}
							<span class="dot">/</span>
							{app.sortLabel}
							{#if app.tagFilter}
								<span class="dot">/</span>
								#{app.tagFilter}
							{/if}
							{#if searching}
								<span class="dot">/</span>
								“{app.shelfQuery.trim().slice(0, 40)}”
							{/if}
						</p>
					</div>
					<div class="list__tools">
						<div class="search">
							<Icon name="search" size={13} />
							<input
								class="search__input"
								bind:this={searchInput}
								type="search"
								placeholder="Find a series  /"
								aria-label="Search the shelf by title or synopsis"
								bind:value={app.shelfQuery}
							/>
							{#if searching}
								<button class="search__clear" aria-label="Clear search" onclick={clearSearch}>
									<Icon name="close" size={11} />
								</button>
							{/if}
						</div>
						<select
							class="select select--sort"
							bind:value={app.shelfSort}
							aria-label="Sort the shelf"
						>
							{#each SHELF_SORTS as option (option)}
								<option value={option}>{SHELF_SORT_LABEL[option]}</option>
							{/each}
						</select>
						{#if !selecting}
							<button class="btn btn--sm btn--ghost" onclick={startSelecting}>
								<Icon name="check" size={13} />
								Select
							</button>
							<button class="btn btn--sm list__add" onclick={() => app.openAdd()}>
								<Icon name="plus" size={13} />
								Add
							</button>
						{/if}
					</div>
				</header>

				{#if rows.length === 0}
					<div class="filter-empty">
						<p class="eyebrow eyebrow--ink">{searching ? 'No matches' : 'Empty shelf'}</p>
						<p class="filter-empty__copy">
							{#if searching}
								Nothing in {shelfTitle().toLowerCase()} matches “{app.shelfQuery.trim()}”.
							{:else if app.tagFilter}
								Nothing in this view is tagged #{app.tagFilter}.
							{:else if app.filter === 'review'}
								Every row looks right. Nothing needs a check.
							{:else}
								Nothing in {app.filter === 'all' ? 'the shelf' : shelfTitle().toLowerCase()}.
							{/if}
						</p>
						<div class="filter-empty__actions">
							{#if searching}
								<button class="btn btn--sm" onclick={clearSearch}>Clear search</button>
							{:else if app.tagFilter}
								<button class="btn btn--sm" onclick={() => (app.tagFilter = '')}>Clear tag</button>
							{:else}
								<button class="btn btn--sm" onclick={() => setFilter('all')}>Show all</button>
							{/if}
							<button class="btn btn--sm btn--ghost" onclick={() => app.openAdd()}>
								Add a series
							</button>
						</div>
					</div>
				{:else}
					<div class="list__grid-head" aria-hidden="true">
						<span>No.</span>
						<span>Series</span>
						<span>Chapter</span>
						<span>+1</span>
					</div>

					{#if selecting}
						<div class="bulk" role="region" aria-label="Selected series">
							<div class="bulk__lead">
								<p class="bulk__count" aria-live="polite">
									<strong class="bulk__number">
										{String(selected.length).padStart(2, '0')}
									</strong>
									<span class="bulk__word">selected</span>
								</p>
								<p class="bulk__hint">
									{selected.length === 0 ? 'Tap a row to begin' : 'Shift-click takes a run'}
								</p>
							</div>

							<button
								class="bulk__log"
								disabled={selected.length === 0}
								onclick={() => void logNext()}
								title="Log the next chapter on every selected series"
							>
								<Icon name="plus" size={11} stroke={2} />
								<span>1 each</span>
							</button>

							<div class="bulk__moves" role="group" aria-label="Batch actions">
								<button class="bulk__util" onclick={toggleAll} disabled={rows.length === 0}>
									{allSelected ? 'Clear all' : `Select all ${rows.length}`}
								</button>
								<span class="bulk__sep" aria-hidden="true"></span>
								<span class="bulk__kick">Move to</span>
								{#each STATUSES as status (status)}
									<button
										class="bulk__move"
										disabled={selected.length === 0 || settledOn(status)}
										onclick={() => void moveSelected(status)}
										title={settledOn(status)
											? `Already on ${STATUS_LABEL[status]}`
											: `Move to ${STATUS_LABEL[status]}`}
									>
										{STATUS_LABEL[status]}
									</button>
								{/each}
								{#if reviewCount > 0}
									<span class="bulk__sep" aria-hidden="true"></span>
									<button
										class="bulk__move bulk__move--flag"
										disabled={selected.length === 0}
										onclick={() => void confirmParsing()}
										title="Clear the 'check parsing' flag on these rows"
									>
										Confirm parsing · {reviewCount}
									</button>
								{/if}
								<span class="bulk__sep" aria-hidden="true"></span>
								<button
									class="bulk__delete"
									class:is-armed={deleteArmed}
									disabled={selected.length === 0}
									onclick={armDelete}
									title={deleteArmed
										? 'Tap again to delete for good'
										: 'Delete the selected series'}
								>
									{deleteArmed ? `Delete ${selected.length}?` : 'Delete'}
								</button>
							</div>

							<div class="bulk__end">
								<button class="btn btn--sm bulk__done" onclick={stopSelecting}>Done</button>
							</div>
						</div>
					{/if}

					<div class="list__rows">
						{#each rows as series, index (series.id)}
							<SeriesRow
								{series}
								{index}
								{selecting}
								selected={selected.includes(series.id)}
								ontoggle={(event) => toggleRow(series.id, event)}
							/>
						{/each}
					</div>
				{/if}
			</section>
		{/if}
	</main>
</div>

<style>
	.library {
		display: grid;
		grid-template-columns: 176px minmax(0, 1fr);
		gap: clamp(22px, 4vw, 46px);
		align-items: start;
		padding-block: clamp(24px, 4vw, 42px) 60px;
	}

	.rail {
		position: sticky;
		top: 96px;
		align-self: start;
	}

	.rail__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding-bottom: 10px;
		border-bottom: 2px solid var(--ink);
	}

	.rail__count {
		font-size: 10px;
		color: var(--ink-2);
	}

	.filters {
		display: flex;
		flex-direction: column;
		margin-top: 4px;
	}

	.filter {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		min-height: 37px;
		padding: 7px 8px 7px 10px;
		border-bottom: 1px solid var(--rule);
		text-align: left;
		color: var(--ink-2);
		transition:
			background-color 110ms ease,
			color 110ms ease,
			padding-left 160ms cubic-bezier(0.2, 0.9, 0.25, 1);
	}

	/* The active shelf gets an ink edge that slides in. */
	.filter::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 3px;
		background: var(--red);
		transform: scaleY(0);
		transform-origin: top center;
		transition: transform 180ms cubic-bezier(0.2, 0.9, 0.25, 1);
	}

	.filter--active::before {
		transform: scaleY(1);
	}

	.filter--active {
		padding-left: 14px;
	}

	.filter__label {
		font-family: var(--sans);
		font-size: 13px;
		font-weight: 500;
	}

	.filter__count {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.04em;
		color: var(--ink-3);
	}

	.filter:hover {
		background: var(--paper-2);
		color: var(--ink);
	}

	.filter--active {
		background: var(--ink);
		border-bottom-color: var(--ink);
		color: var(--paper);
	}

	.filter--active .filter__label {
		font-weight: 700;
	}

	.filter--active .filter__count {
		color: var(--paper);
		opacity: 0.6;
	}

	.filter--active:hover {
		background: var(--ink);
		color: var(--paper);
	}

	.rail__tags {
		margin-top: 18px;
		padding-top: 12px;
		border-top: 1px solid var(--rule);
	}

	.rail__tags-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}

	.rail__tags-clear {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-3);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.rail__tags-clear:hover {
		color: var(--red);
	}

	.tag-cloud {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}

	.tag-chip {
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		padding: 4px 7px;
		border: 1px solid var(--rule);
		background: var(--paper);
		font-family: var(--mono);
		font-size: 8.5px;
		letter-spacing: 0.04em;
		color: var(--ink-2);
	}

	.tag-chip:hover {
		border-color: var(--ink);
		color: var(--ink);
	}

	.tag-chip--on,
	.tag-chip--on:hover {
		background: var(--ink);
		border-color: var(--ink);
		color: var(--paper);
	}

	.tag-chip__count {
		font-size: 7px;
		opacity: 0.6;
	}

	.rail__foot {
		margin-top: 26px;
		padding-top: 14px;
		border-top: 1px solid var(--rule);
	}

	.rail__note {
		font-size: 11px;
		line-height: 1.5;
		color: var(--ink-2);
	}

	.rail__link {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-top: 10px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink);
	}

	.rail__link:hover {
		color: var(--red);
	}

	.main {
		min-width: 0;
	}

	.next-up {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding: 14px 16px;
		border: 1.5px solid var(--rule);
		border-left: 5px solid var(--red);
		background: var(--paper-2);
	}

	.next-up__copy {
		margin-top: 2px;
		font-size: 13px;
		color: var(--ink-2);
	}

	.list {
		margin-top: clamp(26px, 4vw, 40px);
	}

	.list__head {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		padding-bottom: 12px;
		border-bottom: 2px solid var(--ink);
	}

	.list__title {
		font-family: var(--display);
		font-size: clamp(26px, 4vw, 38px);
		font-weight: 400;
		line-height: 1;
		letter-spacing: -0.02em;
	}

	.list__sub {
		margin-top: 5px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.dot {
		margin-inline: 3px;
		opacity: 0.55;
	}

	.list__tools {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 2px;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 7px;
		border: var(--line) solid var(--rule);
		background: var(--paper);
		transition: border-color 120ms ease;
	}

	.search:focus-within {
		border-color: var(--ink);
	}

	.search__input {
		width: 138px;
		height: 32px;
		border: 0;
		outline: 0;
		background: transparent;
		font-family: var(--sans);
		font-size: 12px;
		color: var(--ink);
	}

	.search__input::placeholder {
		color: var(--ink-3);
	}

	/* Safari draws its own clear button; the app's is the one that fits. */
	.search__input::-webkit-search-cancel-button {
		display: none;
	}

	.search__clear {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		color: var(--ink-2);
	}

	.search__clear:hover {
		color: var(--red);
	}

	.select--sort {
		height: 32px;
		padding: 0 24px 0 8px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.05em;
		border: var(--line) solid var(--rule);
		background: var(--paper);
		color: var(--ink-2);
	}

	.select--sort:focus-visible {
		border-color: var(--ink);
	}

	.list__add {
		margin-bottom: 2px;
	}

	/* The bulk bar is the only surface that reads as ink-filled: it is a mode,
	   not another row of content. It rides the bottom edge while you scroll. */
	.bulk {
		position: sticky;
		top: var(--bulk-top, 94px);
		z-index: 15;
		/* Two deliberate rows at every width: the count and the way out above,
		   every batch action on its own line below. Wrapping by accident is what
		   made the bar tall and its controls jump around. */
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		grid-template-areas:
			'lead log end'
			'moves moves moves';
		align-items: center;
		gap: 8px 16px;
		margin-bottom: 12px;
		padding: 10px 12px;
		border-top: 3px solid var(--red);
		background: var(--ink);
		color: var(--paper);
		/* Opacity only: a transform here would drag the sticky offset around. */
		animation: yomi-fade 140ms ease-out;
	}

	/* Count and the one-line tip share a column, so the bar's left edge stays
	   steady whether or not anything is selected yet. */
	.bulk__lead {
		grid-area: lead;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding-right: 14px;
		border-right: 1px solid color-mix(in srgb, var(--paper) 26%, transparent);
	}

	.bulk__count {
		display: flex;
		align-items: baseline;
		gap: 7px;
	}

	.bulk__count::before {
		content: '';
		align-self: center;
		width: 6px;
		height: 6px;
		background: var(--red);
	}

	.bulk__number {
		font-family: var(--display);
		font-size: 22px;
		font-weight: 400;
		line-height: 1;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}

	.bulk__word {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.68;
	}

	.bulk__moves {
		grid-area: moves;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.bulk__moves::-webkit-scrollbar {
		display: none;
	}

	.bulk__kick {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		opacity: 0.6;
		white-space: nowrap;
	}

	.bulk__move {
		min-height: 30px;
		padding: 5px 9px;
		border: 1px solid color-mix(in srgb, var(--paper) 34%, transparent);
		color: inherit;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		white-space: nowrap;
		transition:
			background-color 110ms ease,
			border-color 110ms ease,
			color 110ms ease;
	}

	.bulk__move:hover:not(:disabled) {
		background: var(--paper);
		border-color: var(--paper);
		color: var(--ink);
	}

	.bulk__move:disabled {
		opacity: 0.38;
		cursor: not-allowed;
	}

	.bulk__sep {
		align-self: stretch;
		width: 1px;
		margin-inline: 2px;
		background: color-mix(in srgb, var(--paper) 26%, transparent);
	}

	/* Last in the strip and plainly quieter than everything else: the one
	   irreversible action should never be the easiest thing to hit. */
	.bulk__delete {
		flex: 0 0 auto;
		min-height: 30px;
		padding: 5px 10px;
		border: 1px solid color-mix(in srgb, var(--paper) 22%, transparent);
		color: color-mix(in srgb, var(--paper) 70%, transparent);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		white-space: nowrap;
		transition:
			background-color 110ms ease,
			border-color 110ms ease,
			color 110ms ease;
	}

	.bulk__delete:hover:not(:disabled) {
		border-color: var(--red);
		color: var(--paper);
	}

	.bulk__delete.is-armed {
		background: var(--red);
		border-color: var(--red);
		color: var(--on-signal);
		font-weight: 500;
	}

	.bulk__delete:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	/* The logging action is the one that writes, so it is the one button in the
	   bar that carries the ink red instead of sitting as an outline. */
	.bulk__log {
		grid-area: log;
		justify-self: start;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		min-height: 30px;
		padding: 5px 10px;
		border: 1px solid var(--red);
		background: var(--red);
		color: var(--on-signal);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		white-space: nowrap;
		transition:
			background-color 110ms ease,
			border-color 110ms ease,
			color 110ms ease;
	}

	.bulk__log:hover:not(:disabled) {
		background: var(--paper);
		border-color: var(--paper);
		color: var(--ink);
	}

	.bulk__log:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.bulk__end {
		grid-area: end;
		justify-self: end;
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.bulk__util {
		flex: 0 0 auto;
		color: inherit;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		text-decoration: underline;
		text-underline-offset: 3px;
		opacity: 0.78;
		white-space: nowrap;
	}

	.bulk__util:hover {
		opacity: 1;
		text-decoration-color: var(--red);
	}

	.bulk__done {
		border-color: var(--paper);
		background: var(--paper);
		color: var(--ink);
	}

	.bulk__done:hover {
		background: var(--red);
		border-color: var(--red);
		color: var(--on-signal);
	}

	.bulk__hint {
		font-family: var(--mono);
		font-size: 7.5px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		white-space: nowrap;
		opacity: 0.45;
	}

	.list__grid-head {
		display: grid;
		grid-template-columns: 28px 42px minmax(0, 1fr) 74px 44px;
		gap: 14px;
		padding: 8px 12px 8px 10px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.13em;
		text-transform: uppercase;
		color: var(--ink-3);
		border-bottom: 1px solid var(--rule);
	}

	.list__grid-head span:nth-child(2) {
		grid-column: 2 / 4;
	}

	.list__grid-head span:nth-child(3) {
		text-align: right;
	}

	.list__grid-head span:nth-child(4) {
		text-align: right;
	}

	.list__rows {
		border-bottom: 2px solid var(--ink);
	}

	.filter-empty {
		padding: 42px 0;
	}

	.filter-empty__copy {
		margin-top: 6px;
		font-size: 19px;
		font-weight: 700;
	}

	.filter-empty__actions {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}

	/* Empty state */
	.empty {
		position: relative;
		margin-top: 30px;
		padding: clamp(26px, 5vw, 52px);
		border: 2px solid var(--ink);
		box-shadow: 6px 6px 0 var(--paper-3);
		overflow: hidden;
	}

	.empty__mark {
		position: absolute;
		animation: yomi-stamp 520ms cubic-bezier(0.16, 1, 0.3, 1) both;
		animation-delay: 80ms;
		right: -6px;
		bottom: -48px;
		font-family: var(--jp);
		font-size: clamp(160px, 30vw, 280px);
		font-weight: 700;
		line-height: 1;
		color: var(--ink);
		opacity: 0.055;
		pointer-events: none;
		user-select: none;
	}

	.empty__title {
		margin-top: 8px;
		font-family: var(--display);
		font-size: clamp(42px, 8vw, 74px);
		font-weight: 400;
		line-height: 0.95;
		letter-spacing: -0.035em;
		animation: yomi-rise-soft 360ms ease-out both;
		animation-delay: 60ms;
	}

	.empty__lead {
		animation: yomi-rise-soft 360ms ease-out both;
		animation-delay: 120ms;
	}

	.empty__actions {
		animation: yomi-rise-soft 360ms ease-out both;
		animation-delay: 180ms;
	}

	.steps {
		animation: yomi-rise-soft 360ms ease-out both;
		animation-delay: 240ms;
	}

	.empty__lead {
		max-width: 520px;
		margin-top: 14px;
		font-size: 15px;
		line-height: 1.6;
		color: var(--ink-2);
	}

	.empty__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 22px;
	}

	.steps {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0;
		margin-top: 38px;
		border-top: 1px solid var(--ink);
	}

	.steps li {
		display: flex;
		gap: 10px;
		padding: 16px 18px 0 0;
	}

	.steps li + li {
		padding-left: 18px;
		border-left: 1px solid var(--rule);
	}

	.steps__no {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		color: var(--red);
		padding-top: 3px;
	}

	.steps strong {
		display: block;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.steps p {
		margin-top: 4px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--ink-2);
	}

	@media (max-width: 900px) {
		.library {
			grid-template-columns: minmax(0, 1fr);
			gap: 22px;
			padding-top: 0;
		}

		.rail {
			/* The filter strip scrolls inside the rail, so the rail itself must be
			   allowed to shrink below the strip's width. */
			min-width: 0;
			position: static;
			top: auto;
			margin-inline: calc(var(--gutter) * -1);
			padding-inline: var(--gutter);
			border-bottom: 1.5px solid var(--ink);
			background: var(--paper);
		}

		.rail__head,
		.rail__foot {
			display: none;
		}

		/* Tags stay available on a phone, but as a second strip rather than a block. */
		.rail__tags {
			margin-top: 0;
			padding: 8px 0 9px;
			border-top: 0;
		}

		.rail__tags-head {
			display: none;
		}

		.tag-cloud {
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: none;
			padding-bottom: 1px;
		}

		.tag-cloud::-webkit-scrollbar {
			display: none;
		}

		.tag-chip {
			flex: 0 0 auto;
			min-height: 30px;
		}

		.filters {
			flex-direction: row;
			gap: 0;
			margin: 0;
			overflow-x: auto;
			scrollbar-width: none;
		}

		.filters::-webkit-scrollbar {
			display: none;
		}

		.filter {
			width: auto;
			flex: 0 0 auto;
			gap: 6px;
			min-height: 48px;
			padding: 12px 11px;
			border-bottom: 0;
			border-right: 1px solid var(--rule);
		}

		.filter--active {
			background: transparent;
			color: var(--ink);
			box-shadow: inset 0 -3px 0 var(--red);
		}

		.filter--active:hover {
			background: transparent;
			color: var(--ink);
		}

		.filter--active .filter__count {
			color: var(--red);
			opacity: 1;
		}

		.main {
			padding-top: 2px;
		}

		.list {
			margin-top: 26px;
		}

		.list__grid-head {
			display: none;
		}

		.empty {
			margin-top: 0;
		}

		.steps {
			grid-template-columns: 1fr;
		}

		.steps li {
			padding: 14px 0;
		}

		.steps li + li {
			padding-left: 0;
			border-left: 0;
			border-top: 1px solid var(--rule);
		}
	}

	@media (max-width: 760px) {
		.bulk {
			gap: 8px 10px;
			padding: 9px 10px;
		}

		.bulk__lead {
			padding-right: 0;
			border-right: 0;
		}

		.bulk__moves {
			padding-bottom: 2px;
		}

		.bulk__hint {
			display: none;
		}
	}

	@media (max-width: 700px) {
		.list__add {
			display: none;
		}
	}

	@media (max-width: 640px) {
		.list__head {
			align-items: stretch;
			flex-direction: column;
			gap: 10px;
		}

		.list__tools {
			width: 100%;
			flex-wrap: wrap;
			gap: 6px;
		}

		.search {
			flex: 1 1 100%;
		}

		.search__input {
			width: 100%;
			height: 38px;
		}

		.select--sort {
			flex: 1 1 0;
			min-width: 0;
			height: 38px;
		}

		.list__tools .btn--sm {
			min-height: 38px;
		}
	}

	@media (max-width: 560px) {
		.next-up {
			align-items: flex-start;
			flex-direction: column;
			gap: 10px;
		}

		.empty {
			padding: 24px 18px;
		}

		/* The dock owns Add on a phone; the list does not need a second one. */
		.list__add {
			display: none;
		}
	}
</style>
