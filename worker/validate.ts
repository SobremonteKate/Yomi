import {
	SERIES_FIELDS,
	STATUSES,
	isStatus,
	normalizeRating,
	normalizeTags,
	type Device,
	type FieldStamps,
	type MergeRecord,
	type ProgressEvent,
	type Series,
	type Site,
	type Source
} from '../shared/model.ts';

const SITES: Site[] = ['comix', 'mangadot', 'other'];
const METHODS = ['userscript', 'shortcut', 'manual', 'plus_one', 'import'];

function text(value: unknown, max: number, fallback = ''): string {
	if (typeof value !== 'string') return fallback;
	return value.slice(0, max);
}

function iso(value: unknown, fallback = new Date().toISOString()): string {
	if (typeof value !== 'string') return fallback;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function optionalIso(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string') return null;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function finite(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(number) ? number : null;
}

function id(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const clean = value.trim();
	if (clean.length < 4 || clean.length > 90) return null;
	if (!/^[a-zA-Z0-9:_.-]+$/.test(clean)) return null;
	return clean;
}

function stamps(value: unknown): FieldStamps {
	if (!value || typeof value !== 'object') return {};
	const result: FieldStamps = {};
	for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!raw || typeof raw !== 'object') continue;
		const entry = raw as Record<string, unknown>;
		if (typeof entry.t !== 'string') continue;
		const parsed = new Date(entry.t);
		if (!Number.isFinite(parsed.getTime())) continue;
		result[key] = {
			t: parsed.toISOString(),
			d: text(entry.d, 90, 'unknown') || 'unknown'
		};
	}
	return result;
}

export function validSeries(value: unknown): Series | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const seriesId = id(raw.id);
	if (!seriesId) return null;
	const title = text(raw.title, 300).trim() || 'Untitled series';
	const altTitles = Array.isArray(raw.alt_titles)
		? raw.alt_titles.slice(0, 10).map((item) => text(item, 300)).filter(Boolean)
		: [];
	const status = isStatus(raw.status) ? raw.status : 'plan_to_read';
	const total = finite(raw.total_chapters);
	const cover = text(raw.cover_url, 2000);
	const now = new Date().toISOString();
	const field_ts = stamps(raw.field_ts);
	for (const field of SERIES_FIELDS) {
		if (!field_ts[field]) field_ts[field] = { t: iso(raw.updated_at, now), d: text(raw.device_id, 90, 'unknown') };
	}
	if (raw.deleted_at && !field_ts.deleted_at) {
		field_ts.deleted_at = { t: iso(raw.updated_at, now), d: text(raw.device_id, 90, 'unknown') };
	}
	return {
		id: seriesId,
		title,
		alt_titles: altTitles,
		status,
		total_chapters: total !== null && total > 0 ? Math.round(total * 100) / 100 : null,
		cover_url: /^https?:\/\//i.test(cover) ? cover : null,
		description: text(raw.description, 4000),
		rating: normalizeRating(raw.rating),
		tags: normalizeTags(raw.tags),
		notes: text(raw.notes, 20_000),
		queue_rank: finite(raw.queue_rank),
		created_at: iso(raw.created_at, now),
		updated_at: iso(raw.updated_at, now),
		device_id: text(raw.device_id, 90, 'unknown') || 'unknown',
		deleted_at: optionalIso(raw.deleted_at),
		needs_review: Boolean(raw.needs_review),
		field_ts
	};
}

export function validSource(value: unknown): Source | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const sourceId = id(raw.id);
	const seriesId = id(raw.series_id);
	const normalizedPath = text(raw.normalized_path, 2000).trim();
	if (!sourceId || !seriesId || !normalizedPath) return null;
	const now = new Date().toISOString();
	const site = SITES.includes(raw.site as Site) ? (raw.site as Site) : 'other';
	const field_ts = stamps(raw.field_ts);
	if (!field_ts.series_id) field_ts.series_id = { t: iso(raw.updated_at, now), d: text(raw.device_id, 90, 'unknown') };
	if (!field_ts.site_title) field_ts.site_title = { t: iso(raw.updated_at, now), d: text(raw.device_id, 90, 'unknown') };
	if (raw.deleted_at && !field_ts.deleted_at) {
		field_ts.deleted_at = { t: iso(raw.updated_at, now), d: text(raw.device_id, 90, 'unknown') };
	}
	return {
		id: sourceId,
		series_id: seriesId,
		site,
		url: text(raw.url, 2000),
		normalized_path: normalizedPath,
		site_title: text(raw.site_title, 500),
		adapter_version: text(raw.adapter_version, 40, 'generic-1') || 'generic-1',
		first_seen_at: iso(raw.first_seen_at, now),
		last_seen_at: iso(raw.last_seen_at, now),
		updated_at: iso(raw.updated_at, now),
		device_id: text(raw.device_id, 90, 'unknown') || 'unknown',
		deleted_at: optionalIso(raw.deleted_at),
		field_ts
	};
}

export function validEvent(value: unknown): ProgressEvent | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const eventId = id(raw.id);
	const seriesId = id(raw.series_id);
	const sourceId = id(raw.source_id);
	const chapter = finite(raw.chapter);
	if (!eventId || !seriesId || !sourceId || chapter === null || chapter <= 0 || chapter > 1_000_000) {
		return null;
	}
	const now = new Date().toISOString();
	const method = typeof raw.method === 'string' && METHODS.includes(raw.method)
		? (raw.method as ProgressEvent['method'])
		: 'manual';
	const field_ts = stamps(raw.field_ts);
	if (!field_ts.series_id) field_ts.series_id = { t: iso(raw.updated_at, now), d: text(raw.device_id, 90, 'unknown') };
	if (!field_ts.source_id) field_ts.source_id = { t: iso(raw.updated_at, now), d: text(raw.device_id, 90, 'unknown') };
	if (raw.deleted_at && !field_ts.deleted_at) {
		field_ts.deleted_at = { t: iso(raw.updated_at, now), d: text(raw.device_id, 90, 'unknown') };
	}
	const volume = finite(raw.volume);
	return {
		id: eventId,
		series_id: seriesId,
		source_id: sourceId,
		chapter: Math.round(chapter * 100) / 100,
		chapter_label: text(raw.chapter_label, 80) || `Ch. ${chapter}`,
		volume: volume !== null && volume > 0 ? volume : null,
		chapter_url: text(raw.chapter_url, 2000),
		read_at: iso(raw.read_at, now),
		device_id: text(raw.device_id, 90, 'unknown') || 'unknown',
		method,
		created_at: iso(raw.created_at, now),
		updated_at: iso(raw.updated_at, now),
		deleted_at: optionalIso(raw.deleted_at),
		field_ts
	};
}

export function validMerge(value: unknown): MergeRecord | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const mergeId = id(raw.id);
	const from = id(raw.from_series_id);
	const to = id(raw.to_series_id);
	if (!mergeId || !from || !to) return null;
	const now = new Date().toISOString();
	return {
		id: mergeId,
		from_series_id: from,
		to_series_id: to,
		moved_source_ids: Array.isArray(raw.moved_source_ids)
			? raw.moved_source_ids.map((item) => text(item, 90)).filter(Boolean)
			: [],
		created_at: iso(raw.created_at, now),
		device_id: text(raw.device_id, 90, 'unknown') || 'unknown',
		undone_at: optionalIso(raw.undone_at),
		updated_at: iso(raw.updated_at, now)
	};
}

export function validDevice(value: unknown): Device | null {
	if (!value || typeof value !== 'object') return null;
	const raw = value as Record<string, unknown>;
	const deviceId = id(raw.id);
	if (!deviceId) return null;
	return {
		id: deviceId,
		label: text(raw.label, 60) || 'Device',
		platform: text(raw.platform, 40) || 'Web',
		last_sync_at: optionalIso(raw.last_sync_at)
	};
}

export function validStatus(value: unknown): (typeof STATUSES)[number] | null {
	return isStatus(value) ? value : null;
}
