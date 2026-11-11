<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import type { Series } from '../../../shared/model.ts';
	import { STATUS_LABEL } from '../../../shared/model.ts';
	import { app } from '../app.svelte.ts';
	import { prefersReducedMotion } from '../motion.ts';
	import { portal } from '../portal.ts';
	import Cover from './Cover.svelte';
	import Icon from './Icon.svelte';

	let { fromId, onClose }: { fromId: string; onClose: () => void } = $props();

	let search = $state('');
	let selectedId = $state('');
	let busy = $state(false);

	const from = $derived(app.seriesById(fromId));
	const selected = $derived(app.seriesById(selectedId));

	function normal(value: string): string {
		return value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, ' ')
			.trim();
	}

	function tokens(value: string): Set<string> {
		return new Set(normal(value).split(' ').filter((word) => word.length > 1));
	}

	function overlap(a: string, b: string): number {
		const left = tokens(a);
		const right = tokens(b);
		let shared = 0;
		for (const word of left) if (right.has(word)) shared += 1;
		return shared;
	}

	function score(candidate: Series): number {
		if (!from) return 0;
		let value = 0;
		if (normal(candidate.title) === normal(from.title)) value += 100;
		value += overlap(candidate.title, from.title) * 18;
		const fromSites = new Set(app.sourcesFor(from.id).map((source) => source.site));
		for (const source of app.sourcesFor(candidate.id)) {
			if (fromSites.has(source.site)) value += 4;
		}
		return value;
	}

	const candidates = $derived.by(() => {
		const query = normal(search);
		return app.liveSeries
			.filter((series) => series.id !== fromId)
			.filter((series) => !query || normal(series.title).includes(query))
			.map((series) => ({ series, score: score(series) }))
			.sort((a, b) => b.score - a.score || a.series.title.localeCompare(b.series.title));
	});

	$effect(() => {
		document.body.classList.add('is-locked');
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => {
			document.body.classList.remove('is-locked');
			window.removeEventListener('keydown', onKey);
		};
	});

	async function merge(): Promise<void> {
		if (!from || !selected || busy) return;
		busy = true;
		const done = await app.merge(from.id, selected.id);
		busy = false;
		if (done) onClose();
	}
</script>

<div
	class="scrim"
	use:portal
	role="presentation"
	transition:fade={{ duration: prefersReducedMotion ? 0 : 120 }}
	onclick={onClose}
></div>

<div
	class="dialog"
	use:portal
	role="dialog"
	aria-modal="true"
	aria-labelledby="merge-title"
	transition:fly={{ y: prefersReducedMotion ? 0 : 12, duration: prefersReducedMotion ? 0 : 190 }}
>
	<header class="dialog__head">
		<div>
			<p class="eyebrow eyebrow--ink">Merge</p>
			<h2 class="dialog__title" id="merge-title">One row, two URLs</h2>
		</div>
		<button class="icon-btn" aria-label="Close" onclick={onClose}>
			<Icon name="close" size={18} />
		</button>
	</header>

	<div class="dialog__body">
		<p class="dialog__lead">
			Choose the row that should survive. The other row's site URLs and chapter history move here,
			and its notes stay intact if you undo.
		</p>

		<label class="search">
			<Icon name="search" size={16} />
			<input
				class="search__input"
				bind:value={search}
				placeholder="Find the other row"
				aria-label="Search series"
			/>
		</label>

		<div class="candidates" role="listbox" aria-label="Series to merge">
			{#each candidates as candidate (candidate.series.id)}
				{@const stats = app.statsFor(candidate.series)}
				{@const same = from ? normal(candidate.series.title) === normal(from.title) : false}
				<button
					class="candidate"
					class:candidate--selected={selectedId === candidate.series.id}
					role="option"
					aria-selected={selectedId === candidate.series.id}
					onclick={() => (selectedId = candidate.series.id)}
				>
					<Cover url={candidate.series.cover_url} title={candidate.series.title} size="sm" />
					<span class="candidate__copy">
						<span class="candidate__title">{candidate.series.title}</span>
						<span class="candidate__meta">
							{stats.chapterCount} chapters · {STATUS_LABEL[candidate.series.status]}
							{#if same}<span class="candidate__same">same title</span>{/if}
						</span>
					</span>
					<span class="candidate__check" aria-hidden="true">
						{#if selectedId === candidate.series.id}<Icon name="check" size={14} />{/if}
					</span>
				</button>
			{:else}
				<p class="candidates__empty">
					Nothing to merge yet. Add the other site's URL to a separate row first.
				</p>
			{/each}
		</div>

		{#if from && selected}
			<div class="confirm">
				<p class="confirm__eyebrow">Merge preview</p>
				<p class="confirm__line">
					<span>{from.title}</span>
					<Icon name="arrow-right" size={15} />
					<strong>{selected.title}</strong>
				</p>
				<p class="confirm__meta">
					{app.sourcesFor(from.id).length} URL(s) and
					{app.statsFor(from).chapterCount} chapter(s) move. Nothing is deleted; undo is available
					on the surviving series.
				</p>
			</div>
		{/if}
	</div>

	<footer class="dialog__foot">
		<button class="btn btn--red btn--lg" onclick={merge} disabled={!selected || busy}>
			{busy ? 'Merging…' : `Merge into ${selected?.title ?? '…'}`}
			<Icon name="merge" size={16} />
		</button>
		<button class="btn btn--ghost" onclick={onClose}>Cancel</button>
	</footer>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 70;
		background: color-mix(in srgb, var(--ink) 58%, transparent);
	}

	.dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		z-index: 71;
		transform: translate(-50%, -50%);
		display: flex;
		flex-direction: column;
		width: min(640px, calc(100vw - 28px));
		max-height: min(88vh, 760px);
		background: var(--paper);
		border: 2px solid var(--ink);
		box-shadow: 8px 8px 0 var(--ink);
	}

	.dialog__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 18px 20px 14px;
		border-bottom: 1.5px solid var(--ink);
	}

	.dialog__title {
		margin-top: 4px;
		font-family: var(--display);
		font-size: 26px;
		font-weight: 400;
		line-height: 1;
		letter-spacing: -0.025em;
	}

	.dialog__body {
		overflow-y: auto;
		padding: 18px 20px;
	}

	.dialog__lead {
		max-width: 520px;
		font-size: 13px;
		line-height: 1.55;
		color: var(--ink-2);
	}

	.search {
		display: flex;
		align-items: center;
		gap: 9px;
		margin-top: 16px;
		padding: 0 11px;
		border: 1.5px solid var(--ink);
		background: var(--paper);
	}

	.search__input {
		width: 100%;
		min-height: 40px;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 13px;
	}

	.candidates {
		margin-top: 10px;
		max-height: 260px;
		overflow-y: auto;
		border-top: 1px solid var(--rule);
	}

	.candidate {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		padding: 9px 8px;
		border-bottom: 1px solid var(--rule);
		text-align: left;
		transition: background-color 110ms ease;
	}

	.candidate:hover {
		background: var(--paper-2);
	}

	.candidate--selected {
		background: var(--ink);
		color: var(--paper);
	}

	.candidate--selected:hover {
		background: var(--ink);
	}

	.candidate__copy {
		min-width: 0;
		flex: 1;
	}

	.candidate__title {
		display: block;
		font-size: 14px;
		font-weight: 700;
		line-height: 1.25;
	}

	.candidate__meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 7px;
		margin-top: 3px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.04em;
		opacity: 0.68;
	}

	.candidate__same {
		padding: 1px 4px;
		border: 1px solid currentColor;
		text-transform: uppercase;
	}

	.candidate__check {
		width: 22px;
		flex: 0 0 auto;
	}

	.candidates__empty {
		padding: 24px 4px;
		font-size: 13px;
		color: var(--ink-2);
	}

	.confirm {
		margin-top: 16px;
		padding: 12px 14px;
		background: var(--paper-2);
		border-left: 4px solid var(--red);
	}

	.confirm__eyebrow {
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-2);
	}

	.confirm__line {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 5px;
		font-size: 14px;
	}

	.confirm__line strong {
		font-weight: 700;
	}

	.confirm__meta {
		margin-top: 5px;
		font-size: 11px;
		line-height: 1.5;
		color: var(--ink-2);
	}

	.dialog__foot {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		padding: 14px 20px calc(14px + env(safe-area-inset-bottom, 0px));
		border-top: 1.5px solid var(--ink);
	}

	.dialog__foot .btn--red {
		flex: 1;
		justify-content: space-between;
		min-width: 210px;
	}

	@media (max-width: 560px) {
		.dialog {
			top: auto;
			bottom: 0;
			left: 0;
			transform: none;
			width: 100vw;
			max-height: 88vh;
			border-left: 0;
			border-right: 0;
			border-bottom: 0;
			box-shadow: none;
		}

		.dialog__body {
			padding-inline: 16px;
		}

		.dialog__head,
		.dialog__foot {
			padding-inline: 16px;
		}
	}
</style>
