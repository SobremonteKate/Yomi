<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { searchCovers, type CoverCandidate } from '../covers.ts';
	import { prefersReducedMotion } from '../motion.ts';
	import { portal } from '../portal.ts';
	import Icon from './Icon.svelte';

	let {
		queries,
		onClose,
		onPick
	}: {
		queries: string[];
		onClose: () => void;
		onPick: (cover: string) => void;
	} = $props();

	let query = $state('');
	let results = $state<CoverCandidate[]>([]);
	let loading = $state(true);
	let message = $state('');

	async function run(terms?: string[]): Promise<void> {
		const list = (terms ?? [query]).map((term) => term.trim()).filter(Boolean);
		if ((list[0] ?? '').length < 2) {
			loading = false;
			message = 'Type at least two letters.';
			return;
		}
		loading = true;
		message = '';
		results = [];
		try {
			if (typeof navigator !== 'undefined' && !navigator.onLine) {
				message = 'You are offline — cover search needs a connection.';
				return;
			}
			const found = await searchCovers(list);
			results = found.candidates;
			if (found.query) query = found.query;
			if (found.candidates.length === 0) {
				message = 'No cover matched that title. Try fewer words, or paste an image URL.';
			}
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		query = queries[0] ?? '';
		void run(queries);
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
	aria-labelledby="cover-picker-title"
	transition:fly={{ y: prefersReducedMotion ? 0 : 12, duration: prefersReducedMotion ? 0 : 190 }}
>
	<header class="dialog__head">
		<div>
			<p class="eyebrow eyebrow--ink">Cover</p>
			<h2 class="dialog__title" id="cover-picker-title">Pick the art</h2>
		</div>
		<button class="icon-btn" aria-label="Close" onclick={onClose}>
			<Icon name="close" size={18} />
		</button>
	</header>

	<div class="dialog__body">
		<form
			class="search"
			onsubmit={(event) => {
				event.preventDefault();
				void run();
			}}
		>
			<Icon name="search" size={16} />
			<input
				class="search__input"
				bind:value={query}
				placeholder="Search a title"
				aria-label="Search covers by title"
			/>
			<button class="btn btn--sm" type="submit" disabled={loading}>
				{loading ? 'Searching…' : 'Search'}
			</button>
		</form>

		{#if results.length > 0}
			<div class="grid" role="group" aria-label="Cover results">
				{#each results as candidate (candidate.cover)}
					<button
						class="tile"
						type="button"
						title={candidate.title}
						onclick={() => onPick(candidate.cover)}
					>
						<img
							src={candidate.cover}
							alt=""
							loading="lazy"
							decoding="async"
							referrerpolicy="no-referrer"
						/>
						<span class="tile__title">{candidate.title}</span>
					</button>
				{/each}
			</div>
		{:else if message}
			<p class="state">{message}</p>
		{:else if loading}
			<p class="state">Searching AniList…</p>
		{/if}

		<p class="note">
			Covers are links from AniList; nothing is uploaded. Choosing one replaces the current
			cover, and you can still paste an image URL instead.
		</p>
	</div>
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
		width: min(720px, calc(100vw - 24px));
		max-height: min(88vh, 780px);
		background: var(--paper);
		border: 2px solid var(--ink);
		box-shadow: 8px 8px 0 var(--ink);
	}

	.dialog__head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 18px 12px;
		border-bottom: 1.5px solid var(--ink);
	}

	.dialog__title {
		margin-top: 4px;
		font-family: var(--display);
		font-size: 24px;
		font-weight: 400;
		line-height: 1;
		letter-spacing: -0.025em;
	}

	.dialog__body {
		overflow-y: auto;
		padding: 16px 18px 18px;
	}

	.search {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 0 0 0 11px;
		border: 1.5px solid var(--ink);
		background: var(--paper);
	}

	.search__input {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 40px;
		border: 0;
		outline: 0;
		background: transparent;
		font-size: 13px;
	}

	.search :global(.btn) {
		flex: 0 0 auto;
		margin: 4px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
		gap: 12px;
		margin-top: 16px;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 5px 5px 7px;
		border: 1.5px solid var(--ink);
		background: var(--paper-2);
		text-align: left;
		transition:
			border-color 110ms ease,
			transform 110ms ease;
	}

	.tile:hover,
	.tile:focus-visible {
		border-color: var(--red);
		transform: translateY(-2px);
	}

	.tile img {
		display: block;
		width: 100%;
		aspect-ratio: 2 / 3;
		object-fit: cover;
		background: var(--paper);
		border: 1px solid var(--rule);
	}

	.tile__title {
		font-size: 10.5px;
		line-height: 1.3;
		letter-spacing: 0.01em;
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.state {
		margin-top: 16px;
		padding: 18px 14px;
		border: 1.5px dashed var(--rule);
		font-size: 13px;
		color: var(--ink-2);
		text-align: center;
	}

	.note {
		margin-top: 16px;
		font-size: 11px;
		line-height: 1.5;
		color: var(--ink-2);
	}

	@media (max-width: 460px) {
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
			gap: 9px;
		}
	}
</style>
