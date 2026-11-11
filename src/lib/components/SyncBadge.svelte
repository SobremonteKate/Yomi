<script lang="ts">
	import { app } from '../app.svelte.ts';
	import { syncState } from '../sync-status.svelte.ts';
	import { relativeTime } from '../../../shared/model.ts';

	const label = $derived.by(() => {
		const pending = syncState.pending;
		if (syncState.phase === 'syncing') return 'Syncing';
		if (syncState.phase === 'local') return 'Local only';
		if (syncState.phase === 'offline') return pending > 0 ? `${pending} queued` : 'Offline';
		if (syncState.phase === 'error') return 'Sync issue';
		if (pending > 0) return `${pending} to sync`;
		if (syncState.lastSyncAt) return `Synced ${relativeTime(syncState.lastSyncAt, app.now)}`;
		return 'Ready';
	});

	const attention = $derived(
		syncState.phase === 'error' || syncState.pending > 0 || syncState.phase === 'offline'
	);
</script>

<button
	class="sync"
	class:sync--attention={attention}
	class:sync--syncing={syncState.phase === 'syncing'}
	title={syncState.error || 'Sync status — open settings'}
	onclick={() => app.navigate('settings')}
>
	<span class="sync__dot" aria-hidden="true"></span>
	<span class="sync__label">{label}</span>
</button>

<style>
	.sync {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		padding: 0 2px;
		font-family: var(--mono);
		font-size: 10px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-2);
		white-space: nowrap;
	}

	.sync:hover {
		color: var(--ink);
	}

	.sync__dot {
		width: 7px;
		height: 7px;
		flex: 0 0 auto;
		border: 1px solid var(--ink);
		background: transparent;
	}

	.sync--attention .sync__dot {
		background: var(--red);
		border-color: var(--red);
	}

	.sync--attention .sync__label {
		color: var(--ink);
	}

	.sync--syncing .sync__dot {
		background: var(--ink);
		border-color: var(--ink);
		animation: yomi-spin 1.2s cubic-bezier(0.65, 0, 0.35, 1) infinite;
	}

	.sync--attention .sync__dot {
		transition: background-color 200ms ease;
	}

	@media (max-width: 560px) {
		.sync__label {
			max-width: 132px;
			overflow: hidden;
			text-overflow: ellipsis;
		}
	}
</style>
