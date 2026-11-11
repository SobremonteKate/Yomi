<script lang="ts">
	import { browser } from '../browser.ts';

	let {
		url,
		title,
		size = 'sm'
	}: { url: string | null | undefined; title: string; size?: 'sm' | 'md' | 'lg' } = $props();
	let failed = $state(false);

	$effect(() => {
		url;
		failed = false;
	});

	const initial = $derived(title.trim().charAt(0).toUpperCase() || '·');
</script>

<div class="cover cover--{size}" class:cover--empty={!url || failed} aria-hidden="true">
	{#if url && !failed && browser}
		<img
			src={url}
			alt=""
			loading="lazy"
			decoding="async"
			referrerpolicy="no-referrer"
			onerror={() => (failed = true)}
		/>
	{:else}
		<span class="cover__initial">{initial}</span>
	{/if}
</div>

<style>
	.cover {
		position: relative;
		flex: 0 0 auto;
		border: 1.5px solid var(--ink);
		background: var(--paper-2);
		overflow: hidden;
	}

	.cover img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.cover--sm {
		width: 42px;
		height: 58px;
	}

	.cover--md {
		width: 62px;
		height: 86px;
	}

	.cover--lg {
		width: 92px;
		height: 128px;
	}

	.cover--empty::before {
		content: '';
		position: absolute;
		inset: 0;
		background-image: radial-gradient(var(--ink) 0.6px, transparent 0.7px);
		background-size: 4px 4px;
		opacity: 0.14;
	}

	.cover--empty::after {
		content: '';
		position: absolute;
		right: 0;
		bottom: 0;
		width: 9px;
		height: 9px;
		background: var(--red);
	}

	.cover__initial {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		font-family: var(--display);
		font-size: 22px;
		line-height: 1;
		color: var(--ink);
		z-index: 1;
	}

	.cover--md .cover__initial {
		font-size: 28px;
	}

	.cover--lg .cover__initial {
		font-size: 38px;
	}
</style>
