import type {
	Device,
	MergeRecord,
	ProgressEvent,
	Series,
	Source
} from '../shared/model.ts';
import type { ChangeRow, ChangeKind } from '../shared/protocol.ts';
import type { D1Database, D1PreparedStatement } from './types.ts';

export interface SeriesDbRow {
	id: string;
	user_id: string;
	title: string;
	alt_titles: string;
	status: string;
	total_chapters: number | null;
	cover_url: string | null;
	description: string;
	rating: number | null;
	tags: string;
	notes: string;
	queue_rank: number | null;
	created_at: string;
	updated_at: string;
	device_id: string;
	deleted_at: string | null;
	needs_review: number;
	field_ts: string;
	seq: number;
}

export interface SourceDbRow {
	id: string;
	user_id: string;
	series_id: string;
	site: string;
	url: string;
	normalized_path: string;
	site_title: string;
	adapter_version: string;
	first_seen_at: string;
	last_seen_at: string;
	updated_at: string;
	device_id: string;
	deleted_at: string | null;
	field_ts: string;
	seq: number;
}

export interface EventDbRow {
	id: string;
	user_id: string;
	series_id: string;
	source_id: string;
	chapter: number;
	chapter_label: string;
	volume: number | null;
	chapter_url: string;
	read_at: string;
	device_id: string;
	method: string;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	field_ts: string;
	seq: number;
}

export interface MergeDbRow {
	id: string;
	user_id: string;
	from_series_id: string;
	to_series_id: string;
	moved_source_ids: string;
	created_at: string;
	device_id: string;
	undone_at: string | null;
	updated_at: string;
	seq: number;
}

function parseJson<T>(value: string, fallback: T): T {
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function decodeSeries(row: SeriesDbRow): Series {
	return {
		id: row.id,
		title: row.title,
		alt_titles: parseJson<string[]>(row.alt_titles, []),
		status: row.status as Series['status'],
		total_chapters: row.total_chapters,
		cover_url: row.cover_url,
		description: row.description ?? '',
		rating: row.rating ?? null,
		tags: parseJson<string[]>(row.tags, []),
		notes: row.notes,
		queue_rank: row.queue_rank,
		created_at: row.created_at,
		updated_at: row.updated_at,
		device_id: row.device_id,
		deleted_at: row.deleted_at,
		needs_review: Boolean(row.needs_review),
		field_ts: parseJson<Series['field_ts']>(row.field_ts, {}),
		seq: row.seq
	};
}

export function decodeSource(row: SourceDbRow): Source {
	return {
		id: row.id,
		series_id: row.series_id,
		site: row.site as Source['site'],
		url: row.url,
		normalized_path: row.normalized_path,
		site_title: row.site_title,
		adapter_version: row.adapter_version,
		first_seen_at: row.first_seen_at,
		last_seen_at: row.last_seen_at,
		updated_at: row.updated_at,
		device_id: row.device_id,
		deleted_at: row.deleted_at,
		field_ts: parseJson<Source['field_ts']>(row.field_ts, {}),
		seq: row.seq
	};
}

export function decodeEvent(row: EventDbRow): ProgressEvent {
	return {
		id: row.id,
		series_id: row.series_id,
		source_id: row.source_id,
		chapter: row.chapter,
		chapter_label: row.chapter_label,
		volume: row.volume,
		chapter_url: row.chapter_url,
		read_at: row.read_at,
		device_id: row.device_id,
		method: row.method as ProgressEvent['method'],
		created_at: row.created_at,
		updated_at: row.updated_at,
		deleted_at: row.deleted_at,
		field_ts: parseJson<ProgressEvent['field_ts']>(row.field_ts, {}),
		seq: row.seq
	};
}

export function decodeMerge(row: MergeDbRow): MergeRecord {
	return {
		id: row.id,
		from_series_id: row.from_series_id,
		to_series_id: row.to_series_id,
		moved_source_ids: parseJson<string[]>(row.moved_source_ids, []),
		created_at: row.created_at,
		device_id: row.device_id,
		undone_at: row.undone_at,
		updated_at: row.updated_at,
		seq: row.seq
	};
}

export const SERIES_UPSERT = `INSERT INTO series
	(id, user_id, title, alt_titles, status, total_chapters, cover_url, description, rating, tags,
	 notes, queue_rank, created_at, updated_at, device_id, deleted_at, needs_review, field_ts, seq)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		title = excluded.title,
		alt_titles = excluded.alt_titles,
		status = excluded.status,
		total_chapters = excluded.total_chapters,
		cover_url = excluded.cover_url,
		description = excluded.description,
		rating = excluded.rating,
		tags = excluded.tags,
		notes = excluded.notes,
		queue_rank = excluded.queue_rank,
		created_at = excluded.created_at,
		updated_at = excluded.updated_at,
		device_id = excluded.device_id,
		deleted_at = excluded.deleted_at,
		needs_review = excluded.needs_review,
		field_ts = excluded.field_ts,
		seq = excluded.seq`;

export const SOURCE_UPSERT = `INSERT INTO source
	(id, user_id, series_id, site, url, normalized_path, site_title, adapter_version,
	 first_seen_at, last_seen_at, updated_at, device_id, deleted_at, field_ts, seq)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		series_id = excluded.series_id,
		site = excluded.site,
		url = excluded.url,
		normalized_path = excluded.normalized_path,
		site_title = excluded.site_title,
		adapter_version = excluded.adapter_version,
		first_seen_at = excluded.first_seen_at,
		last_seen_at = excluded.last_seen_at,
		updated_at = excluded.updated_at,
		device_id = excluded.device_id,
		deleted_at = excluded.deleted_at,
		field_ts = excluded.field_ts,
		seq = excluded.seq`;

export const EVENT_UPSERT = `INSERT INTO progress_event
	(id, user_id, series_id, source_id, chapter, chapter_label, volume, chapter_url, read_at,
	 device_id, method, created_at, updated_at, deleted_at, field_ts, seq)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		series_id = excluded.series_id,
		source_id = excluded.source_id,
		chapter = excluded.chapter,
		chapter_label = excluded.chapter_label,
		volume = excluded.volume,
		chapter_url = excluded.chapter_url,
		read_at = excluded.read_at,
		device_id = excluded.device_id,
		method = excluded.method,
		created_at = excluded.created_at,
		updated_at = excluded.updated_at,
		deleted_at = excluded.deleted_at,
		field_ts = excluded.field_ts,
		seq = excluded.seq`;

export const MERGE_UPSERT = `INSERT INTO merge_record
	(id, user_id, from_series_id, to_series_id, moved_source_ids, created_at, device_id, undone_at, updated_at, seq)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		from_series_id = excluded.from_series_id,
		to_series_id = excluded.to_series_id,
		moved_source_ids = excluded.moved_source_ids,
		created_at = excluded.created_at,
		device_id = excluded.device_id,
		undone_at = excluded.undone_at,
		updated_at = excluded.updated_at,
		seq = excluded.seq`;

export function seriesStatement(db: D1Database, userId: string, row: Series): D1PreparedStatement {
	return db.prepare(SERIES_UPSERT).bind(
		row.id,
		userId,
		row.title,
		JSON.stringify(row.alt_titles),
		row.status,
		row.total_chapters,
		row.cover_url,
		row.description ?? '',
		row.rating ?? null,
		JSON.stringify(row.tags ?? []),
		row.notes,
		row.queue_rank,
		row.created_at,
		row.updated_at,
		row.device_id,
		row.deleted_at,
		row.needs_review ? 1 : 0,
		JSON.stringify(row.field_ts),
		row.seq ?? 0
	);
}

export function sourceStatement(db: D1Database, userId: string, row: Source): D1PreparedStatement {
	return db.prepare(SOURCE_UPSERT).bind(
		row.id,
		userId,
		row.series_id,
		row.site,
		row.url,
		row.normalized_path,
		row.site_title,
		row.adapter_version,
		row.first_seen_at,
		row.last_seen_at,
		row.updated_at,
		row.device_id,
		row.deleted_at,
		JSON.stringify(row.field_ts),
		row.seq ?? 0
	);
}

export function eventStatement(db: D1Database, userId: string, row: ProgressEvent): D1PreparedStatement {
	return db.prepare(EVENT_UPSERT).bind(
		row.id,
		userId,
		row.series_id,
		row.source_id,
		row.chapter,
		row.chapter_label,
		row.volume,
		row.chapter_url,
		row.read_at,
		row.device_id,
		row.method,
		row.created_at,
		row.updated_at,
		row.deleted_at,
		JSON.stringify(row.field_ts),
		row.seq ?? 0
	);
}

export function mergeStatement(db: D1Database, userId: string, row: MergeRecord): D1PreparedStatement {
	return db.prepare(MERGE_UPSERT).bind(
		row.id,
		userId,
		row.from_series_id,
		row.to_series_id,
		JSON.stringify(row.moved_source_ids),
		row.created_at,
		row.device_id,
		row.undone_at,
		row.updated_at,
		row.seq ?? 0
	);
}

export function deviceStatement(db: D1Database, userId: string, row: Device): D1PreparedStatement {
	return db
		.prepare(
			`INSERT INTO device (id, user_id, label, platform, last_sync_at)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			 label = excluded.label,
			 platform = excluded.platform,
			 last_sync_at = excluded.last_sync_at`
		)
		.bind(row.id, userId, row.label, row.platform, row.last_sync_at);
}

/** Allocate a contiguous block of sequence numbers. Gaps are harmless. */
export async function allocateSeq(db: D1Database, count: number): Promise<number> {
	if (count <= 0) return 0;
	const row = await db
		.prepare('UPDATE counter SET seq = seq + ?1 WHERE id = 1 RETURNING seq')
		.bind(count)
		.first<{ seq: number }>();
	return row?.seq ?? 0;
}

const CHANGE_QUERY = `
SELECT seq, 'series' AS kind, json_object(
	'id', id, 'title', title, 'alt_titles', json(alt_titles), 'status', status,
	'total_chapters', total_chapters, 'cover_url', cover_url, 'description', description,
	'rating', rating, 'tags', json(tags), 'notes', notes,
	'queue_rank', queue_rank, 'created_at', created_at, 'updated_at', updated_at,
	'device_id', device_id, 'deleted_at', deleted_at, 'needs_review', needs_review,
	'field_ts', json(field_ts)
) AS data FROM series WHERE user_id = ?1 AND seq > ?2
UNION ALL
SELECT seq, 'source' AS kind, json_object(
	'id', id, 'series_id', series_id, 'site', site, 'url', url,
	'normalized_path', normalized_path, 'site_title', site_title,
	'adapter_version', adapter_version, 'first_seen_at', first_seen_at,
	'last_seen_at', last_seen_at, 'updated_at', updated_at, 'device_id', device_id,
	'deleted_at', deleted_at, 'field_ts', json(field_ts)
) AS data FROM source WHERE user_id = ?1 AND seq > ?2
UNION ALL
SELECT seq, 'event' AS kind, json_object(
	'id', id, 'series_id', series_id, 'source_id', source_id, 'chapter', chapter,
	'chapter_label', chapter_label, 'volume', volume, 'chapter_url', chapter_url,
	'read_at', read_at, 'device_id', device_id, 'method', method,
	'created_at', created_at, 'updated_at', updated_at, 'deleted_at', deleted_at,
	'field_ts', json(field_ts)
) AS data FROM progress_event WHERE user_id = ?1 AND seq > ?2
UNION ALL
SELECT seq, 'merge' AS kind, json_object(
	'id', id, 'from_series_id', from_series_id, 'to_series_id', to_series_id,
	'moved_source_ids', json(moved_source_ids), 'created_at', created_at,
	'device_id', device_id, 'undone_at', undone_at, 'updated_at', updated_at
) AS data FROM merge_record WHERE user_id = ?1 AND seq > ?2
ORDER BY seq ASC
LIMIT ?3`;

interface ChangeDbRow {
	seq: number;
	kind: ChangeKind;
	data: string;
}

function normalizeChange(kind: ChangeKind, row: Record<string, unknown>, seq: number): ChangeRow | null {
	if (kind === 'series') {
		return {
			seq,
			kind,
			row: { ...(row as unknown as Series), needs_review: Boolean(row.needs_review), seq }
		};
	}
	return { seq, kind, row: { ...(row as unknown as Source | ProgressEvent | MergeRecord), seq } };
}

export async function pullChanges(
	db: D1Database,
	userId: string,
	since: number,
	limit = 200
): Promise<{ changes: ChangeRow[]; hasMore: boolean }> {
	const result = await db
		.prepare(CHANGE_QUERY)
		.bind(userId, since, limit + 1)
		.all<ChangeDbRow>();
	const rows = result.results ?? [];
	const page = rows.slice(0, limit);
	const changes: ChangeRow[] = [];
	for (const row of page) {
		try {
			const parsed = JSON.parse(row.data) as Record<string, unknown>;
			const normalized = normalizeChange(row.kind, parsed, row.seq);
			if (normalized) changes.push(normalized);
		} catch {
			// A malformed row must not take the whole sync down.
		}
	}
	return { changes, hasMore: rows.length > limit };
}

export async function readCursor(db: D1Database): Promise<number> {
	const row = await db
		.prepare('SELECT seq FROM counter WHERE id = 1')
		.first<{ seq: number }>();
	return row?.seq ?? 0;
}

export async function findByPath(
	db: D1Database,
	userId: string,
	site: string,
	path: string
): Promise<Source | null> {
	const row = await db
		.prepare(
			'SELECT * FROM source WHERE user_id = ?1 AND site = ?2 AND normalized_path = ?3 LIMIT 1'
		)
		.bind(userId, site, path)
		.first<SourceDbRow>();
	return row ? decodeSource(row) : null;
}

export async function findEventUnique(
	db: D1Database,
	userId: string,
	seriesId: string,
	chapter: number,
	sourceId: string
): Promise<ProgressEvent | null> {
	const row = await db
		.prepare(
			'SELECT * FROM progress_event WHERE user_id = ?1 AND series_id = ?2 AND chapter = ?3 AND source_id = ?4 LIMIT 1'
		)
		.bind(userId, seriesId, chapter, sourceId)
		.first<EventDbRow>();
	return row ? decodeEvent(row) : null;
}
