import {
	chapterText,
	normalizeRating,
	normalizeTags,
	SERIES_FIELDS,
	type Device,
	type FieldStamp,
	type FieldStamps,
	type MergeRecord,
	type ProgressEvent,
	type Series,
	type SeriesField,
	type Source
} from './model.ts';

/**
 * Field-level last-write-wins.
 *
 * A value only wins when its (timestamp, device) pair is later. Two writes
 * within one second are treated as simultaneous and broken by device id, so
 * every replica reaches the same result without trusting a single clock.
 * Chapter progress never goes through this path: it is append-only and ordered
 * numerically.
 */
const TIE_WINDOW_MS = 1_000;

function stampTime(stamp: FieldStamp | undefined): number {
	if (!stamp?.t) return 0;
	const parsed = Date.parse(stamp.t);
	return Number.isFinite(parsed) ? parsed : 0;
}

/** Positive when `a` should replace `b`. */
export function compareStamps(a: FieldStamp | undefined, b: FieldStamp | undefined): number {
	if (!a) return -1;
	if (!b) return 1;
	const aTime = stampTime(a);
	const bTime = stampTime(b);
	if (aTime === bTime || Math.abs(aTime - bTime) <= TIE_WINDOW_MS) {
		if (a.d === b.d) return a.t === b.t ? 0 : a.t > b.t ? 1 : -1;
		return a.d > b.d ? 1 : -1;
	}
	return aTime > bTime ? 1 : -1;
}

export function nowStamp(deviceId: string, now = new Date()): FieldStamp {
	return { t: now.toISOString(), d: deviceId };
}

export function sameStamps(a: FieldStamps | undefined, b: FieldStamps | undefined): boolean {
	const left = a ?? {};
	const right = b ?? {};
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		const one = left[key];
		const two = right[key];
		if (!one || !two || one.t !== two.t || one.d !== two.d) return false;
	}
	return true;
}

export function seriesEqual(a: Series, b: Series): boolean {
	return (
		a.title === b.title &&
		JSON.stringify(a.alt_titles) === JSON.stringify(b.alt_titles) &&
		a.status === b.status &&
		a.total_chapters === b.total_chapters &&
		a.cover_url === b.cover_url &&
		a.description === b.description &&
		a.rating === b.rating &&
		JSON.stringify(a.tags) === JSON.stringify(b.tags) &&
		a.notes === b.notes &&
		a.queue_rank === b.queue_rank &&
		a.deleted_at === b.deleted_at &&
		a.needs_review === b.needs_review &&
		sameStamps(a.field_ts, b.field_ts)
	);
}

export function sourceEqual(a: Source, b: Source): boolean {
	return (
		a.series_id === b.series_id &&
		a.site_title === b.site_title &&
		a.last_seen_at === b.last_seen_at &&
		a.deleted_at === b.deleted_at &&
		sameStamps(a.field_ts, b.field_ts)
	);
}

export function eventEqual(a: ProgressEvent, b: ProgressEvent): boolean {
	return (
		a.series_id === b.series_id &&
		a.source_id === b.source_id &&
		a.deleted_at === b.deleted_at &&
		sameStamps(a.field_ts, b.field_ts)
	);
}

export function stampWith(deviceId: string, iso: string): FieldStamp {
	return { t: iso, d: deviceId };
}

export function fieldStamp(row: { field_ts?: FieldStamps; updated_at: string; device_id: string }, field: string): FieldStamp {
	return row.field_ts?.[field] ?? { t: row.updated_at, d: row.device_id };
}

function deletionStamp(row: {
	field_ts?: FieldStamps;
	updated_at: string;
	device_id: string;
	deleted_at: string | null;
}): FieldStamp | undefined {
	if (!row.deleted_at) return undefined;
	return row.field_ts?.deleted_at ?? { t: row.updated_at, d: row.device_id };
}

function latestStamp(stamps: FieldStamps): FieldStamp | undefined {
	let best: FieldStamp | undefined;
	for (const stamp of Object.values(stamps)) {
		if (compareStamps(stamp, best) > 0) best = stamp;
	}
	return best;
}

function maxIso(a: string | null | undefined, b: string | null | undefined): string | null {
	if (!a) return b ?? null;
	if (!b) return a;
	return Date.parse(a) >= Date.parse(b) ? a : b;
}

function minIso(a: string | null | undefined, b: string | null | undefined): string {
	if (!a) return b ?? new Date(0).toISOString();
	if (!b) return a;
	return Date.parse(a) <= Date.parse(b) ? a : b;
}

function withMissingStamps(stamps: FieldStamps | undefined, fields: readonly string[], fallback: FieldStamp): FieldStamps {
	const next: FieldStamps = { ...(stamps ?? {}) };
	for (const field of fields) {
		if (!next[field]) next[field] = fallback;
	}
	return next;
}

/** Gives every mutable field a stamp so incoming rows from older clients merge safely. */
export function ensureSeriesStamps(row: Series): Series {
	const fallback = { t: row.updated_at || row.created_at, d: row.device_id };
	const stamps = withMissingStamps(row.field_ts, SERIES_FIELDS, fallback);
	if (row.deleted_at && !stamps.deleted_at) stamps.deleted_at = fallback;
	// Rows written before the field existed (an old export, an upgraded client)
	// arrive without a description; an empty string keeps the type honest.
	const description = typeof row.description === 'string' ? row.description : '';
	return {
		...row,
		description,
		rating: normalizeRating(row.rating),
		tags: normalizeTags(row.tags),
		field_ts: stamps
	};
}

export function mergeSeries(base: Series | undefined, incomingInput: Series): Series {
	const incoming = ensureSeriesStamps(incomingInput);
	if (!base) {
		return {
			...incoming,
			alt_titles: Array.isArray(incoming.alt_titles) ? [...incoming.alt_titles] : [],
			field_ts: { ...incoming.field_ts }
		};
	}

	const baseRow = ensureSeriesStamps(base);
	const baseStamps = baseRow.field_ts;
	const incomingStamps = incoming.field_ts;
	const baseDeletion = baseRow.deleted_at ? baseStamps.deleted_at : undefined;
	const incomingDeletion = incomingStamps.deleted_at;

	// A restore is an explicit newer deleted_at stamp with a null value.
	if (baseDeletion) {
		const restore =
			incoming.deleted_at === null &&
			Boolean(incomingDeletion) &&
			compareStamps(incomingDeletion, baseDeletion) > 0;
		if (!restore) {
			if (incoming.deleted_at && incomingDeletion && compareStamps(incomingDeletion, baseDeletion) > 0) {
				return {
					...baseRow,
					deleted_at: incoming.deleted_at,
					updated_at: incomingDeletion.t,
					device_id: incomingDeletion.d,
					field_ts: { ...baseStamps, deleted_at: incomingDeletion }
				};
			}
			// Tombstones always win over older field edits.
			return baseRow;
		}
	}

	const next: Series = {
		...baseRow,
		alt_titles: [...baseRow.alt_titles],
		field_ts: { ...baseStamps },
		deleted_at: baseRow.deleted_at && !incomingDeletion ? baseRow.deleted_at : null
	};
	let changed = Boolean(baseRow.deleted_at && incomingDeletion && incoming.deleted_at === null);

	for (const field of SERIES_FIELDS) {
		const incomingStamp = incomingStamps[field as SeriesField];
		if (!incomingStamp) continue;
		const baseStamp = baseStamps[field as SeriesField];
		if (compareStamps(incomingStamp, baseStamp) > 0) {
			(next as unknown as Record<string, unknown>)[field] = incoming[field as SeriesField];
			next.field_ts[field] = incomingStamp;
			changed = true;
		}
	}

	if (incoming.deleted_at && incomingDeletion) {
		if (!baseDeletion || compareStamps(incomingDeletion, baseDeletion) > 0) {
			next.deleted_at = incoming.deleted_at;
			next.field_ts.deleted_at = incomingDeletion;
			changed = true;
		}
	} else if (incomingDeletion && baseRow.deleted_at && incoming.deleted_at === null) {
		next.field_ts.deleted_at = incomingDeletion;
	}

	if (!changed) {
		return { ...baseRow, seq: Math.max(baseRow.seq ?? 0, incoming.seq ?? 0) || baseRow.seq };
	}

	const latest = latestStamp(next.field_ts);
	next.created_at = minIso(baseRow.created_at, incoming.created_at);
	next.updated_at = latest?.t ?? maxIso(baseRow.updated_at, incoming.updated_at) ?? baseRow.updated_at;
	next.device_id = latest?.d ?? incoming.device_id;
	next.seq = Math.max(baseRow.seq ?? 0, incoming.seq ?? 0) || undefined;
	if (next.deleted_at) next.updated_at = next.field_ts.deleted_at?.t ?? next.updated_at;
	return next;
}

const SOURCE_FIELDS = ['series_id', 'site_title', 'deleted_at'] as const;

export function ensureSourceStamps(row: Source): Source {
	const fallback = { t: row.updated_at, d: row.device_id };
	const stamps = withMissingStamps(row.field_ts, SOURCE_FIELDS.filter((field) => field !== 'deleted_at'), fallback);
	if (row.deleted_at && !stamps.deleted_at) stamps.deleted_at = fallback;
	return { ...row, field_ts: stamps };
}

export function mergeSource(base: Source | undefined, incomingInput: Source): Source {
	const incoming = ensureSourceStamps(incomingInput);
	if (!base) return { ...incoming, field_ts: { ...incoming.field_ts } };
	const baseRow = ensureSourceStamps(base);
	const baseDeletion = baseRow.deleted_at ? baseRow.field_ts.deleted_at : undefined;
	const incomingDeletion = incoming.field_ts.deleted_at;

	if (baseDeletion) {
		const restore =
			incoming.deleted_at === null &&
			Boolean(incomingDeletion) &&
			compareStamps(incomingDeletion, baseDeletion) > 0;
		if (!restore) {
			if (incoming.deleted_at && incomingDeletion && compareStamps(incomingDeletion, baseDeletion) > 0) {
				return {
					...baseRow,
					deleted_at: incoming.deleted_at,
					updated_at: incomingDeletion.t,
					device_id: incomingDeletion.d,
					field_ts: { ...baseRow.field_ts, deleted_at: incomingDeletion }
				};
			}
			return baseRow;
		}
	}

	const next: Source = {
		...baseRow,
		field_ts: { ...baseRow.field_ts },
		deleted_at: baseRow.deleted_at && !(incomingDeletion && incoming.deleted_at === null) ? baseRow.deleted_at : null
	};
	let changed = Boolean(baseRow.deleted_at && incomingDeletion && incoming.deleted_at === null);

	if (compareStamps(incoming.field_ts.series_id, baseRow.field_ts.series_id) > 0) {
		if (next.series_id !== incoming.series_id) {
			next.series_id = incoming.series_id;
			next.field_ts.series_id = incoming.field_ts.series_id;
			changed = true;
		}
	}
	if (compareStamps(incoming.field_ts.site_title, baseRow.field_ts.site_title) > 0) {
		if (next.site_title !== incoming.site_title) {
			next.site_title = incoming.site_title;
			next.field_ts.site_title = incoming.field_ts.site_title;
			changed = true;
		}
	}
	if (incoming.deleted_at && incomingDeletion) {
		if (!baseDeletion || compareStamps(incomingDeletion, baseDeletion) > 0) {
			next.deleted_at = incoming.deleted_at;
			next.field_ts.deleted_at = incomingDeletion;
			changed = true;
		}
	} else if (incomingDeletion && baseRow.deleted_at) {
		next.field_ts.deleted_at = incomingDeletion;
	}

	next.first_seen_at = minIso(baseRow.first_seen_at, incoming.first_seen_at);
	next.last_seen_at = maxIso(baseRow.last_seen_at, incoming.last_seen_at) ?? baseRow.last_seen_at;
	next.seq = Math.max(baseRow.seq ?? 0, incoming.seq ?? 0) || undefined;
	if (!changed) return next;

	const latest = latestStamp(next.field_ts);
	next.updated_at = latest?.t ?? maxIso(baseRow.updated_at, incoming.updated_at) ?? baseRow.updated_at;
	next.device_id = latest?.d ?? incoming.device_id;
	if (next.deleted_at) next.updated_at = next.field_ts.deleted_at?.t ?? next.updated_at;
	return next;
}

export function ensureEventStamps(row: ProgressEvent): ProgressEvent {
	const fallback = { t: row.updated_at || row.created_at, d: row.device_id };
	const stamps = withMissingStamps(row.field_ts, ['series_id', 'source_id'], fallback);
	if (row.deleted_at && !stamps.deleted_at) stamps.deleted_at = fallback;
	return { ...row, field_ts: stamps };
}

/**
 * Events are facts, not fields. Two devices logging the same chapter produce
 * one fact (the unique key is series + chapter + source). A merge repoint can
 * move the fact between series; deletion is a tombstone.
 */
export function mergeEvent(base: ProgressEvent | undefined, incomingInput: ProgressEvent): ProgressEvent {
	const incoming = ensureEventStamps(incomingInput);
	if (!base) return { ...incoming, field_ts: { ...incoming.field_ts } };
	const baseRow = ensureEventStamps(base);
	const baseDeletion = baseRow.deleted_at ? baseRow.field_ts.deleted_at : undefined;
	const incomingDeletion = incoming.field_ts.deleted_at;

	if (baseDeletion) {
		const restore =
			incoming.deleted_at === null &&
			Boolean(incomingDeletion) &&
			compareStamps(incomingDeletion, baseDeletion) > 0;
		if (!restore) {
			if (incoming.deleted_at && incomingDeletion && compareStamps(incomingDeletion, baseDeletion) > 0) {
				return {
					...baseRow,
					deleted_at: incoming.deleted_at,
					updated_at: incomingDeletion.t,
					device_id: incomingDeletion.d,
					field_ts: { ...baseRow.field_ts, deleted_at: incomingDeletion }
				};
			}
			return baseRow;
		}
	}

	const next: ProgressEvent = { ...baseRow, field_ts: { ...baseRow.field_ts } };
	next.deleted_at = baseRow.deleted_at && !(incomingDeletion && incoming.deleted_at === null) ? baseRow.deleted_at : null;
	if (compareStamps(incoming.field_ts.series_id, baseRow.field_ts.series_id) > 0) {
		next.series_id = incoming.series_id;
		next.field_ts.series_id = incoming.field_ts.series_id;
	}
	if (compareStamps(incoming.field_ts.source_id, baseRow.field_ts.source_id) > 0) {
		next.source_id = incoming.source_id;
		next.field_ts.source_id = incoming.field_ts.source_id;
	}
	if (incoming.deleted_at && incomingDeletion) {
		if (!baseDeletion || compareStamps(incomingDeletion, baseDeletion) > 0) {
			next.deleted_at = incoming.deleted_at;
			next.field_ts.deleted_at = incomingDeletion;
		}
	} else if (incomingDeletion && baseRow.deleted_at) {
		next.field_ts.deleted_at = incomingDeletion;
	}
	next.created_at = minIso(baseRow.created_at, incoming.created_at);
	next.updated_at = latestStamp(next.field_ts)?.t ?? baseRow.updated_at;
	next.seq = Math.max(baseRow.seq ?? 0, incoming.seq ?? 0) || undefined;
	return next;
}

export function mergeMergeRecord(base: MergeRecord | undefined, incoming: MergeRecord): MergeRecord {
	if (!base) return { ...incoming };
	const next: MergeRecord = { ...base };
	const incomingStamp = { t: incoming.updated_at, d: incoming.device_id };
	const baseStamp = { t: base.updated_at, d: base.device_id };
	if (compareStamps(incomingStamp, baseStamp) > 0) {
		next.undone_at = incoming.undone_at;
		next.updated_at = incoming.updated_at;
		next.device_id = incoming.device_id;
	}
	next.seq = Math.max(base.seq ?? 0, incoming.seq ?? 0) || undefined;
	return next;
}

export function newSeries(
	deviceId: string,
	fields: Partial<Pick<Series, 'title' | 'status' | 'total_chapters' | 'cover_url' | 'description' | 'rating' | 'tags' | 'notes' | 'queue_rank' | 'needs_review' | 'alt_titles'>> = {},
	now = new Date(),
	id: string = crypto.randomUUID()
): Series {
	const t = now.toISOString();
	const stamps: FieldStamps = {};
	for (const field of SERIES_FIELDS) stamps[field] = { t, d: deviceId };
	return {
		id,
		title: fields.title?.trim() || 'Untitled series',
		alt_titles: fields.alt_titles ?? [],
		status: fields.status ?? 'plan_to_read',
		total_chapters: fields.total_chapters ?? null,
		cover_url: fields.cover_url ?? null,
		description: fields.description ?? '',
		rating: normalizeRating(fields.rating),
		tags: normalizeTags(fields.tags),
		notes: fields.notes ?? '',
		queue_rank: fields.queue_rank ?? null,
		created_at: t,
		updated_at: t,
		device_id: deviceId,
		deleted_at: null,
		needs_review: fields.needs_review ?? false,
		field_ts: stamps
	};
}

export function newSource(
	deviceId: string,
	fields: Pick<Source, 'series_id' | 'site' | 'url' | 'normalized_path'> &
		Partial<Pick<Source, 'site_title' | 'adapter_version'>>,
	now = new Date(),
	id: string = crypto.randomUUID()
): Source {
	const t = now.toISOString();
	const row: Source = {
		id,
		series_id: fields.series_id,
		site: fields.site,
		url: fields.url,
		normalized_path: fields.normalized_path,
		site_title: fields.site_title ?? '',
		adapter_version: fields.adapter_version ?? 'manual-1',
		first_seen_at: t,
		last_seen_at: t,
		updated_at: t,
		device_id: deviceId,
		deleted_at: null,
		field_ts: {
			series_id: { t, d: deviceId },
			site_title: { t, d: deviceId }
		}
	};
	return row;
}

export function newEvent(
	deviceId: string,
	fields: Pick<ProgressEvent, 'series_id' | 'source_id' | 'chapter' | 'method'> &
		Partial<Pick<ProgressEvent, 'chapter_label' | 'volume' | 'chapter_url' | 'read_at'>>,
	now = new Date(),
	id: string = crypto.randomUUID()
): ProgressEvent {
	const t = fields.read_at ?? now.toISOString();
	return {
		id,
		series_id: fields.series_id,
		source_id: fields.source_id,
		chapter: fields.chapter,
		chapter_label: fields.chapter_label ?? `Ch. ${chapterText(fields.chapter)}`,
		volume: fields.volume ?? null,
		chapter_url: fields.chapter_url ?? '',
		read_at: t,
		device_id: deviceId,
		method: fields.method,
		created_at: now.toISOString(),
		updated_at: now.toISOString(),
		deleted_at: null,
		field_ts: {
			series_id: { t: now.toISOString(), d: deviceId },
			source_id: { t: now.toISOString(), d: deviceId }
		}
	};
}

export function newMergeRecord(
	deviceId: string,
	fromSeriesId: string,
	toSeriesId: string,
	movedSourceIds: string[],
	now = new Date(),
	id: string = crypto.randomUUID()
): MergeRecord {
	const t = now.toISOString();
	return {
		id,
		from_series_id: fromSeriesId,
		to_series_id: toSeriesId,
		moved_source_ids: movedSourceIds,
		created_at: t,
		device_id: deviceId,
		undone_at: null,
		updated_at: t
	};
}

export function newDevice(id: string, label: string, platform: string, now = new Date()): Device {
	return { id, label, platform, last_sync_at: now.toISOString() };
}

export interface SeriesStats {
	furthest: number | null;
	lastReadAt: string | null;
	chapterCount: number;
	nextChapter: number;
	percent: number | null;
}

export function seriesStats(series: Series, seriesEvents: ProgressEvent[]): SeriesStats {
	const live = seriesEvents.filter((event) => !event.deleted_at);
	let furthest: number | null = null;
	let lastReadAt: string | null = null;
	for (const event of live) {
		if (furthest === null || event.chapter > furthest) furthest = event.chapter;
		if (!lastReadAt || Date.parse(event.read_at) > Date.parse(lastReadAt)) lastReadAt = event.read_at;
	}
	const total = series.total_chapters;
	const percent =
		total && total > 0 && furthest !== null ? Math.min(100, (furthest / total) * 100) : null;
	return {
		furthest,
		lastReadAt,
		chapterCount: live.length,
		nextChapter: (furthest ?? 0) + 1,
		percent
	};
}

/**
 * A reading site prints its own "61 / 72", which is often the only place an
 * ongoing series' total exists: every catalogue leaves the count empty while a
 * series is still releasing. A site total may fill a blank one and may push the
 * number forward as chapters appear, but it never lowers a total you typed.
 * Returns the new value, or null when nothing should change.
 */
export function raiseChapterTotal(
	existing: number | null,
	observed: number | null,
	chapter: number | null = null
): number | null {
	if (observed === null || !Number.isFinite(observed) || observed <= 0) return null;
	// A "total" below the chapter being read is page furniture, not a count.
	if (chapter !== null && Number.isFinite(chapter) && observed < chapter) return null;
	if (existing !== null && Number.isFinite(existing) && existing >= observed) return null;
	return Math.round(observed * 100) / 100;
}

/** A merge hides the absorbed row without deleting its history. */
export function absorbedSeriesIds(merges: MergeRecord[]): Set<string> {
	const ids = new Set<string>();
	for (const merge of merges) {
		if (!merge.undone_at) ids.add(merge.from_series_id);
	}
	return ids;
}
