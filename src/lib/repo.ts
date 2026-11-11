import type { IDBPDatabase } from 'idb';
import {
	mergeEvent,
	mergeMergeRecord,
	mergeSeries,
	mergeSource,
	newEvent,
	newMergeRecord,
	newSeries,
	newSource,
	nowStamp,
	raiseChapterTotal,
	seriesStats,
	ensureSeriesStamps,
	ensureSourceStamps,
	ensureEventStamps,
	absorbedSeriesIds,
	fieldStamp
} from '../../shared/merge.ts';
import {
	chapterText,
	MAX_DESCRIPTION,
	normalizeRating,
	normalizeTags,
	SERIES_FIELDS,
	type CaptureMethod,
	type Device,
	type MergeRecord,
	type ProgressEvent,
	type Series,
	type SeriesField,
	type Source,
	type Status
} from '../../shared/model.ts';
import type { ParsedCapture } from '../../shared/parse.ts';
import {
	eventKey,
	getDb,
	queueWithin,
	saveMerge,
	saveSeries,
	queueRow,
	outboxKey,
	rowVersion,
	type YomiDB
} from './db.ts';

export interface AddCaptureOptions {
	title?: string;
	status?: Status;
	chapter?: number | null;
	chapterLabel?: string;
	logChapter?: boolean;
	method?: CaptureMethod;
	/**
	 * The total the page itself printed ("61 / 72"). A phone capture carries it
	 * over the link, since the Shortcut can read the page the app cannot.
	 */
	total_chapters?: number | null;
}

export interface AddCaptureResult {
	series: Series;
	source: Source;
	event: ProgressEvent | null;
	created_series: boolean;
	duplicate_event: boolean;
}

function liveSources(db: IDBPDatabase<YomiDB>, seriesId: string): Promise<Source[]> {
	return db.getAllFromIndex('sources', 'by-series', seriesId).then((rows) =>
		rows
			.filter((row) => !row.deleted_at)
			.sort((a, b) => {
				const aManual = a.normalized_path.startsWith('manual:') ? 1 : 0;
				const bManual = b.normalized_path.startsWith('manual:') ? 1 : 0;
				if (aManual !== bManual) return aManual - bManual;
				return Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at);
			})
	);
}

export async function getLiveSources(seriesId: string): Promise<Source[]> {
	const db = await getDb();
	return liveSources(db, seriesId);
}

export async function createManualSource(seriesId: string, device: Device): Promise<Source> {
	const db = await getDb();
	const now = new Date();
	const source = newSource(
		device.id,
		{
			series_id: seriesId,
			site: 'other',
			url: '',
			normalized_path: `manual:${seriesId}`,
			site_title: 'Added by hand',
			adapter_version: 'manual-1'
		},
		now
	);
	await db.put('sources', source);
	await queueRow(db, 'source', source.id, rowVersion(source));
	return source;
}

async function pickSource(
	db: IDBPDatabase<YomiDB>,
	seriesId: string,
	sourceId: string | undefined,
	device: Device,
	eventSourceHint?: string
): Promise<Source> {
	const sources = await liveSources(db, seriesId);
	const wanted = sourceId ?? eventSourceHint;
	if (wanted) {
		const found = sources.find((source) => source.id === wanted);
		if (found) return found;
	}
	if (sources.length > 0) return sources[0];
	return createManualSource(seriesId, device);
}

export async function createManualSeries(
	device: Device,
	title: string,
	options: { status?: Status; notes?: string; total_chapters?: number | null } = {}
): Promise<{ series: Series; source: Source }> {
	const db = await getDb();
	const series = newSeries(device.id, {
		title: title.trim() || 'Untitled series',
		status: options.status ?? 'plan_to_read',
		notes: options.notes ?? '',
		total_chapters: options.total_chapters ?? null
	});
	const source = newSource(device.id, {
		series_id: series.id,
		site: 'other',
		url: '',
		normalized_path: `manual:${series.id}`,
		site_title: 'Added by hand',
		adapter_version: 'manual-1'
	});
	const tx = db.transaction(['series', 'sources', 'outbox'], 'readwrite');
	await tx.objectStore('series').put(series);
	await tx.objectStore('sources').put(source);
	queueWithin(tx, 'series', series.id, rowVersion(series));
	queueWithin(tx, 'source', source.id, rowVersion(source));
	await tx.done;
	return { series, source };
}

export async function addCapture(
	parsed: ParsedCapture,
	device: Device,
	options: AddCaptureOptions = {}
): Promise<AddCaptureResult> {
	const db = await getDb();
	const now = new Date();
	const iso = now.toISOString();
	const chapter = options.chapter !== undefined ? options.chapter : parsed.chapter;
	const logChapter = (options.logChapter ?? true) && chapter !== null && chapter !== undefined && chapter > 0;
	const existingSource = await db.getFromIndex('sources', 'by-path', parsed.normalized_path);

	let series: Series;
	let source: Source;
	let createdSeries = false;

	if (existingSource) {
		const existingSeries = await db.get('series', existingSource.series_id);
		if (!existingSeries) throw new Error('That URL points to a series that no longer exists.');
		const restoreStamp = nowStamp(device.id, now);
		// Re-adding a URL that was deleted revives the row instead of creating a
		// duplicate that the server would reject on the unique path.
		series = existingSeries.deleted_at
			? {
					...existingSeries,
					deleted_at: null,
					updated_at: iso,
					device_id: device.id,
					field_ts: { ...existingSeries.field_ts, deleted_at: restoreStamp }
				}
			: existingSeries;
		source = {
			...ensureSourceStamps(existingSource),
			last_seen_at: iso,
			site_title: parsed.site_title || existingSource.site_title,
			updated_at: iso,
			device_id: device.id,
			deleted_at: null
		};
		source.field_ts = {
			...source.field_ts,
			site_title: nowStamp(device.id, now),
			...(existingSource.deleted_at ? { deleted_at: restoreStamp } : {})
		};
	} else {
		createdSeries = true;
		series = newSeries(
			device.id,
			{
				title: (options.title ?? parsed.series_title ?? '').trim() || 'Untitled series',
				status: options.status ?? (logChapter ? 'reading' : 'plan_to_read'),
				cover_url: parsed.cover_url,
				needs_review: parsed.needs_review || !parsed.series_title
			},
			now
		);			source = newSource(
				device.id,
				{
					series_id: series.id,
					site: parsed.site,
					url: parsed.source_url,
					normalized_path: parsed.normalized_path,
					site_title: parsed.site_title,
					adapter_version: parsed.adapter_version
				},
				now
			);
	}

	let event: ProgressEvent | null = null;
	let duplicate = false;
	if (logChapter) {
		event = ((await db.getFromIndex(
			'events',
			'by-unique',
			eventKey(series.id, chapter as number, source.id)
		)) ?? null) as ProgressEvent | null;
		if (event) {
			duplicate = true;
			if (event.deleted_at) {
				event = {
					...event,
					deleted_at: null,
					updated_at: iso,
					device_id: device.id,
					read_at: iso,
					method: options.method ?? 'manual',
					field_ts: { ...event.field_ts, deleted_at: nowStamp(device.id, now) }
				};
				duplicate = false;
			}
		} else {
			event = newEvent(
				device.id,
				{
					series_id: series.id,
					source_id: source.id,
					chapter: chapter as number,
					method: options.method ?? 'manual',
					chapter_label: options.chapterLabel || parsed.chapter_label,
					volume: parsed.volume,
					chapter_url: parsed.chapter === chapter ? parsed.url : ''
				},
				now
			);
		}
	}

	// The page printed its own total, so a capture can fill a count that no
	// catalogue publishes while a series is still releasing. It only ever
	// raises the number, exactly like the Worker's ingest path.
	const raisedTotal = raiseChapterTotal(
		series.total_chapters,
		options.total_chapters ?? null,
		chapter ?? null
	);
	if (raisedTotal !== null) {
		series = {
			...series,
			total_chapters: raisedTotal,
			updated_at: iso,
			device_id: device.id,
			field_ts: { ...series.field_ts, total_chapters: nowStamp(device.id, now) }
		};
	}

	const tx = db.transaction(['series', 'sources', 'events', 'outbox'], 'readwrite');
	await tx.objectStore('series').put(series);
	await tx.objectStore('sources').put(source);
	queueWithin(tx, 'series', series.id, rowVersion(series));
	queueWithin(tx, 'source', source.id, rowVersion(source));
	if (event && !duplicate) {
		await tx.objectStore('events').put(event);
		queueWithin(tx, 'event', event.id, rowVersion(event));
	}
	await tx.done;

	return {
		series,
		source,
		event: event ?? null,
		created_series: createdSeries,
		duplicate_event: duplicate
	};
}

export async function attachSourceToSeries(
	parsed: ParsedCapture,
	seriesId: string,
	device: Device
): Promise<{ source: Source; already: boolean }> {
	const db = await getDb();
	const existing = await db.getFromIndex('sources', 'by-path', parsed.normalized_path);
	if (existing) {
		if (existing.series_id !== seriesId) {
			const other = await db.get('series', existing.series_id);
			throw new Error(
				`That URL is already attached to ${other?.title ?? 'another series'}. Merge the two series instead.`
			);
		}
		return { source: existing, already: true };
	}
	const source = newSource(device.id, {
		series_id: seriesId,
		site: parsed.site,
		url: parsed.source_url,
		normalized_path: parsed.normalized_path,
		site_title: parsed.site_title,
		adapter_version: parsed.adapter_version
	});
	await db.put('sources', source);
	await queueRow(db, 'source', source.id, rowVersion(source));
	return { source, already: false };
}

export async function updateSeries(
	seriesId: string,
	patch: Partial<Record<SeriesField, unknown>>,
	device: Device
): Promise<Series> {
	const db = await getDb();
	const series = await db.get('series', seriesId);
	if (!series) throw new Error('Series not found.');
	if (series.deleted_at) throw new Error('That series was deleted.');
	const now = new Date();
	const iso = now.toISOString();
	const next: Series = { ...series, alt_titles: [...series.alt_titles], field_ts: { ...series.field_ts } };
	let changed = false;

	for (const field of SERIES_FIELDS) {
		if (!(field in patch)) continue;
		let value = patch[field];
		if (field === 'title') {
			value = String(value ?? '').trim().slice(0, 300) || 'Untitled series';
			if (value !== series.title) {
				const previous = series.title?.trim();
				if (previous && previous !== value && !next.alt_titles.includes(previous)) {
					next.alt_titles = [...next.alt_titles, previous].slice(-10);
					next.field_ts.alt_titles = nowStamp(device.id, now);
				}
			}
		} else if (field === 'description') {
			// Plain text only: a pasted synopsis may carry HTML, and this field is
			// rendered as text, not markup.
			value = String(value ?? '')
				.replace(/\r\n?/g, '\n')
				.replace(/<[^>]*>/g, '')
				.trim()
				.slice(0, MAX_DESCRIPTION);
		} else if (field === 'notes') {
			value = String(value ?? '').slice(0, 20_000);
		} else if (field === 'total_chapters') {
			const numeric = Number(value);
			value = Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100) / 100 : null;
		} else if (field === 'cover_url') {
			const text = String(value ?? '').trim();
			value = /^https?:\/\//i.test(text) ? text.slice(0, 2000) : null;
		} else if (field === 'status') {
			value = String(value);
		} else if (field === 'needs_review') {
			value = Boolean(value);
		} else if (field === 'rating') {
			value = normalizeRating(value);
		} else if (field === 'tags') {
			value = normalizeTags(value);
		} else if (field === 'alt_titles') {
			value = Array.isArray(value) ? value.slice(0, 10).map((item) => String(item).slice(0, 300)) : [];
		}

		const existing = (next as unknown as Record<string, unknown>)[field];
		if (JSON.stringify(existing) === JSON.stringify(value)) continue;
		(next as unknown as Record<string, unknown>)[field] = value;
		next.field_ts[field] = nowStamp(device.id, now);
		changed = true;
	}

	if (!changed) return series;
	next.updated_at = iso;
	next.device_id = device.id;
	await saveSeries(next);
	return next;
}

export interface LogChapterInput {
	seriesId: string;
	chapter: number;
	label?: string;
	volume?: number | null;
	chapterUrl?: string;
	sourceId?: string;
	method?: CaptureMethod;
	readAt?: string;
}

export async function logChapter(
	input: LogChapterInput,
	device: Device
): Promise<{ event: ProgressEvent; duplicate: boolean }> {
	const chapter = Math.round(Number(input.chapter) * 100) / 100;
	if (!Number.isFinite(chapter) || chapter <= 0) throw new Error('Enter a chapter above 0.');

	const db = await getDb();
	const series = await db.get('series', input.seriesId);
	if (!series || series.deleted_at) throw new Error('Series not found.');

	const events = await db.getAllFromIndex('events', 'by-series', input.seriesId);
	const latest = events
		.filter((event) => !event.deleted_at)
		.sort((a, b) => Date.parse(b.read_at) - Date.parse(a.read_at))[0];

	let sourceHint: string | undefined;
	if (latest?.source_id) {
		const latestSource = await db.get('sources', latest.source_id);
		if (latestSource && !latestSource.deleted_at) sourceHint = latestSource.id;
	}
	const source = await pickSource(db, input.seriesId, input.sourceId, device, sourceHint);

	const existing = await db.getFromIndex(
		'events',
		'by-unique',
		eventKey(input.seriesId, chapter, source.id)
	);
	const now = new Date();
	if (existing && !existing.deleted_at) return { event: existing, duplicate: true };
	if (existing && existing.deleted_at) {
		const restored: ProgressEvent = {
			...existing,
			deleted_at: null,
			updated_at: now.toISOString(),
			device_id: device.id,
			read_at: input.readAt ?? now.toISOString(),
			method: input.method ?? 'manual',
			chapter_label: input.label?.trim().slice(0, 80) || existing.chapter_label,
			field_ts: { ...existing.field_ts, deleted_at: nowStamp(device.id, now) }
		};
		await db.put('events', restored);
		await queueRow(db, 'event', restored.id, rowVersion(restored));
		return { event: restored, duplicate: false };
	}

	const event = newEvent(
		device.id,
		{
			series_id: input.seriesId,
			source_id: source.id,
			chapter,
			method: input.method ?? 'manual',
			chapter_label: input.label?.trim().slice(0, 80) || `Ch. ${chapterText(chapter)}`,
			volume: input.volume ?? null,
			chapter_url: input.chapterUrl ?? '',
			read_at: input.readAt ?? now.toISOString()
		},
		now
	);
	await db.put('events', event);
	await queueRow(db, 'event', event.id, rowVersion(event));
	return { event, duplicate: false };
}

export async function plusOne(
	seriesId: string,
	device: Device
): Promise<{ event: ProgressEvent; duplicate: boolean; chapter: number }> {
	const db = await getDb();
	const series = await db.get('series', seriesId);
	if (!series) throw new Error('Series not found.');
	const events = await db.getAllFromIndex('events', 'by-series', seriesId);
	const stats = seriesStats(series, events);
	const chapter = Math.round(((stats.furthest ?? 0) + 1) * 100) / 100;
	const latest = events
		.filter((event) => !event.deleted_at)
		.sort((a, b) => Date.parse(b.read_at) - Date.parse(a.read_at))[0];
	const result = await logChapter(
		{
			seriesId,
			chapter,
			method: 'plus_one',
			sourceId: latest?.source_id,
			chapterUrl: latest?.chapter_url ?? undefined
		},
		device
	);
	return { ...result, chapter };
}

export async function deleteEvent(eventId: string, device: Device): Promise<void> {
	const db = await getDb();
	const event = await db.get('events', eventId);
	if (!event || event.deleted_at) return;
	const now = new Date();
	const next: ProgressEvent = {
		...event,
		deleted_at: now.toISOString(),
		updated_at: now.toISOString(),
		device_id: device.id,
		field_ts: { ...event.field_ts, deleted_at: nowStamp(device.id, now) }
	};
	await db.put('events', next);
	await queueRow(db, 'event', event.id, rowVersion(next));
}

/**
 * Lifts a chapter's tombstone with a newer stamp, the same explicit restore the
 * series uses: the log entry and its read time come back as they were.
 */
export async function restoreEvent(eventId: string, device: Device): Promise<void> {
	const db = await getDb();
	const event = await db.get('events', eventId);
	if (!event || !event.deleted_at) return;
	const now = new Date();
	const next: ProgressEvent = {
		...event,
		deleted_at: null,
		updated_at: now.toISOString(),
		device_id: device.id,
		field_ts: { ...event.field_ts, deleted_at: nowStamp(device.id, now) }
	};
	await db.put('events', next);
	await queueRow(db, 'event', next.id, rowVersion(next));
}

export async function deleteSeries(seriesId: string, device: Device): Promise<void> {
	const db = await getDb();
	const series = await db.get('series', seriesId);
	if (!series || series.deleted_at) return;
	const now = new Date();
	const iso = now.toISOString();
	const stamp = nowStamp(device.id, now);
	const [sources, events] = await Promise.all([
		db.getAllFromIndex('sources', 'by-series', seriesId),
		db.getAllFromIndex('events', 'by-series', seriesId)
	]);
	const tx = db.transaction(['series', 'sources', 'events', 'outbox'], 'readwrite');
	const deletedSeries: Series = {
		...series,
		deleted_at: iso,
		updated_at: iso,
		device_id: device.id,
		field_ts: { ...series.field_ts, deleted_at: stamp }
	};
	await tx.objectStore('series').put(deletedSeries);
	queueWithin(tx, 'series', seriesId, rowVersion(deletedSeries));
	for (const source of sources) {
		if (source.deleted_at) continue;
		const next: Source = {
			...source,
			deleted_at: iso,
			updated_at: iso,
			device_id: device.id,
			field_ts: { ...source.field_ts, deleted_at: stamp }
		};
		await tx.objectStore('sources').put(next);
		queueWithin(tx, 'source', next.id, rowVersion(next));
	}
	for (const event of events) {
		if (event.deleted_at) continue;
		const next: ProgressEvent = {
			...event,
			deleted_at: iso,
			updated_at: iso,
			device_id: device.id,
			field_ts: { ...event.field_ts, deleted_at: stamp }
		};
		await tx.objectStore('events').put(next);
		queueWithin(tx, 'event', next.id, rowVersion(next));
	}
	await tx.done;
}

/**
 * Lifts a delete: the series and the rows tombstoned with it get a null
 * deleted_at carrying a newer stamp, which is how a restore wins over the
 * tombstone during merge. Rows deleted at some other moment stay deleted.
 */
export async function restoreSeries(seriesId: string, device: Device): Promise<void> {
	const db = await getDb();
	const series = await db.get('series', seriesId);
	if (!series || !series.deleted_at) return;
	const deletedAt = series.deleted_at;
	const now = new Date();
	const iso = now.toISOString();
	const stamp = nowStamp(device.id, now);
	const [sources, events] = await Promise.all([
		db.getAllFromIndex('sources', 'by-series', seriesId),
		db.getAllFromIndex('events', 'by-series', seriesId)
	]);
	const tx = db.transaction(['series', 'sources', 'events', 'outbox'], 'readwrite');
	const restoredSeries: Series = {
		...series,
		deleted_at: null,
		updated_at: iso,
		device_id: device.id,
		field_ts: { ...series.field_ts, deleted_at: stamp }
	};
	await tx.objectStore('series').put(restoredSeries);
	queueWithin(tx, 'series', seriesId, rowVersion(restoredSeries));
	for (const source of sources) {
		if (source.deleted_at !== deletedAt) continue;
		const next: Source = {
			...source,
			deleted_at: null,
			updated_at: iso,
			device_id: device.id,
			field_ts: { ...source.field_ts, deleted_at: stamp }
		};
		await tx.objectStore('sources').put(next);
		queueWithin(tx, 'source', next.id, rowVersion(next));
	}
	for (const event of events) {
		if (event.deleted_at !== deletedAt) continue;
		const next: ProgressEvent = {
			...event,
			deleted_at: null,
			updated_at: iso,
			device_id: device.id,
			field_ts: { ...event.field_ts, deleted_at: stamp }
		};
		await tx.objectStore('events').put(next);
		queueWithin(tx, 'event', next.id, rowVersion(next));
	}
	await tx.done;
}

export async function mergeInto(fromId: string, toId: string, device: Device): Promise<MergeRecord> {
	if (fromId === toId) throw new Error('Pick a different series.');
	const db = await getDb();
	const [from, to, merges] = await Promise.all([
		db.get('series', fromId),
		db.get('series', toId),
		db.getAll('merges')
	]);
	if (!from || !to || from.deleted_at || to.deleted_at) throw new Error('Series not found.');
	const absorbed = absorbedSeriesIds(merges);
	if (absorbed.has(fromId)) throw new Error('That series is already merged into another.');
	if (absorbed.has(toId)) throw new Error('Merge target is itself merged into another series.');

	const [sources, events, targetSources] = await Promise.all([
		db.getAllFromIndex('sources', 'by-series', fromId),
		db.getAllFromIndex('events', 'by-series', fromId),
		db.getAllFromIndex('sources', 'by-series', toId)
	]);
	const liveFromSources = sources.filter((source) => !source.deleted_at);
	const targetPaths = new Set(
		targetSources.filter((source) => !source.deleted_at).map((source) => source.normalized_path)
	);
	for (const source of liveFromSources) {
		if (targetPaths.has(source.normalized_path)) {
			throw new Error('Both series already share a URL. Nothing to merge.');
		}
	}

	const now = new Date();
	const iso = now.toISOString();
	const stamp = nowStamp(device.id, now);
	const merge = newMergeRecord(
		device.id,
		fromId,
		toId,
		liveFromSources.map((source) => source.id),
		now
	);

	const tx = db.transaction(['sources', 'events', 'merges', 'outbox'], 'readwrite');
	for (const source of liveFromSources) {
		const next: Source = {
			...source,
			series_id: toId,
			updated_at: iso,
			device_id: device.id,
			field_ts: { ...source.field_ts, series_id: stamp }
		};
		await tx.objectStore('sources').put(next);
		queueWithin(tx, 'source', next.id, rowVersion(next));
	}
	for (const event of events) {
		if (event.deleted_at) continue;
		if (!liveFromSources.some((source) => source.id === event.source_id)) continue;
		const next: ProgressEvent = {
			...event,
			series_id: toId,
			updated_at: iso,
			device_id: device.id,
			field_ts: { ...event.field_ts, series_id: stamp }
		};
		await tx.objectStore('events').put(next);
		queueWithin(tx, 'event', next.id, rowVersion(next));
	}
	await tx.objectStore('merges').put(merge);
	queueWithin(tx, 'merge', merge.id, rowVersion(merge));
	await tx.done;
	return merge;
}

export async function undoMerge(mergeId: string, device: Device): Promise<void> {
	const db = await getDb();
	const merge = await db.get('merges', mergeId);
	if (!merge) throw new Error('Merge record not found.');
	if (merge.undone_at) throw new Error('That merge was already undone.');
	const from = await db.get('series', merge.from_series_id);
	if (!from || from.deleted_at) throw new Error('The absorbed series no longer exists.');

	const [sources, events] = await Promise.all([
		db.getAllFromIndex('sources', 'by-series', merge.to_series_id),
		db.getAllFromIndex('events', 'by-series', merge.to_series_id)
	]);
	const movedIds = new Set(merge.moved_source_ids);
	const now = new Date();
	const iso = now.toISOString();
	const stamp = nowStamp(device.id, now);

	const tx = db.transaction(['sources', 'events', 'merges', 'outbox'], 'readwrite');
	for (const source of sources) {
		if (!movedIds.has(source.id)) continue;
		const next: Source = {
			...source,
			series_id: merge.from_series_id,
			updated_at: iso,
			device_id: device.id,
			field_ts: { ...source.field_ts, series_id: stamp }
		};
		await tx.objectStore('sources').put(next);
		queueWithin(tx, 'source', next.id, rowVersion(next));
	}
	for (const event of events) {
		if (!movedIds.has(event.source_id)) continue;
		const next: ProgressEvent = {
			...event,
			series_id: merge.from_series_id,
			updated_at: iso,
			device_id: device.id,
			field_ts: { ...event.field_ts, series_id: stamp }
		};
		await tx.objectStore('events').put(next);
		queueWithin(tx, 'event', next.id, rowVersion(next));
	}
	const nextMerge: MergeRecord = {
		...merge,
		undone_at: iso,
		updated_at: iso,
		device_id: device.id
	};
	await tx.objectStore('merges').put(nextMerge);
	queueWithin(tx, 'merge', merge.id, rowVersion(nextMerge));
	await tx.done;
}

export async function setDeviceLabel(label: string, device: Device): Promise<Device> {
	const next: Device = { ...device, label: label.trim().slice(0, 60) || 'Device' };
	const db = await getDb();
	await db.put('devices', next);
	await db.put('meta', { key: 'device', value: next });
	return next;
}

// ---------------------------------------------------------------------------
// Export and import
// ---------------------------------------------------------------------------

export interface ExportFile {
	format: 'yomi.export';
	version: 1;
	exported_at: string;
	last_seq: number;
	device: Device;
	series: Series[];
	sources: Source[];
	events: ProgressEvent[];
	merges: MergeRecord[];
}

export async function exportData(): Promise<ExportFile> {
	const db = await getDb();
	const [series, sources, events, merges, device, lastSeq] = await Promise.all([
		db.getAll('series'),
		db.getAll('sources'),
		db.getAll('events'),
		db.getAll('merges'),
		db.get('meta', 'device'),
		db.get('meta', 'last_seq')
	]);
	const now = new Date().toISOString();
	await db.put('meta', { key: 'last_export_at', value: now });
	return {
		format: 'yomi.export',
		version: 1,
		exported_at: now,
		last_seq: Number((lastSeq?.value as number) ?? 0),
		device: (device?.value as Device) ?? ({
			id: 'unknown',
			label: 'Device',
			platform: 'Web',
			last_sync_at: null
		} satisfies Device),
		series,
		sources,
		events,
		merges
	};
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export async function importData(payload: unknown): Promise<{
	series: number;
	sources: number;
	events: number;
	merges: number;
}> {
	const root = asRecord(payload);
	if (!root || root.format !== 'yomi.export') {
		throw new Error('That file is not a Yomi export.');
	}
	const lists = {
		series: Array.isArray(root.series) ? root.series : [],
		sources: Array.isArray(root.sources) ? root.sources : [],
		events: Array.isArray(root.events) ? root.events : [],
		merges: Array.isArray(root.merges) ? root.merges : []
	};
	const db = await getDb();
	const now = Date.now();
	const counts = { series: 0, sources: 0, events: 0, merges: 0 };

	const seriesTx = db.transaction(['series', 'outbox'], 'readwrite');
	for (const raw of lists.series) {
		const row = asRecord(raw);
		if (!row || typeof row.id !== 'string' || typeof row.title !== 'string') continue;
		const incoming = ensureSeriesStamps(row as unknown as Series);
		const local = await seriesTx.objectStore('series').get(incoming.id);
		const merged = mergeSeries(local, incoming);
		await seriesTx.objectStore('series').put(merged);
		queueWithin(seriesTx, 'series', merged.id, rowVersion(merged), now);
		counts.series += 1;
	}
	await seriesTx.done;

	const sourceTx = db.transaction(['sources', 'outbox'], 'readwrite');
	for (const raw of lists.sources) {
		const row = asRecord(raw);
		if (!row || typeof row.id !== 'string' || typeof row.normalized_path !== 'string') continue;
		const incoming = ensureSourceStamps(row as unknown as Source);
		const samePath = await sourceTx
			.objectStore('sources')
			.index('by-path')
			.get(incoming.normalized_path);
		if (samePath && samePath.id !== incoming.id) continue;
		const local = await sourceTx.objectStore('sources').get(incoming.id);
		const merged = mergeSource(local, incoming);
		await sourceTx.objectStore('sources').put(merged);
		queueWithin(sourceTx, 'source', merged.id, rowVersion(merged), now);
		counts.sources += 1;
	}
	await sourceTx.done;

	const eventTx = db.transaction(['events', 'outbox'], 'readwrite');
	for (const raw of lists.events) {
		const row = asRecord(raw);
		if (!row || typeof row.id !== 'string' || typeof row.chapter !== 'number') continue;
		const incoming = ensureEventStamps(row as unknown as ProgressEvent);
		const duplicate = await eventTx
			.objectStore('events')
			.index('by-unique')
			.get(eventKey(incoming.series_id, incoming.chapter, incoming.source_id));
		if (duplicate && duplicate.id !== incoming.id) continue;
		const local = await eventTx.objectStore('events').get(incoming.id);
		const merged = mergeEvent(local, incoming);
		await eventTx.objectStore('events').put(merged);
		queueWithin(eventTx, 'event', merged.id, rowVersion(merged), now);
		counts.events += 1;
	}
	await eventTx.done;

	const mergeTx = db.transaction(['merges', 'outbox'], 'readwrite');
	for (const raw of lists.merges) {
		const row = asRecord(raw);
		if (!row || typeof row.id !== 'string' || typeof row.from_series_id !== 'string') continue;
		const local = await mergeTx.objectStore('merges').get(String(row.id));
		const merged = mergeMergeRecord(local, row as unknown as MergeRecord);
		await mergeTx.objectStore('merges').put(merged);
		queueWithin(mergeTx, 'merge', merged.id, rowVersion(merged), now);
		counts.merges += 1;
	}
	await mergeTx.done;

	return counts;
}

// ---------------------------------------------------------------------------
// Reading-list import (AniList / MyAnimeList)
// ---------------------------------------------------------------------------

const TITLE_NOISE = /[^a-z0-9]+/g;

function titleKey(value: string): string {
	return value.toLowerCase().replace(TITLE_NOISE, '');
}

export interface ImportListResult {
	created: number;
	matched: number;
	skipped: number;
	chapters: number;
}

/**
 * Merges a parsed AniList/MAL list into the shelf. A title already on the shelf
 * is enriched rather than duplicated: only fields you left blank are filled, and
 * tags are unioned. Imported rows carry the progress as a single chapter event,
 * since the export records where you are now, not every chapter you read.
 */
export async function importReadingList(
	entries: import('./import-list.ts').ListEntry[],
	device: Device
): Promise<ImportListResult> {
	const db = await getDb();
	const now = new Date();
	const iso = now.toISOString();
	const existing = await db.getAll('series');
	const byTitle = new Map<string, Series>();
	for (const row of existing) {
		byTitle.set(titleKey(row.title), row);
		for (const alt of row.alt_titles ?? []) byTitle.set(titleKey(alt), row);
	}

	const result: ImportListResult = { created: 0, matched: 0, skipped: 0, chapters: 0 };
	const writes: Series[] = [];
	const sources: Source[] = [];
	const events: ProgressEvent[] = [];

	for (const entry of entries) {
		const key = titleKey(entry.title);
		if (!key) {
			result.skipped += 1;
			continue;
		}
		const match = byTitle.get(key);
		if (match) {
			if (match.deleted_at) {
				result.skipped += 1;
				continue;
			}
			const patch: Partial<Series> = {};
			if (!match.cover_url && entry.coverUrl) patch.cover_url = entry.coverUrl;
			if (match.total_chapters == null && entry.totalChapters) patch.total_chapters = entry.totalChapters;
			if (match.rating == null && entry.rating) patch.rating = entry.rating;
			if (!match.notes && entry.notes) patch.notes = entry.notes;
			const tags = normalizeTags([...(match.tags ?? []), ...entry.tags]);
			if (tags.length !== (match.tags ?? []).length) patch.tags = tags;
			const alt = [...(match.alt_titles ?? [])];
			for (const title of entry.altTitles) {
				if (title && !alt.includes(title) && alt.length < 10) alt.push(title);
			}
			if (alt.length !== (match.alt_titles ?? []).length) patch.alt_titles = alt;
			if (Object.keys(patch).length > 0) {
				const next: Series = {
					...match,
					...patch,
					updated_at: iso,
					device_id: device.id,
					field_ts: { ...match.field_ts }
				};
				for (const field of Object.keys(patch) as SeriesField[]) {
					next.field_ts[field] = nowStamp(device.id, now);
				}
				writes.push(next);
				byTitle.set(key, next);
			}
			result.matched += 1;
			continue;
		}

		const series = newSeries(
			device.id,
			{
				title: entry.title,
				alt_titles: entry.altTitles,
				status: entry.status,
				total_chapters: entry.totalChapters,
				cover_url: entry.coverUrl,
				rating: entry.rating,
				tags: entry.tags,
				notes: entry.notes
			},
			now
		);
		const source = newSource(
			device.id,
			{
				series_id: series.id,
				site: 'other',
				url: '',
				normalized_path: `manual:${series.id}`,
				site_title: 'Imported list',
				adapter_version: 'manual-1'
			},
			now
		);
		writes.push(series);
		sources.push(source);
		byTitle.set(key, series);
		if (entry.chaptersRead && entry.chaptersRead > 0) {
			events.push(
				newEvent(
					device.id,
					{
						series_id: series.id,
						source_id: source.id,
						chapter: entry.chaptersRead,
						method: 'import',
						chapter_label: `Ch. ${chapterText(entry.chaptersRead)}`
					},
					now
				)
			);
			result.chapters += 1;
		}
		result.created += 1;
	}

	if (writes.length > 0) {
		const tx = db.transaction(['series', 'sources', 'events', 'outbox'], 'readwrite');
		for (const row of writes) {
			await tx.objectStore('series').put(row);
			queueWithin(tx, 'series', row.id, rowVersion(row));
		}
		for (const row of sources) {
			await tx.objectStore('sources').put(row);
			queueWithin(tx, 'source', row.id, rowVersion(row));
		}
		for (const row of events) {
			await tx.objectStore('events').put(row);
			queueWithin(tx, 'event', row.id, rowVersion(row));
		}
		await tx.done;
	}

	return result;
}

export function mergeRecordFromRows(merges: MergeRecord[], seriesId: string): MergeRecord | undefined {
	return merges.find(
		(merge) => merge.to_series_id === seriesId && !merge.undone_at
	);
}
