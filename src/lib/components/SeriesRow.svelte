<script lang="ts">
	import type { Series } from '../../../shared/model.ts';
	import { STATUS_SHORT, chapterText, relativeTime } from '../../../shared/model.ts';
	import { app } from '../app.svelte.ts';
	import Cover from './Cover.svelte';
	import Icon from './Icon.svelte';

	let {
		series,
		index,
		selecting = false,
		selected = false,
		ontoggle
	}: {
		series: Series;
		index: number;
		/** In selection mode the row becomes one big checkbox. */
		selecting?: boolean;
		selected?: boolean;
		ontoggle?: (event: MouseEvent) => void;
	} = $props();

	// The +1 lands like a stamp: an ink ring leaves the button while the folio
	// digit turns over above it.
	let inked = $state(false);
	let inkTimer: ReturnType<typeof setTimeout> | undefined;

	function logNext(): void {
		void app.plusOne(series);
		inked = false;
		clearTimeout(inkTimer);
		// Re-trigger the animation even when taps come faster than it runs.
		requestAnimationFrame(() => {
			inked = true;
			inkTimer = setTimeout(() => (inked = false), 560);
		});
	}

	const stats = $derived(app.statsFor(series));
	const link = $derived(app.readingLinkFor(series));
	const sources = $derived(app.sourcesFor(series.id));
	const siteNames = $derived(
		sources
			.filter((source) => !source.normalized_path.startsWith('manual:'))
			.map((source) => (source.site === 'comix' ? 'Comix' : source.site === 'mangadot' ? 'MangaDot' : 'Web'))
	);
	const sites = $derived([...new Set(siteNames)]);
	const last = $derived(stats.lastReadAt ? relativeTime(stats.lastReadAt, app.now) : 'not started');
</script>

<article
	class="series-row"
	class:series-row--review={series.needs_review}
	class:series-row--selecting={selecting}
	class:series-row--selected={selecting && selected}
	style={`animation-delay:${Math.min(index, 10) * 32}ms`}
>
	{#if selecting}
		<button
			class="hit"
			aria-pressed={selected}
			aria-label={`${selected ? 'Deselect' : 'Select'} ${series.title}`}
			onclick={(event) => ontoggle?.(event)}
		></button>
		<span class="tick" class:is-on={selected} aria-hidden="true">
			{#if selected}<Icon name="check" size={11} stroke={2.4} />{/if}
		</span>
	{:else}
		<span class="series-row__no" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
	{/if}

	<a
		class="series-row__art"
		href={`#/s/${series.id}`}
		tabindex={selecting ? -1 : undefined}
		aria-hidden="true"
	>
		<Cover url={series.cover_url} title={series.title} size="sm" />
	</a>

	<div class="series-row__copy">
		<a class="series-row__title" href={`#/s/${series.id}`} tabindex={selecting ? -1 : undefined}>
			{series.title}
		</a>
		<p class="series-row__meta">
			<span class="series-row__status">{STATUS_SHORT[series.status]}</span>
			{#if sites.length > 0}
				<span class="dot">/</span>
				{sites.join(' + ')}
			{/if}
			<span class="dot">/</span>
			{last}
			{#if series.needs_review}
				<span class="series-row__flag">check parsing</span>
			{/if}
		</p>
		{#if series.total_chapters}
			<div class="bar" aria-hidden="true">
				<span
					class="bar__fill"
					style={`width:${Math.max(stats.percent ?? 0, stats.chapterCount > 0 ? 2 : 0)}%`}
				></span>
			</div>
		{/if}
	</div>

	<div
		class="series-row__folio"
		aria-label={`${stats.chapterCount} ${stats.chapterCount === 1 ? 'chapter' : 'chapters'} logged`}
	>
		{#if link && !selecting}
			<a
				class="series-row__chapter series-row__chapter--link"
				href={link.url}
				target="_blank"
				rel="noreferrer"
				title={link.url}
				aria-label={`${app.readingLabel(link)} of ${series.title}`}
			>
				{#key stats.furthest}
					<span class="series-row__digits stamp-in">
						{#if stats.furthest === null}—{:else}{stats.furthest}{/if}
					</span>
				{/key}
				<Icon name="external" size={9} />
			</a>
		{:else}
			<span class="series-row__chapter">
				{#key stats.furthest}
					<span class="series-row__digits stamp-in">
						{#if stats.furthest === null}—{:else}{stats.furthest}{/if}
					</span>
				{/key}
			</span>
		{/if}
		<span class="series-row__total">
			{series.total_chapters ? `/ ${series.total_chapters}` : 'ch.'}
		</span>
	</div>

	<button
		class="quick"
		onclick={logNext}
		disabled={selecting}
		aria-label={`Log chapter ${chapterText(stats.nextChapter)} of ${series.title}`}
		title={selecting ? 'Done selecting to log chapters' : `Log chapter ${chapterText(stats.nextChapter)}`}
	>
		<span class="quick__ink" class:is-inked={inked} aria-hidden="true"></span>
		<Icon name="plus" size={14} stroke={2} />
		<span>1</span>
	</button>
</article>

<style>
	.series-row {
		position: relative;
		display: grid;
		grid-template-columns: 28px 42px minmax(0, 1fr) 74px 44px;
		align-items: center;
		gap: 14px;
		min-height: 82px;
		padding: 11px 12px 11px 10px;
		border-bottom: 1px solid var(--rule);
		animation: yomi-rise 260ms ease-out both;
		transition: background-color 120ms ease;
	}

	.series-row:hover {
		background: var(--paper-2);
	}

	.series-row::before {
		content: '';
		position: absolute;
		left: 0;
		top: 12px;
		bottom: 12px;
		width: 0;
		background: var(--red);
		transition: width 120ms ease;
	}

	.series-row:hover::before {
		width: 3px;
	}

	.series-row__no {
		align-self: start;
		padding-top: 4px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.06em;
		color: var(--ink-3);
	}

	/* Selection mode: the whole row is one target, so the stretched title link
	   steps aside and the folio column becomes a tick box. */
	.hit {
		position: absolute;
		inset: 0;
		z-index: 3;
		cursor: pointer;
	}

	.tick {
		display: grid;
		place-items: center;
		width: 16px;
		height: 16px;
		margin-top: 3px;
		align-self: start;
		border: 1.5px solid var(--ink);
		background: var(--paper);
		color: transparent;
		transition:
			background-color 110ms ease,
			border-color 110ms ease;
	}

	.tick.is-on {
		background: var(--red);
		border-color: var(--red);
		color: var(--on-signal);
	}

	.series-row--selecting .series-row__title::after {
		content: none;
	}

	.series-row--selecting .quick {
		opacity: 0.3;
		cursor: default;
	}

	.series-row--selected {
		background: var(--paper-2);
	}

	.series-row--selected::before {
		width: 3px;
	}

	.series-row__art {
		display: block;
	}

	.series-row__copy {
		min-width: 0;
	}

	.series-row__title {
		display: inline;
		font-size: 17px;
		font-weight: 700;
		line-height: 1.25;
		letter-spacing: -0.012em;
	}

	.series-row__title:hover {
		text-decoration: underline;
		text-decoration-thickness: 2px;
		text-underline-offset: 4px;
		text-decoration-color: var(--red);
	}

	.series-row__title::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 1;
		cursor: pointer;
	}

	.series-row__meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 3px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.035em;
		color: var(--ink-2);
	}

	.series-row__status {
		color: var(--ink);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.dot {
		opacity: 0.5;
	}

	.series-row__flag {
		padding: 1px 4px;
		border: 1px solid var(--red);
		color: var(--red);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.bar {
		height: 3px;
		margin-top: 9px;
		background: var(--paper-3);
		overflow: hidden;
	}

	.bar__fill {
		display: block;
		height: 100%;
		background: var(--ink);
		transform-origin: left center;
		animation: yomi-bar 560ms cubic-bezier(0.2, 0.9, 0.25, 1) both;
		animation-delay: inherit;
	}

	.series-row__folio {
		display: grid;
		justify-items: end;
		line-height: 1;
		white-space: nowrap;
	}

	.series-row__chapter {
		font-family: var(--display);
		font-size: 25px;
		letter-spacing: -0.04em;
	}

	/* The folio is the fastest way into the next chapter, so it is a real link. */
	.series-row__chapter--link {
		position: relative;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		color: var(--ink);
	}

	.series-row__chapter--link :global(svg) {
		opacity: 0.45;
	}

	.series-row__chapter--link:hover {
		color: var(--red);
	}

	.series-row__chapter--link:hover :global(svg) {
		opacity: 1;
	}

	.series-row__digits {
		display: inline-block;
	}

	.series-row__total {
		margin-top: 2px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.08em;
		color: var(--ink-3);
	}

	.quick {
		position: relative;
		z-index: 2;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 1px;
		width: 42px;
		height: 42px;
		border: 1.5px solid var(--ink);
		font-family: var(--mono);
		font-size: 12px;
		font-weight: 500;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.quick:hover {
		background: var(--red);
		border-color: var(--red);
		color: var(--on-signal);
	}

	.quick:active {
		transform: scale(0.93);
	}

	.quick :global(svg),
	.quick > span:last-child {
		transition: transform 160ms cubic-bezier(0.2, 0.9, 0.25, 1);
	}

	.quick:hover :global(svg) {
		transform: rotate(90deg);
	}

	.quick__ink {
		position: absolute;
		inset: -2px;
		border: 2px solid var(--red);
		opacity: 0;
		pointer-events: none;
	}

	.quick__ink.is-inked {
		animation: yomi-ink 540ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
	}

	.series-row--review .series-row__title {
		text-decoration: underline dotted var(--red);
		text-underline-offset: 4px;
	}

	@media (max-width: 680px) {
		.series-row {
			grid-template-columns: 24px 38px minmax(0, 1fr) 52px 38px;
			gap: 9px;
			padding-inline: 7px 6px;
			min-height: 76px;
		}

		.series-row__title {
			font-size: 15px;
		}

		.series-row__chapter {
			font-size: 21px;
		}

		.quick {
			width: 38px;
			height: 38px;
		}

	}

	@media (max-width: 400px) {
		.series-row__no {
			display: none;
		}

		.series-row {
			grid-template-columns: 38px minmax(0, 1fr) 48px 38px;
		}

		.series-row--selecting {
			grid-template-columns: 22px 38px minmax(0, 1fr) 48px 38px;
		}

		.series-row__meta {
			font-size: 8px;
		}
	}
</style>
