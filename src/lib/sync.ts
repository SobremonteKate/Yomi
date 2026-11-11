import type { IDBPDatabase } from 'idb';
import {
	eventEqual,
	mergeEvent,
	mergeMergeRecord,
	mergeSeries,
	mergeSource,
	newSeries,
	nowStamp,
	ensureEventStamps,
	ensureSeriesStamps,
	ensureSourceStamps,
	seriesEqual,
	sourceEqual
} from '../../shared/merge.ts';
import type {
	Device,
	MergeRecord,
	ProgressEvent,
	Series,
	Source
} from '../../shared/model.ts';
import type {
	ChangeKind,
	ChangeRow,
	SyncPush,
	SyncRequest,
	SyncResponse
} from '../../shared/protocol.ts';
import {
	clearOutbox,
	eventKey,
	getDb,
	getMeta,
	getOrCreateDevice,
	outboxKey,
	pendingCount,
	queueRow,
	rowVersion,
	saveDevice,
	setMeta,
	type OutboxEntry,
	type YomiDB
} from './db.ts';
import { syncState } from './sync-status.svelte.ts';

const listeners = new Set<() => void>();
let inFlight: Promise<SyncOutcome> | null = null;
let scheduleTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

export interface SyncOutcome {
	ok: boolean;
	pushed: number;
	pulled: number;
	message?: string;
}

export function onSyncApplied(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function notify(): void {
	for (const listener of listeners) {
		try {
			listener();
		} catch (error) {
			console.warn('sync listener failed', error);
		}
	}
}

export function resolveEndpoint(raw: string): string {
	const text = raw.trim();
	if (!text) {
		if (typeof location === 'undefined') return '';
		return `${location.origin}/api`;
	}
	try {
		const base = typeof location === 'undefined' ? 'http://localhost' : location.origin;
		const url = new URL(text, base);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
		let path = url.pathname.replace(/\/+$/, '');
		if (!path) path = '/api';
		path = path.replace(/\/(sync|ingest|ping|export)$/i, '');
		if (!path.endsWith('/api')) path = `${path}/api`;
		url.pathname = path;
		url.search = '';
		url.hash = '';
		return url.toString().replace(/\/+$/, '');
	} catch {
		return '';
	}
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 20_000): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), ms);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

class SyncHttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function readError(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: string; detail?: string };
		return [body.error, body.detail].filter(Boolean).join(' — ') || `HTTP ${response.status}`;
	} catch {
		return `HTTP ${response.status}`;
	}
}

function normalizeSeries(row: Series): Series {
	return ensureSeriesStamps({
		...row,
		alt_titles: Array.isArray(row.alt_titles) ? row.alt_titles : [],
		needs_review: Boolean(row.needs_review),
		field_ts: row.field_ts ?? {}
	});
}

function normalizeSource(row: Source): Source {
	return ensureSourceStamps({
		...row,
		field_ts: row.field_ts ?? {}
	});
}

function normalizeEvent(row: ProgressEvent): ProgressEvent {
	return ensureEventStamps({
		...row,
		field_ts: row.field_ts ?? {}
	});
}

async function getEntity(
	db: IDBPDatabase<YomiDB>,
	entity: ChangeKind,
	id: string
): Promise<Series | Source | ProgressEvent | MergeRecord | null> {
	switch (entity) {
		case 'series':
			return (await db.get('series', id)) ?? null;
		case 'source':
			return (await db.get('sources', id)) ?? null;
		case 'event':
			return (await db.get('events', id)) ?? null;
		case 'merge':
			return (await db.get('merges', id)) ?? null;
	}
}

interface SentEntry {
	key: string;
	entity: ChangeKind;
	id: string;
	version: string;
}

interface PreparedPush {
	push: SyncPush;
	sent: Map<string, SentEntry>;
	missing: string[];
}

async function preparePush(
	db: IDBPDatabase<YomiDB>,
	entries: OutboxEntry[]
): Promise<PreparedPush> {
	const push: SyncPush = { series: [], sources: [], events: [], merges: [] };
	const sent = new Map<string, SentEntry>();
	const missing: string[] = [];
	for (const entry of entries) {
		const row = await getEntity(db, entry.entity, entry.row_id);
		if (!row) {
			missing.push(entry.key);
			continue;
		}
		if (entry.entity === 'series') push.series.push(row as Series);
		else if (entry.entity === 'source') push.sources.push(row as Source);
		else if (entry.entity === 'event') push.events.push(row as ProgressEvent);
		else push.merges.push(row as MergeRecord);
		sent.set(entry.key, {
			key: entry.key,
			entity: entry.entity,
			id: entry.row_id,
			version: rowVersion(row)
		});
	}
	return { push, sent, missing };
}

async function postSync(
	endpoint: string,
	token: string,
	body: SyncRequest
): Promise<SyncResponse> {
	const response = await fetchWithTimeout(`${endpoint}/sync`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(body)
	});
	if (!response.ok) {
		throw new SyncHttpError(response.status, await readError(response));
	}
	const data = (await response.json()) as SyncResponse & { ok?: boolean; error?: string };
	if (!data || data.ok !== true || !Array.isArray(data.changes)) {
		throw new Error(data?.error || 'The server sent an unexpected sync response.');
	}
	return data;
}

async function clearSentIfUnchanged(
	db: IDBPDatabase<YomiDB>,
	sent: Map<string, SentEntry>,
	entity: ChangeKind,
	id: string
): Promise<void> {
	const entry = sent.get(outboxKey(entity, id));
	if (!entry) return;
	const current = await getEntity(db, entity, id);
	if (!current || rowVersion(current) === entry.version) {
		await clearOutbox(db, entity, id);
	}
}

/**
 * When two devices created the same URL, the server owns the surviving source.
 * Move local events onto it, then remove the duplicate source row.
 */
async function adoptServerSource(
	db: IDBPDatabase<YomiDB>,
	raw: Source,
	device: Device
): Promise<void> {
	const server = normalizeSource(raw);
	const samePath = await db.getFromIndex('sources', 'by-path', server.normalized_path);
	if (samePath && samePath.id !== server.id) {
		const now = new Date();
		const stamp = nowStamp(device.id, now);
		const events = await db.getAll('events');
		const localEvents = events.filter((event) => event.source_id === samePath.id);
		for (const event of localEvents) {
			const duplicate = await db.getFromIndex(
				'events',
				'by-unique',
				eventKey(server.series_id, event.chapter, server.id)
			);
			if (duplicate && duplicate.id !== event.id) {
				await db.delete('events', event.id);
				await clearOutbox(db, 'event', event.id);
				continue;
			}
			const next: ProgressEvent = {
				...event,
				series_id: server.series_id,
				source_id: server.id,
				updated_at: now.toISOString(),
				device_id: device.id,
				field_ts: { ...event.field_ts, series_id: stamp, source_id: stamp }
			};
			await db.put('events', next);
			await queueRow(db, 'event', next.id, rowVersion(next));
		}
		await clearOutbox(db, 'source', samePath.id);
		await db.delete('sources', samePath.id);
	}

	const base = await db.get('sources', server.id);
	const merged = mergeSource(base, server);
	await db.put('sources', merged);
	if (sourceEqual(merged, server)) await clearOutbox(db, 'source', server.id);
}

async function adoptServerEvent(
	db: IDBPDatabase<YomiDB>,
	raw: ProgressEvent,
	device: Device
): Promise<void> {
	const server = normalizeEvent(raw);
	const duplicate = await db.getFromIndex(
		'events',
		'by-unique',
		eventKey(server.series_id, server.chapter, server.source_id)
	);
	if (duplicate && duplicate.id !== server.id) {
		await db.delete('events', duplicate.id);
		await clearOutbox(db, 'event', duplicate.id);
	}
	const base = await db.get('events', server.id);
	const merged = mergeEvent(base, server);
	await db.put('events', merged);
	if (eventEqual(merged, server)) await clearOutbox(db, 'event', server.id);
	void device;
}

async function applyChange(
	db: IDBPDatabase<YomiDB>,
	change: ChangeRow,
	device: Device
): Promise<void> {
	if (change.kind === 'series') {
		const server = normalizeSeries(change.row as Series);
		const base = await db.get('series', server.id);
		const merged = mergeSeries(base, server);
		await db.put('series', merged);
		if (seriesEqual(merged, server)) await clearOutbox(db, 'series', server.id);
		return;
	}
	if (change.kind === 'source') {
		await adoptServerSource(db, change.row as Source, device);
		return;
	}
	if (change.kind === 'event') {
		await adoptServerEvent(db, change.row as ProgressEvent, device);
		return;
	}
	const server = change.row as MergeRecord;
	const base = await db.get('merges', server.id);
	const merged = mergeMergeRecord(base, server);
	await db.put('merges', merged);
	if (merged.undone_at === server.undone_at) await clearOutbox(db, 'merge', server.id);
}

async function applyResponse(
	db: IDBPDatabase<YomiDB>,
	response: SyncResponse,
	sent: Map<string, SentEntry>,
	device: Device
): Promise<void> {
	for (const row of response.conflicts?.sources ?? []) {
		await adoptServerSource(db, row, device);
	}
	for (const row of response.conflicts?.events ?? []) {
		await adoptServerEvent(db, row, device);
	}
	const accepted = response.accepted ?? { series: [], sources: [], events: [], merges: [] };
	for (const id of accepted.series ?? []) await clearSentIfUnchanged(db, sent, 'series', id);
	for (const id of accepted.sources ?? []) await clearSentIfUnchanged(db, sent, 'source', id);
	for (const id of accepted.events ?? []) await clearSentIfUnchanged(db, sent, 'event', id);
	for (const id of accepted.merges ?? []) await clearSentIfUnchanged(db, sent, 'merge', id);

	for (const change of response.changes) {
		await applyChange(db, change, device);
	}
}

async function runSync(): Promise<SyncOutcome> {
	const db = await getDb();
	const device = await getOrCreateDevice();
	const token = String(await getMeta('token', '')).trim();
	const endpoint = resolveEndpoint(String(await getMeta('endpoint', '')));
	syncState.pending = await db.count('outbox');

	if (!token) {
		syncState.phase = 'local';
		syncState.error = '';
		notify();
		return { ok: false, pushed: 0, pulled: 0, message: 'No sync token set.' };
	}
	if (!endpoint) {
		syncState.phase = 'error';
		syncState.error = 'The sync address is not a valid URL.';
		notify();
		return { ok: false, pushed: 0, pulled: 0, message: syncState.error };
	}
	if (typeof navigator !== 'undefined' && !navigator.onLine) {
		syncState.phase = 'offline';
		syncState.error = '';
		notify();
		return { ok: false, pushed: 0, pulled: 0, message: 'Offline.' };
	}

	syncState.phase = 'syncing';
	syncState.error = '';
	let lastSeq = Number(await getMeta('last_seq', 0)) || 0;
	let pushed = 0;
	let pulled = 0;

	try {
		for (let round = 0; round < 30; round += 1) {
			const entries = (await db.getAllFromIndex('outbox', 'by-queued')).slice(0, 140);
			const before = await db.count('outbox');
			const prepared = await preparePush(db, entries);
			for (const key of prepared.missing) await db.delete('outbox', key);

			const request: SyncRequest = {
				since: lastSeq,
				device,
				push: prepared.push
			};
			const response = await postSync(endpoint, token, request);
			await applyResponse(db, response, prepared.sent, device);

			pushed += prepared.sent.size;
			pulled += response.changes.length;
			lastSeq = Math.max(lastSeq, Number(response.cursor) || 0, 0);
			await setMeta('last_seq', lastSeq);

			const after = await db.count('outbox');
			const sentNothing = prepared.sent.size === 0;
			if (!response.hasMore && after === 0) break;
			if (!response.hasMore && sentNothing) break;
			if (!response.hasMore && !sentNothing && after >= before) {
				syncState.error = 'Some changes could not sync yet. They stay queued.';
				break;
			}
		}

		const now = new Date().toISOString();
		await saveDevice({ ...device, last_sync_at: now });
		await setMeta('last_sync_at', now);
		syncState.lastSyncAt = now;
		syncState.phase = 'synced';
		syncState.pending = await db.count('outbox');
		notify();
		return { ok: true, pushed, pulled };
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Sync failed.';
		if (error instanceof SyncHttpError && error.status === 401) {
			syncState.error = 'The token was rejected. Check Settings.';
			syncState.phase = 'error';
		} else if (typeof navigator !== 'undefined' && !navigator.onLine) {
			syncState.phase = 'offline';
			syncState.error = '';
		} else if (
			error instanceof TypeError ||
			(error instanceof Error && (error.name === 'AbortError' || /fetch|network/i.test(error.message)))
		) {
			syncState.phase = 'offline';
			syncState.error = '';
		} else {
			syncState.phase = 'error';
			syncState.error = message;
		}
		syncState.pending = await db.count('outbox');
		notify();
		return { ok: false, pushed, pulled, message };
	}
}

export async function syncNow(): Promise<SyncOutcome> {
	if (inFlight) return inFlight;
	inFlight = runSync().finally(() => {
		inFlight = null;
	});
	return inFlight;
}

export function scheduleSync(): void {
	if (scheduleTimer) clearTimeout(scheduleTimer);
	scheduleTimer = setTimeout(() => {
		scheduleTimer = null;
		void syncNow();
	}, 800);
}

export async function refreshPending(): Promise<void> {
	try {
		syncState.pending = await pendingCount();
	} catch {
		// The database may not be open yet during startup.
	}
}

export async function initSyncState(): Promise<void> {
	const [last, token, pending] = await Promise.all([
		getMeta<string | null>('last_sync_at', null),
		getMeta<string>('token', ''),
		pendingCount()
	]);
	syncState.lastSyncAt = last;
	syncState.pending = pending;
	syncState.phase = token.trim() ? 'idle' : 'local';
}

export function startSyncLoop(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	window.addEventListener('online', () => void syncNow());
	window.addEventListener('focus', () => void syncNow());
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') void syncNow();
	});
	window.setInterval(() => {
		if (document.visibilityState === 'visible') void syncNow();
	}, 60_000);
	void initSyncState().then(() => syncNow());
}

export interface ConnectionResult {
	ok: boolean;
	message: string;
	cursor?: number;
}

export async function testConnection(endpointRaw: string, token: string): Promise<ConnectionResult> {
	const endpoint = resolveEndpoint(endpointRaw);
	if (!endpoint) return { ok: false, message: 'Enter a valid Worker URL.' };
	if (!token.trim()) return { ok: false, message: 'Paste the sync token first.' };
	try {
		const response = await fetchWithTimeout(
			`${endpoint}/ping`,
			{ headers: { Authorization: `Bearer ${token.trim()}` } },
			10_000
		);
		if (response.status === 401) {
			return { ok: false, message: 'The Worker rejected that token.' };
		}
		if (response.status === 503) {
			return { ok: false, message: 'The Worker has no SYNC_TOKEN secret set.' };
		}
		if (!response.ok) {
			return { ok: false, message: await readError(response) };
		}
		const data = (await response.json()) as { ok?: boolean; cursor?: number };
		if (!data.ok) return { ok: false, message: 'The Worker replied with an error.' };
		return { ok: true, message: 'Connected.', cursor: data.cursor ?? 0 };
	} catch {
		return { ok: false, message: 'Could not reach that address. Check the URL and connection.' };
	}
}

export async function resetCursor(): Promise<void> {
	await setMeta('last_seq', 0);
}

export { syncState } from './sync-status.svelte.ts';

// Re-export for screens that only need a blank series shape in previews.
export { newSeries };
