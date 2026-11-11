import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import type {
	Device,
	MergeRecord,
	ProgressEvent,
	Series,
	Source
} from '../../shared/model.ts';
import { defaultDeviceLabel, platformLabel } from '../../shared/model.ts';
import type { ChangeKind } from '../../shared/protocol.ts';

export interface OutboxEntry {
	key: string;
	entity: ChangeKind;
	row_id: string;
	queued_at: number;
	version: string;
}

export interface MetaRow {
	key: string;
	value: unknown;
}

export interface YomiDB extends DBSchema {
	series: {
		key: string;
		value: Series;
		indexes: { 'by-status': string; 'by-updated': string };
	};
	sources: {
		key: string;
		value: Source;
		indexes: { 'by-series': string; 'by-path': string };
	};
	events: {
		key: string;
		value: ProgressEvent;
		indexes: { 'by-series': string; 'by-unique': [string, number, string]; 'by-read': string };
	};
	merges: {
		key: string;
		value: MergeRecord;
		indexes: { 'by-from': string; 'by-to': string };
	};
	devices: {
		key: string;
		value: Device;
	};
	outbox: {
		key: string;
		value: OutboxEntry;
		indexes: { 'by-queued': number };
	};
	meta: {
		key: string;
		value: MetaRow;
	};
}

export type StoreName = 'series' | 'sources' | 'events' | 'merges' | 'outbox' | 'meta' | 'devices';

export type WriteTx = IDBPTransaction<YomiDB, StoreName[], 'readwrite'>;

let databasePromise: Promise<IDBPDatabase<YomiDB>> | null = null;

export function getDb(): Promise<IDBPDatabase<YomiDB>> {
	if (!databasePromise) {
		databasePromise = openDB<YomiDB>('yomi', 1, {
			upgrade(db) {
				const series = db.createObjectStore('series', { keyPath: 'id' });
				series.createIndex('by-status', 'status');
				series.createIndex('by-updated', 'updated_at');

				const sources = db.createObjectStore('sources', { keyPath: 'id' });
				sources.createIndex('by-series', 'series_id');
				sources.createIndex('by-path', 'normalized_path');

				const events = db.createObjectStore('events', { keyPath: 'id' });
				events.createIndex('by-series', 'series_id');
				events.createIndex('by-unique', ['series_id', 'chapter', 'source_id']);
				events.createIndex('by-read', 'read_at');

				const merges = db.createObjectStore('merges', { keyPath: 'id' });
				merges.createIndex('by-from', 'from_series_id');
				merges.createIndex('by-to', 'to_series_id');

				db.createObjectStore('devices', { keyPath: 'id' });
				const outbox = db.createObjectStore('outbox', { keyPath: 'key' });
				outbox.createIndex('by-queued', 'queued_at');
				db.createObjectStore('meta', { keyPath: 'key' });
			}
		});
	}
	return databasePromise;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
	const db = await getDb();
	const row = await db.get('meta', key);
	return row ? (row.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
	const db = await getDb();
	await db.put('meta', { key, value });
}

export async function getOrCreateDevice(): Promise<Device> {
	const existing = await getMeta<Device | null>('device', null);
	if (existing?.id) return existing;
	const device: Device = {
		id: crypto.randomUUID(),
		label: defaultDeviceLabel(),
		platform: platformLabel(),
		last_sync_at: null
	};
	await setMeta('device', device);
	return device;
}

export async function saveDevice(device: Device): Promise<void> {
	await setMeta('device', device);
	const db = await getDb();
	await db.put('devices', device);
}

export function rowVersion(row: { updated_at?: string | null; deleted_at?: string | null }): string {
	return `${row.updated_at ?? ''}|${row.deleted_at ?? ''}`;
}

export function outboxKey(entity: ChangeKind, rowId: string): string {
	return `${entity}:${rowId}`;
}

export function queueWithin(
	tx: WriteTx,
	entity: ChangeKind,
	rowId: string,
	version: string,
	now = Date.now()
): void {
	const key = outboxKey(entity, rowId);
	tx.objectStore('outbox').put({ key, entity, row_id: rowId, queued_at: now, version });
}

export async function queueRow(
	db: IDBPDatabase<YomiDB>,
	entity: ChangeKind,
	rowId: string,
	version: string
): Promise<void> {
	await db.put('outbox', {
		key: outboxKey(entity, rowId),
		entity,
		row_id: rowId,
		queued_at: Date.now(),
		version
	});
}

export async function clearOutbox(
	db: IDBPDatabase<YomiDB>,
	entity: ChangeKind,
	rowId: string
): Promise<void> {
	await db.delete('outbox', outboxKey(entity, rowId));
}

export async function pendingCount(): Promise<number> {
	const db = await getDb();
	return db.count('outbox');
}

export interface LoadedData {
	series: Series[];
	sources: Source[];
	events: ProgressEvent[];
	merges: MergeRecord[];
	device: Device;
	pending: number;
}

export async function loadAll(): Promise<LoadedData> {
	const db = await getDb();
	const [series, sources, events, merges, device, pending] = await Promise.all([
		db.getAll('series'),
		db.getAll('sources'),
		db.getAll('events'),
		db.getAll('merges'),
		getOrCreateDevice(),
		db.count('outbox')
	]);
	return { series, sources, events, merges, device, pending };
}

export async function saveSeries(row: Series): Promise<void> {
	const db = await getDb();
	const tx = db.transaction(['series', 'outbox'], 'readwrite');
	await tx.objectStore('series').put(row);
	queueWithin(tx, 'series', row.id, rowVersion(row));
	await tx.done;
}

export async function saveSource(row: Source): Promise<void> {
	const db = await getDb();
	const tx = db.transaction(['sources', 'outbox'], 'readwrite');
	await tx.objectStore('sources').put(row);
	queueWithin(tx, 'source', row.id, rowVersion(row));
	await tx.done;
}

export async function saveEvent(row: ProgressEvent): Promise<void> {
	const db = await getDb();
	const tx = db.transaction(['events', 'outbox'], 'readwrite');
	await tx.objectStore('events').put(row);
	queueWithin(tx, 'event', row.id, rowVersion(row));
	await tx.done;
}

export async function saveMerge(row: MergeRecord): Promise<void> {
	const db = await getDb();
	const tx = db.transaction(['merges', 'outbox'], 'readwrite');
	await tx.objectStore('merges').put(row);
	queueWithin(tx, 'merge', row.id, rowVersion(row));
	await tx.done;
}

export async function findSourceByPath(path: string): Promise<Source | undefined> {
	const db = await getDb();
	return db.getFromIndex('sources', 'by-path', path);
}

export function eventKey(
	seriesId: string,
	chapter: number,
	sourceId: string
): [string, number, string] {
	return [seriesId, chapter, sourceId];
}

export async function findEventUnique(
	seriesId: string,
	chapter: number,
	sourceId: string
): Promise<ProgressEvent | undefined> {
	const db = await getDb();
	return db.getFromIndex('events', 'by-unique', eventKey(seriesId, chapter, sourceId));
}

export async function requestPersistence(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
	try {
		if (await navigator.storage.persisted()) return true;
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

export async function wipeLocalDatabase(): Promise<void> {
	const db = await getDb();
	const names: StoreName[] = ['series', 'sources', 'events', 'merges', 'devices', 'outbox', 'meta'];
	const tx = db.transaction(names, 'readwrite');
	await Promise.all(names.map((name) => tx.objectStore(name).clear()));
	await tx.done;
}
