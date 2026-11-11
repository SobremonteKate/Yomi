export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'offline' | 'local' | 'error';

export const syncState = $state({
	phase: 'idle' as SyncPhase,
	lastSyncAt: null as string | null,
	pending: 0,
	error: ''
});
