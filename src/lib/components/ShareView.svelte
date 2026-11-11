<script lang="ts">
	import { seriesStats } from '../../../shared/merge.ts';
	import { STATUS_LABEL, chapterText, relativeTime } from '../../../shared/model.ts';
	import type { ShareViewResponse } from '../../../shared/protocol.ts';
	import { fetchShare } from '../account.ts';
	import { app } from '../app.svelte.ts';
	import { shelfTitleKey } from '../share-copy.ts';
	import Icon from './Icon.svelte';

	let { token, api }: { token: string; api: string } = $props();

	let data = $state<ShareViewResponse | null>(null);
	let error = $state('');
	let loading = $state(true);
	let savingAll = $state(false);
	let savingId = $state('');

	$effect(() => {
		let cancelled = false;
		void (async () => {
			loading = true;
			error = '';
			const result = await fetchShare(api, token);
			if (cancelled) return;
			if (result.ok && result.data) data = result.data;
			else error = result.message;
			loading = false;
		})();
		return () => {
			cancelled = true;
		};
	});

	const rows = $derived(
		(data?.series ?? [])
			.slice()
			.sort((a, b) => a.title.localeCompare(b.title))
			.map((series) => ({
				series,
				stats: seriesStats(
					series,
					(data?.events ?? []).filter((event) => event.series_id === series.id)
				)
			}))
	);

	const chapters = $derived(data?.events.filter((event) => !event.deleted_at).length ?? 0);
	const shelfKeys = $derived(new Set(app.liveSeries.map((series) => shelfTitleKey(series.title))));
	const saveable = $derived(
		rows.filter((row) => !shelfKeys.has(shelfTitleKey(row.series.title)))
	);

	function onShelf(title: string): boolean {
		return shelfKeys.has(shelfTitleKey(title));
	}

	async function saveOne(series: ShareViewResponse['series'][number]): Promise<void> {
		if (savingId) return;
		savingId = series.id;
		try {
			await app.saveSharedSeries({
				title: series.title,
				cover_url: series.cover_url,
				total_chapters: series.total_chapters,
				description: series.description
			});
		} finally {
			savingId = '';
		}
	}

	async function saveAll(): Promise<void> {
		if (savingAll || saveable.length === 0) return;
		savingAll = true;
		try {
			await app.saveSharedShelf(
				saveable.map((row) => ({
					title: row.series.title,
					cover_url: row.series.cover_url,
					total_chapters: row.series.total_chapters,
					description: row.series.description
				}))
			);
		} finally {
			savingAll = false;
		}
	}
</script>

<div class="share">
	<header class="share__head">
		<p class="eyebrow eyebrow--ink">Shared shelf</p>
		{#if loading}
			<h1 class="share__title">Opening the shelf…</h1>
		{:else if error}
			<h1 class="share__title">This shelf is not available.</h1>
			<p class="share__lead">{error}</p>
		{:else if data}
			<h1 class="share__title">{data.username}’s reading</h1>
			<p class="share__lead">
				{data.series.length} {data.series.length === 1 ? 'series' : 'series'} ·
				{chapters}
				{chapters === 1 ? 'chapter' : 'chapters'} logged. Read-only — shared
				{relativeTime(data.shared_at, Date.now())}.
			</p>
			<div class="share__actions">
				<button
					class="btn btn--sm"
					onclick={saveAll}
					disabled={!app.ready || saveable.length === 0 || savingAll}
				>
					<Icon name={saveable.length === 0 ? 'check' : 'plus'} size={13} />
					{savingAll
						? 'Saving…'
						: saveable.length === 0
							? 'All on your shelf'
							: `Save ${saveable.length} to my shelf`}
				</button>
			</div>
		{/if}
	</header>

	{#if !loading && !error && data}
		{#if !app.account && !app.accountChecking}
			<section class="invite" aria-labelledby="invite-title">
				<div>
					<p class="eyebrow eyebrow--ink">Your turn</p>
					<h2 class="invite__title" id="invite-title">Start your own shelf.</h2>
					<p class="invite__copy">
						Yomi keeps your chapters across sites and devices. No feed, no followers — just
						your reading.
					</p>
				</div>
				<button class="btn btn--red invite__button" onclick={() => app.openOnboarding()}>
					Create my shelf
					<Icon name="arrow-right" size={14} />
				</button>
			</section>
		{/if}

		{#if rows.length === 0}
			<p class="share__empty">Nothing on this shelf yet.</p>
		{:else}
			<ol class="shelf">
				{#each rows as row (row.series.id)}
					<li class="entry">
						<div class="entry__cover">
							{#if row.series.cover_url}
								<img src={row.series.cover_url} alt="" loading="lazy" />
							{:else}
								<span class="entry__blank" aria-hidden="true">
									{row.series.title.slice(0, 1)}
								</span>
							{/if}
						</div>
						<div class="entry__body">
							<div class="entry__title-row">
								<h2 class="entry__title">{row.series.title}</h2>
								{#if row.series.rating !== null}
									<span class="score" title="{row.series.rating} out of 10">
										{row.series.rating}
										<span class="score__den">/10</span>
									</span>
								{/if}
							</div>
							<p class="entry__meta mono">
								{STATUS_LABEL[row.series.status]}
								{#if row.stats.furthest !== null}
									· ch. {chapterText(row.stats.furthest)}
									{#if row.series.total_chapters}
										/ {chapterText(row.series.total_chapters)}
									{/if}
								{/if}
							</p>
							{#if row.series.description}
								<p class="entry__desc">{row.series.description}</p>
							{/if}
							{#if (row.series.tags ?? []).length > 0}
								<ul class="entry__tags">
									{#each row.series.tags as tag (tag)}
										<li class="tag">{tag}</li>
									{/each}
								</ul>
							{/if}
							<button
								class="entry__save"
								class:is-saved={onShelf(row.series.title)}
								onclick={() => saveOne(row.series)}
								disabled={!app.ready || onShelf(row.series.title) || savingId === row.series.id}
								title={onShelf(row.series.title)
									? 'Already on your shelf'
									: 'Save the title, cover, total and synopsis to your shelf'}
							>
								<Icon name={onShelf(row.series.title) ? 'check' : 'plus'} size={11} />
								{onShelf(row.series.title)
									? 'On your shelf'
									: savingId === row.series.id
										? 'Saving…'
										: 'Save to my shelf'}
							</button>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	{/if}

	<footer class="share__foot">
		<span>Shared from Yomi.</span>
		<a href="#/">Your own shelf</a>
	</footer>
</div>

<style>
	.share {
		display: grid;
		gap: 24px;
		padding-bottom: 40px;
	}

	.share__head {
		display: grid;
		gap: 6px;
		padding-top: 18px;
		border-top: var(--line) solid var(--ink);
	}

	.share__title {
		font-family: var(--display);
		font-size: clamp(30px, 5.5vw, 48px);
		font-weight: 400;
		line-height: 1;
	}

	.share__lead {
		font-size: 13px;
		line-height: 1.55;
		color: var(--ink-2);
		max-width: 56ch;
	}

	.share__empty {
		font-size: 13px;
		color: var(--ink-2);
	}

	.share__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 6px;
	}

	.invite {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding: 15px 16px;
		border: 1.5px solid var(--ink);
		border-left: 5px solid var(--red);
		background: var(--paper-2);
	}

	.invite__title {
		margin-top: 2px;
		font-family: var(--display);
		font-size: clamp(21px, 3.5vw, 27px);
		font-weight: 400;
		line-height: 1.05;
	}

	.invite__copy {
		max-width: 48ch;
		margin-top: 5px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--ink-2);
	}

	.invite__button {
		flex: 0 0 auto;
	}

	.entry__save {
		justify-self: start;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-height: 30px;
		margin-top: 5px;
		padding: 5px 8px;
		border: 1px solid var(--ink);
		font-family: var(--mono);
		font-size: 8.5px;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--ink);
	}

	.entry__save:hover:not(:disabled) {
		background: var(--ink);
		color: var(--paper);
	}

	.entry__save:disabled {
		cursor: default;
		opacity: 0.55;
	}

	.entry__save.is-saved {
		border-color: var(--rule);
		color: var(--ink-3);
		opacity: 1;
	}

	.shelf {
		list-style: none;
		margin: 0;
		padding: 0;
		border-top: 1px solid var(--rule);
	}

	.entry {
		display: grid;
		grid-template-columns: 64px minmax(0, 1fr);
		gap: 14px;
		padding: 14px 0;
		border-bottom: 1px solid var(--rule);
	}

	.entry__cover {
		width: 64px;
		aspect-ratio: 2 / 3;
		overflow: hidden;
		background: var(--paper-3, #e6e1d5);
		border: 1px solid var(--rule);
	}

	.entry__cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.entry__blank {
		display: grid;
		place-items: center;
		height: 100%;
		font-family: var(--display);
		font-size: 26px;
		color: var(--ink-3);
	}

	.entry__body {
		display: grid;
		gap: 4px;
		align-content: start;
		min-width: 0;
	}

	.entry__title-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}

	.entry__title {
		font-size: 16px;
		font-weight: 700;
		line-height: 1.25;
	}

	.score {
		font-family: var(--display);
		font-size: 20px;
		line-height: 1;
		white-space: nowrap;
	}

	.score__den {
		font-family: var(--mono);
		font-size: 8px;
		color: var(--ink-3);
	}

	.entry__meta {
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.entry__desc {
		font-size: 12px;
		line-height: 1.5;
		color: var(--ink-2);
		max-width: 68ch;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.entry__tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		list-style: none;
		padding: 0;
		margin: 2px 0 0;
	}

	.entry__tags .tag {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		padding: 2px 6px;
		border: 1px solid var(--rule);
		color: var(--ink-2);
	}

	.share__foot {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding-top: 14px;
		border-top: 1px solid var(--rule);
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.share__foot a {
		color: var(--ink-2);
	}

	@media (max-width: 560px) {
		.invite {
			align-items: flex-start;
			flex-direction: column;
			gap: 12px;
		}

		.invite__button {
			width: 100%;
		}

		.entry {
			grid-template-columns: 52px minmax(0, 1fr);
			gap: 10px;
		}

		.entry__cover {
			width: 52px;
		}
	}
</style>
