<script lang="ts">
	import type { Series } from '../../../shared/model.ts';
	import type { SeriesStats } from '../../../shared/merge.ts';
	import { chapterText, relativeTime, STATUS_SHORT } from '../../../shared/model.ts';
	import { app } from '../app.svelte.ts';
	import Cover from './Cover.svelte';
	import Icon from './Icon.svelte';

	let { series, stats }: { series: Series; stats: SeriesStats } = $props();

	const sources = $derived(app.sourcesFor(series.id));
	const link = $derived(app.readingLinkFor(series));
	const site = $derived(sources[0]?.site ?? 'other');
	const siteLabel = $derived(
		site === 'comix' ? 'Comix' : site === 'mangadot' ? 'MangaDot' : 'Web'
	);
</script>

<article class="continue" aria-labelledby="continue-title">
	<div class="continue__rail screentone" aria-hidden="true"></div>
	<div class="continue__inner">
		<header class="continue__head">
			<span class="continue__kicker">
				<span class="continue__square" aria-hidden="true"></span>
				Continue reading
			</span>
			<span class="continue__when">
				{siteLabel} · {STATUS_SHORT[series.status]}
				{#if stats.lastReadAt}
					· last read {relativeTime(stats.lastReadAt, app.now)}
				{/if}
			</span>
		</header>

		<div class="continue__grid">
			<div class="continue__identity">
				<a class="continue__cover" href={`#/s/${series.id}`} aria-hidden="true" tabindex="-1">
					<Cover url={series.cover_url} title={series.title} size="md" />
				</a>
				<div class="continue__copy">
					<a class="continue__title" id="continue-title" href={`#/s/${series.id}`}>
						{series.title}
					</a>
					<p class="continue__meta">
						{#if series.total_chapters}
							{stats.furthest ?? 0} of {series.total_chapters} chapters
							{#if stats.percent !== null}
								· {Math.round(stats.percent)}%
							{/if}
						{:else}
							{stats.chapterCount} {stats.chapterCount === 1 ? 'chapter' : 'chapters'} logged
						{/if}
						{#if sources.length > 1}
							· {sources.length} sites
						{/if}
					</p>
				</div>
			</div>

			<div class="folio" aria-label={`${stats.furthest ?? 0} chapters logged`}>
				<span class="folio__label">Ch.</span>
				{#key stats.furthest}
					<span class="folio__number">{stats.furthest ?? '00'}</span>
				{/key}
				<span class="folio__total">
					{series.total_chapters ? `/ ${series.total_chapters}` : 'logged'}
				</span>
			</div>
		</div>

		<footer class="continue__actions">
			{#if link}
				<a
					class="btn btn--red btn--lg continue__primary"
					href={link.url}
					target="_blank"
					rel="noreferrer"
					title={link.url}
					aria-label={`${app.readingLabel(link)} in a new tab`}
				>
					<span>{app.readingLabel(link)}</span>
					<Icon name="external" size={17} stroke={1.9} />
				</a>
				<button
					class="btn btn--ghost continue__log"
					onclick={() => app.plusOne(series)}
					title={`Log chapter ${chapterText(stats.nextChapter)} without opening a site`}
				>
					+1 · log ch. {chapterText(stats.nextChapter)}
				</button>
			{:else}
				<button class="btn btn--red btn--lg continue__primary" onclick={() => app.plusOne(series)}>
					<span>Log chapter {chapterText(stats.nextChapter)}</span>
					<Icon name="arrow-right" size={17} stroke={1.9} />
				</button>
			{/if}
			<a class="btn btn--ghost" href={`#/s/${series.id}`}>Series</a>
			<span class="continue__hint">Reading opens the site · logging stays here</span>
		</footer>
	</div>
</article>

<style>
	.continue {
		position: relative;
		display: grid;
		grid-template-columns: 13px 1fr;
		background: var(--paper);
		border: 2px solid var(--ink);
		box-shadow: 5px 5px 0 var(--paper-3);
		animation: yomi-rise 260ms ease-out both;
	}

	.continue__rail {
		border-right: 1.5px solid var(--ink);
		opacity: 0.22;
	}

	.continue__inner {
		min-width: 0;
		padding: 18px 22px 20px;
	}

	.continue__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 16px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--rule);
	}

	.continue__kicker {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--mono);
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.continue__square {
		width: 8px;
		height: 8px;
		background: var(--red);
	}

	.continue__when {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--ink-2);
		text-align: right;
	}

	.continue__grid {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 22px;
		padding: 18px 0 20px;
	}

	.continue__identity {
		display: flex;
		align-items: flex-start;
		gap: 15px;
		min-width: 0;
	}

	.continue__cover {
		display: block;
		flex: 0 0 auto;
	}

	.continue__copy {
		min-width: 0;
	}

	.continue__title {
		display: block;
		font-size: clamp(24px, 3.2vw, 34px);
		font-weight: 700;
		line-height: 1.08;
		letter-spacing: -0.025em;
		text-wrap: balance;
	}

	.continue__title:hover {
		text-decoration: underline;
		text-decoration-thickness: 2px;
		text-underline-offset: 5px;
		text-decoration-color: var(--red);
	}

	.continue__meta {
		margin-top: 8px;
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.04em;
		color: var(--ink-2);
	}

	.folio {
		display: grid;
		justify-items: end;
		flex: 0 0 auto;
		min-width: 126px;
		padding: 9px 14px 10px;
		background: var(--ink);
		color: var(--paper);
		box-shadow: 3px 3px 0 var(--red);
	}

	.folio__label {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		opacity: 0.65;
	}

	.folio__number {
		display: block;
		margin: 1px 0 0;
		font-family: var(--display);
		font-size: clamp(38px, 5vw, 54px);
		line-height: 1;
		letter-spacing: -0.03em;
		animation: yomi-stamp 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	.folio__total {
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.08em;
		opacity: 0.7;
	}

	.continue__actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
		padding-top: 16px;
		border-top: 1px solid var(--rule);
	}

	.continue__primary {
		gap: 22px;
		justify-content: space-between;
		transition:
			transform 140ms cubic-bezier(0.2, 0.9, 0.25, 1),
			background-color 140ms ease;
	}

	.continue__primary:active {
		transform: translate(2px, 2px);
		box-shadow: none;
	}

	.continue__primary :global(svg) {
		transition: transform 180ms cubic-bezier(0.2, 0.9, 0.25, 1);
	}

	.continue__primary:hover :global(svg) {
		transform: translateX(4px);
	}

	.continue__hint {
		margin-left: auto;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		color: var(--ink-3);
	}

	@media (max-width: 640px) {
		.continue__inner {
			padding: 15px 15px 16px;
		}

		.continue__head {
			align-items: flex-start;
			flex-direction: column;
			gap: 4px;
		}

		.continue__when {
			text-align: left;
		}

		.continue__grid {
			align-items: stretch;
			gap: 14px;
			padding: 15px 0 16px;
		}

		.continue__cover {
			display: none;
		}

		.folio {
			min-width: 86px;
			padding: 7px 9px 8px;
		}

		.folio__number {
			font-size: 34px;
		}

		.continue__title {
			font-size: 23px;
		}

		.continue__actions {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}

		.continue__log,
		.continue__actions > a.btn--ghost {
			width: 100%;
			padding-inline: 6px;
			font-size: 9px;
		}

		.continue__primary {
			grid-column: 1 / -1;
			width: 100%;
		}

		.continue__hint {
			display: none;
		}
	}
</style>
