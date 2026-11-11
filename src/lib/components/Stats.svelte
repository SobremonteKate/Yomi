<script lang="ts">
	import { app } from '../app.svelte.ts';
	import Icon from './Icon.svelte';

	const stats = $derived(app.readingStats);
	const month = $derived(stats.thisMonth);
	const maxMonth = $derived(Math.max(1, ...stats.months.map((entry) => entry.chapters)));

	function shortMonth(label: string): string {
		const [name] = label.split(' ');
		return name.slice(0, 3);
	}

	function dayLabel(day: string): string {
		const [year, monthPart, date] = day.split('-').map(Number);
		const parsed = new Date(year, (monthPart ?? 1) - 1, date);
		if (!Number.isFinite(parsed.getTime())) return day;
		return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<div class="stats">
	<nav class="stats__top" aria-label="Back">
		<a class="back" href="#/">
			<Icon name="arrow-left" size={14} />
			Shelf
		</a>
	</nav>

	<header class="stats__head">
		<p class="eyebrow eyebrow--ink">Ledger</p>
		<h1 class="stats__title">Your reading</h1>
		<p class="stats__lead">
			Counted from the chapter events on this shelf. A chapter you removed stays out of the
			numbers.
		</p>
	</header>

	{#if stats.chapters === 0}
		<div class="empty">
			<p class="eyebrow">Nothing logged yet</p>
			<h2 class="empty__title">The first chapter starts the count.</h2>
			<p class="empty__copy">
				Log a chapter from any series, or capture one from a reading site, and this page fills
				in.
			</p>
			<a class="btn btn--ink" href="#/">Back to the shelf</a>
		</div>
	{:else}
		<dl class="figures">
			<div class="figure">
				<dt class="mono">This month</dt>
				<dd class="figure__value">{month.chapters}</dd>
				<dd class="figure__note">
					{month.chapters === 1 ? 'chapter' : 'chapters'} · {month.seriesTouched}
					{month.seriesTouched === 1 ? 'series' : 'series'}
				</dd>
			</div>
			<div class="figure">
				<dt class="mono">All time</dt>
				<dd class="figure__value">{stats.chapters}</dd>
				<dd class="figure__note">
					{stats.seriesTracked} on the shelf · {stats.seriesCompleted} finished
				</dd>
			</div>
			<div class="figure">
				<dt class="mono">Streak</dt>
				<dd class="figure__value">{stats.streak}</dd>
				<dd class="figure__note">
					{stats.streak === 0
						? 'read today to start one'
						: stats.streak === 1
							? 'day in a row'
							: 'days in a row'}
				</dd>
			</div>
			<div class="figure">
				<dt class="mono">Average score</dt>
				<dd class="figure__value">{stats.averageRating ?? '—'}</dd>
				<dd class="figure__note">
					{stats.rated > 0 ? `across ${stats.rated} rated` : 'no ratings yet'}
				</dd>
			</div>
		</dl>

		<section class="recap" aria-labelledby="recap-title">
			<header class="recap__head">
				<p class="eyebrow">Monthly recap</p>
				<h2 class="recap__title" id="recap-title">{month.label}</h2>
			</header>
			<div class="recap__body">
				<p class="recap__line">
					You read <strong>{month.chapters}</strong>
					{month.chapters === 1 ? 'chapter' : 'chapters'} across
					<strong>{month.seriesTouched}</strong>
					{month.seriesTouched === 1 ? 'series' : 'series'} on
					<strong>{month.daysActive}</strong>
					{month.daysActive === 1 ? 'day' : 'days'}.
				</p>
				{#if month.topSeries}
					<p class="recap__sub">
						Most of it went to <a href={`#/s/${encodeURIComponent(month.topSeries.series.id)}`}
							>{month.topSeries.series.title}</a
						>
						— {month.topSeries.chapters}
						{month.topSeries.chapters === 1 ? 'chapter' : 'chapters'}.
					</p>
				{/if}
				{#if stats.bestDay}
					<p class="recap__sub">
						Busiest day: {dayLabel(stats.bestDay.day)} with {stats.bestDay.chapters}
						{stats.bestDay.chapters === 1 ? 'chapter' : 'chapters'}.
						{#if stats.busiestWeekday}
							{stats.busiestWeekday} is your reading day.
						{/if}
					</p>
				{/if}
			</div>
		</section>

		<section class="chart" aria-labelledby="chart-title">
			<header class="section-head">
				<h2 class="section-title" id="chart-title">Six months</h2>
				<span class="mono section-note">chapters</span>
			</header>
			<ol class="chart__bars">
				{#each stats.months as entry (entry.key)}
					<li class="bar" aria-label={`${entry.label}: ${entry.chapters} chapters`}>
						<span class="bar__count mono">{entry.chapters}</span>
						<span
							class="bar__fill"
							class:bar__fill--current={entry.key === month.key}
							style={`height: ${Math.max(4, Math.round((entry.chapters / maxMonth) * 100))}%`}
						></span>
						<span class="bar__label mono">{shortMonth(entry.label)}</span>
					</li>
				{/each}
			</ol>
		</section>

		{#if stats.topTags.length > 0}
			<section aria-labelledby="tags-title">
				<header class="section-head">
					<h2 class="section-title" id="tags-title">Tags in play</h2>
					<span class="mono section-note">{stats.topTags.length}</span>
				</header>
				<ul class="tags">
					{#each stats.topTags as entry (entry.tag)}
						<li>
							<a class="tag-link" href="#/" onclick={() => (app.tagFilter = entry.tag)}>
								{entry.tag}
								<span class="tag-link__count mono">{entry.count}</span>
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>

<style>
	.stats {
		display: grid;
		gap: 26px;
		padding-bottom: 40px;
	}

	.stats__top {
		margin-bottom: -8px;
	}

	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-family: var(--mono);
		font-size: 9px;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--ink-2);
		text-decoration: none;
	}

	.back:hover {
		color: var(--ink);
	}

	.stats__head {
		display: grid;
		gap: 6px;
		max-width: 640px;
	}

	.stats__title {
		font-family: var(--display);
		font-size: clamp(34px, 6vw, 54px);
		font-weight: 400;
		line-height: 0.98;
		letter-spacing: -0.01em;
	}

	.stats__lead {
		font-size: 13.5px;
		line-height: 1.55;
		color: var(--ink-2);
		max-width: 52ch;
	}

	.figures {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		border-top: var(--line) solid var(--ink);
		border-bottom: 1px solid var(--rule);
	}

	.figure {
		padding: 16px 16px 18px;
		border-left: 1px solid var(--rule);
		display: grid;
		gap: 2px;
		align-content: start;
	}

	.figure:first-child {
		border-left: none;
		padding-left: 0;
	}

	.figure dt {
		font-size: 8px;
		letter-spacing: 0.14em;
		color: var(--ink-3);
	}

	.figure__value {
		font-family: var(--display);
		font-size: clamp(30px, 4.5vw, 44px);
		line-height: 1;
	}

	.figure__note {
		font-size: 11px;
		line-height: 1.4;
		color: var(--ink-2);
	}

	.recap {
		display: grid;
		grid-template-columns: minmax(160px, 220px) minmax(0, 1fr);
		border: var(--line) solid var(--ink);
		background: var(--paper-2);
	}

	.recap__head {
		padding: 18px;
		border-right: 1px solid var(--rule);
		display: grid;
		align-content: start;
		gap: 6px;
	}

	.recap__title {
		font-family: var(--display);
		font-size: clamp(22px, 3vw, 30px);
		font-weight: 400;
		line-height: 1.05;
	}

	.recap__body {
		padding: 18px 20px;
		display: grid;
		gap: 8px;
		align-content: start;
	}

	.recap__line {
		font-size: clamp(15px, 2vw, 18px);
		line-height: 1.5;
	}

	.recap__line strong {
		font-family: var(--display);
		font-weight: 400;
		font-size: 1.15em;
	}

	.recap__sub {
		font-size: 12px;
		line-height: 1.55;
		color: var(--ink-2);
	}

	.recap__sub a {
		color: var(--ink);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.chart {
		display: grid;
		gap: 12px;
	}

	.chart__bars {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		align-items: end;
		gap: 10px;
		height: 168px;
		list-style: none;
		padding: 0;
		margin: 0;
		border-bottom: var(--line) solid var(--ink);
	}

	.bar {
		display: grid;
		grid-template-rows: 1fr auto auto;
		align-items: end;
		justify-items: center;
		gap: 6px;
		height: 100%;
		min-width: 0;
	}

	.bar__count {
		font-size: 9px;
		color: var(--ink-2);
		align-self: end;
	}

	.bar__fill {
		display: block;
		width: min(100%, 44px);
		background: var(--paper-4, #d8d2c4);
		border: 1px solid var(--ink);
		border-bottom: none;
		transition: height 320ms ease;
	}

	.bar__fill--current {
		background: var(--red);
		border-color: var(--red);
	}

	.bar__label {
		font-size: 8px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
		padding-bottom: 6px;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.tag-link {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding: 6px 10px;
		border: 1px solid var(--rule);
		background: var(--paper);
		font-size: 11.5px;
		color: var(--ink);
		text-decoration: none;
	}

	.tag-link:hover {
		border-color: var(--ink);
	}

	.tag-link__count {
		font-size: 8px;
		color: var(--ink-3);
	}

	.empty {
		display: grid;
		gap: 8px;
		justify-items: start;
		padding: 40px 0 20px;
		max-width: 46ch;
	}

	.empty__title {
		font-family: var(--display);
		font-size: clamp(24px, 4vw, 34px);
		font-weight: 400;
		line-height: 1.05;
	}

	.empty__copy {
		font-size: 13px;
		line-height: 1.55;
		color: var(--ink-2);
		margin-bottom: 8px;
	}

	@media (max-width: 760px) {
		.stats {
			gap: 20px;
			padding-bottom: 24px;
		}

		.figures {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.figure {
			padding: 13px 12px 15px;
		}

		.recap__head,
		.recap__body {
			padding: 15px 16px;
		}

		.figure:nth-child(3) {
			border-left: none;
			padding-left: 0;
		}

		.figure:nth-child(n + 3) {
			border-top: 1px solid var(--rule);
		}

		.recap {
			grid-template-columns: 1fr;
		}

		.recap__head {
			border-right: none;
			border-bottom: 1px solid var(--rule);
		}

		.chart__bars {
			height: 140px;
			gap: 6px;
		}
	}
</style>
