<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { app } from './lib/app.svelte.ts';
	import { prefersReducedMotion } from './lib/motion.ts';
	import AddDrawer from './lib/components/AddDrawer.svelte';
	import Brand from './lib/components/Brand.svelte';
	import Icon from './lib/components/Icon.svelte';
	import Library from './lib/components/Library.svelte';
	import Onboarding from './lib/components/Onboarding.svelte';
	import SeriesDetail from './lib/components/SeriesDetail.svelte';
	import Settings from './lib/components/Settings.svelte';
	import ShareView from './lib/components/ShareView.svelte';
	import Stats from './lib/components/Stats.svelte';
	import SyncBadge from './lib/components/SyncBadge.svelte';
	import Toast from './lib/components/Toast.svelte';

	onMount(() => {
		void app.init();
	});

	$effect(() => {
		const route = app.route;
		const title =
			route.name === 'settings'
				? 'Settings — Yomi'
				: route.name === 'stats'
					? 'Reading — Yomi'
					: route.name === 'share'
						? 'Shared shelf — Yomi'
						: route.name === 'series'
							? `${app.seriesById(route.id)?.title ?? 'Series'} — Yomi`
							: 'Yomi — reading log';
		document.title = title;
	});

	// Each screen flies in under the masthead, so a route change reads as a
	// page turn rather than a repaint.
	const routeKey = $derived(
		app.route.name === 'series' ? `series:${app.route.id}` : app.route.name
	);

	let previousRoute = '';
	$effect(() => {
		const key =
			app.route.name === 'series'
				? `series:${app.route.id}`
				: app.route.name;
		if (previousRoute && key !== previousRoute) {
			window.scrollTo(0, 0);
		}
		previousRoute = key;
	});
</script>

<a class="skip" href="#main">Skip to content</a>

<header class="masthead">
	<div class="masthead__inner">
		<Brand />
		<div class="masthead__actions">
			<SyncBadge />
			<button
				class="icon-btn share-btn"
				aria-label="Share shelf"
				title="Share shelf"
				onclick={() => void app.shareShelf()}
			>
				<Icon name="share" size={17} />
			</button>
			<button
				class="icon-btn stats-btn"
				class:settings-btn--active={app.route.name === 'stats'}
				aria-label="Reading stats"
				title="Reading stats"
				onclick={() => app.navigate('stats')}
			>
				<Icon name="chart" size={17} />
			</button>
			<button
				class="btn btn--sm tour-btn"
				title="Replay the welcome tour"
				onclick={() => app.openOnboarding()}
			>
				Tour
			</button>
			<button class="btn btn--sm add-btn" onclick={() => app.openAdd()}>
				<Icon name="plus" size={14} stroke={2} />
				<span>Add</span>
			</button>
			<button
				class="icon-btn settings-btn"
				class:settings-btn--active={app.route.name === 'settings'}
				aria-label="Settings"
				title="Settings"
				onclick={() => app.navigate('settings')}
			>
				<Icon name="settings" size={18} />
			</button>
		</div>
	</div>
</header>

{#if !app.ready}
	<main class="boot" id="main">
		<span class="boot__hanko hanko stamp-in" lang="ja" aria-hidden="true">読</span>
		<p class="eyebrow boot__line">Opening the ledger</p>
		<p class="boot__copy boot__line boot__line--second">Reading your local shelf…</p>
	</main>
{:else if app.loadError}
	<main class="boot" id="main">
		<p class="eyebrow">Local storage</p>
		<h1 class="boot__title">The shelf did not open.</h1>
		<p class="boot__copy">{app.loadError}</p>
		<button class="btn btn--ink" onclick={() => window.location.reload()}>Reload</button>
	</main>
{:else}
	<main class="shell" id="main">
		{#if app.captureNotice}
			<section class="capture-notice" role="alert">
				<p class="eyebrow capture-notice__eyebrow">Capture link</p>
				<p class="capture-notice__title">The link arrived without a page URL.</p>
				<p class="capture-notice__copy">{app.captureNotice.message}</p>
				<p class="capture-notice__label">Yomi received this address</p>
				<code class="capture-notice__href">{app.captureNotice.href}</code>
				<div class="capture-notice__actions">
					<button class="btn btn--sm" onclick={() => app.openAdd()}>
						Add by hand
					</button>
					<button
						class="btn btn--sm btn--ghost"
						onclick={() => app.dismissCaptureNotice()}
					>
						Dismiss
					</button>
				</div>
			</section>
		{/if}
		{#key routeKey}
			<div
				class="view view-enter"
				in:fly={{ y: prefersReducedMotion ? 0 : 10, duration: prefersReducedMotion ? 0 : 220 }}
			>
				{#if app.route.name === 'library'}
					<Library />
				{:else if app.route.name === 'settings'}
					<Settings />
				{:else if app.route.name === 'series'}
					<SeriesDetail seriesId={app.route.id} />
				{:else if app.route.name === 'stats'}
					<Stats />
				{:else if app.route.name === 'share'}
					<ShareView token={app.route.token} api={app.route.api} />
				{/if}
			</div>
		{/key}
	</main>
{/if}

{#if app.ready && app.route.name !== 'share'}
	<nav class="dock" aria-label="Primary">
		<a
			class="dock__item"
			class:is-active={app.route.name === 'library' || app.route.name === 'series'}
			href="#/"
			aria-current={app.route.name === 'library' || app.route.name === 'series' ? 'page' : undefined}
		>
			<Icon name="book" size={19} />
			<span>Shelf</span>
		</a>
		<a
			class="dock__item"
			class:is-active={app.route.name === 'stats'}
			href="#/stats"
			aria-current={app.route.name === 'stats' ? 'page' : undefined}
		>
			<Icon name="chart" size={19} />
			<span>Reading</span>
		</a>
		<button class="dock__add" onclick={() => app.openAdd()} aria-label="Add a series">
			<Icon name="plus" size={20} stroke={2} />
			<span>Add</span>
		</button>
		<button class="dock__item" onclick={() => void app.shareShelf()} aria-label="Share shelf">
			<Icon name="share" size={19} />
			<span>Share</span>
		</button>
		<a
			class="dock__item"
			class:is-active={app.route.name === 'settings'}
			href="#/settings"
			aria-current={app.route.name === 'settings' ? 'page' : undefined}
		>
			<Icon name="settings" size={19} />
			<span>Settings</span>
		</a>
	</nav>
{/if}

<footer class="foot">
	<div class="foot__inner">
		<span class="foot__mark">
			<span class="foot__hanko" lang="ja" aria-hidden="true">読</span>
			Yomi
		</span>
		<span class="foot__line">Still reading.</span>
	</div>
</footer>

<AddDrawer />
<Onboarding />
<Toast />

<style>
	.skip {
		position: absolute;
		left: 12px;
		top: -60px;
		z-index: 100;
		padding: 8px 12px;
		background: var(--ink);
		color: var(--paper);
		font-family: var(--mono);
		font-size: 11px;
	}

	.skip:focus {
		top: 12px;
	}

	.masthead__actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.add-btn {
		gap: 6px;
		height: 36px;
	}

	.tour-btn {
		height: 36px;
		padding-inline: 11px;
	}

	.settings-btn,
	.stats-btn,
	.share-btn {
		width: 36px;
		height: 36px;
	}

	/* The phone dock carries the primary actions, so it is hidden on desktop. */
	.dock {
		display: none;
	}

	.settings-btn--active {
		background: var(--ink);
		color: var(--paper);
	}

	.view {
		min-width: 0;
	}

	.capture-notice {
		margin: 2px 0 20px;
		padding: 14px 16px;
		border: var(--line) solid var(--ink);
		border-left: 5px solid var(--red);
		background: var(--paper-2);
	}

	.capture-notice__eyebrow {
		color: var(--ink-2);
	}

	.capture-notice__title {
		margin-top: 4px;
		font-size: 18px;
		font-weight: 700;
		line-height: 1.25;
	}

	.capture-notice__copy {
		margin-top: 6px;
		max-width: 60ch;
		font-size: 12px;
		line-height: 1.55;
		color: var(--ink-2);
	}

	.capture-notice__label {
		margin-top: 12px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.capture-notice__href {
		display: block;
		margin-top: 4px;
		padding: 8px 10px;
		border: 1px solid var(--rule);
		background: var(--paper);
		font-family: var(--mono);
		font-size: 10.5px;
		line-height: 1.5;
		overflow-wrap: anywhere;
		user-select: all;
	}

	.capture-notice__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 12px;
	}

	.boot {
		min-height: 58vh;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 8px;
		max-width: 520px;
		padding-block: 60px;
	}

	.boot__hanko {
		width: 46px;
		height: 46px;
		font-size: 27px;
		margin-bottom: 8px;
		animation-delay: 60ms;
	}

	.boot__line {
		animation: yomi-rise-soft 320ms ease-out both;
		animation-delay: 190ms;
	}

	.boot__line--second {
		animation-delay: 260ms;
	}

	.boot__title {
		margin-top: 4px;
		font-family: var(--display);
		font-size: clamp(30px, 5vw, 44px);
		font-weight: 400;
		line-height: 1.02;
	}

	.boot__copy {
		font-size: 14px;
		line-height: 1.55;
		color: var(--ink-2);
		margin-bottom: 14px;
	}

	.foot {
		border-top: 1px solid var(--rule);
	}

	.foot__inner {
		width: min(100%, var(--page));
		margin: 0 auto;
		padding: 16px var(--gutter) calc(20px + env(safe-area-inset-bottom, 0px));
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		font-family: var(--mono);
		font-size: 8px;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--ink-3);
	}

	.foot__mark {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		color: var(--ink-2);
	}

	.foot__hanko {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		background: var(--red);
		color: var(--on-signal);
		font-family: var(--jp);
		font-size: 11px;
		line-height: 1;
		transform: rotate(-3deg);
	}

	.foot__line {
		text-align: right;
	}

	@media (max-width: 700px) {
		.stats-btn,
		.settings-btn,
		.add-btn,
		.share-btn,
		.tour-btn {
			display: none;
		}

		.dock {
			position: fixed;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: 40;
			display: grid;
			grid-template-columns: repeat(5, 1fr);
			background: var(--paper);
			border-top: 1.5px solid var(--ink);
			padding-bottom: env(safe-area-inset-bottom, 0px);
		}

		.dock__item,
		.dock__add {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: 3px;
			min-width: 0;
			min-height: 56px;
			border-right: 1px solid var(--rule);
			font-family: var(--mono);
			font-size: 8px;
			letter-spacing: 0.08em;
			text-transform: uppercase;
			color: var(--ink-2);
		}

		.dock__item:last-child {
			border-right: 0;
		}

		.dock__item.is-active {
			background: var(--paper-2);
			box-shadow: inset 0 3px 0 var(--red);
			color: var(--ink);
			font-weight: 500;
		}

		.dock__add {
			background: var(--red);
			border-right-color: var(--ink);
			color: var(--on-signal);
			font-weight: 500;
		}

		.dock__add:active {
			transform: translateY(1px);
		}

		.foot__inner {
			padding-bottom: calc(74px + env(safe-area-inset-bottom, 0px));
		}
	}

	@media (max-width: 560px) {
		.masthead__inner {
			padding-block: 11px;
		}

		.add-btn {
			width: 36px;
			padding: 0;
		}

		.add-btn span {
			display: none;
		}

		.masthead__actions {
			gap: 6px;
		}

		.foot__line {
			display: none;
		}
	}
</style>
