import {
	mergeEvent,
	mergeMergeRecord,
	mergeSeries,
	mergeSource,
	newEvent,
	newSeries,
	newSource,
	nowStamp,
	raiseChapterTotal,
	eventEqual,
	seriesEqual,
	sourceEqual
} from '../shared/merge.ts';
import { parseCapture } from '../shared/parse.ts';
import { chapterText, parseChapterNumber, type ProgressEvent, type Series } from '../shared/model.ts';
import type { IngestResponse, SyncResponse } from '../shared/protocol.ts';
import {
	allocateSeq,
	decodeEvent,
	decodeMerge,
	decodeSeries,
	decodeSource,
	deviceStatement,
	eventStatement,
	findByPath,
	findEventUnique,
	mergeStatement,
	pullChanges,
	readCursor,
	seriesStatement,
	sourceStatement,
	type EventDbRow,
	type MergeDbRow,
	type SeriesDbRow,
	type SourceDbRow
} from './store.ts';
import { validDevice, validEvent, validMerge, validSeries, validSource } from './validate.ts';
import type { D1Database, Env } from './types.ts';

const JSON_HEADERS = {
	'Content-Type': 'application/json; charset=utf-8',
	'Cache-Control': 'no-store',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer'
};

const MAX_INGEST_BODY = 32 * 1024;
const MAX_SYNC_BODY = 2 * 1024 * 1024;
const MAX_ACCOUNT_BODY = 8 * 1024;

/** The signed-in owner of a request. `legacy` is the original SYNC_TOKEN. */
export interface Account {
	id: string;
	username: string;
	legacy: boolean;
}

const LEGACY_USER = 'legacy';

interface RateBucket {
	count: number;
	reset: number;
}

const rateBuckets = new Map<string, RateBucket>();

function takeRate(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();
	if (rateBuckets.size > 5_000) {
		for (const [bucketKey, bucket] of rateBuckets) {
			if (bucket.reset < now) rateBuckets.delete(bucketKey);
		}
	}
	const existing = rateBuckets.get(key);
	if (!existing || existing.reset < now) {
		rateBuckets.set(key, { count: 1, reset: now + windowMs });
		return true;
	}
	if (existing.count >= limit) return false;
	existing.count += 1;
	return true;
}

function corsHeaders(env: Env): Record<string, string> {
	const allowed = env.ALLOWED_ORIGIN?.trim();
	if (allowed && allowed !== '*') {
		return {
			'Access-Control-Allow-Origin': allowed,
			'Access-Control-Allow-Headers': 'Authorization, Content-Type',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Max-Age': '86400',
			Vary: 'Origin'
		};
	}
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': 'Authorization, Content-Type',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Max-Age': '86400'
	};
}

function json(env: Env, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...JSON_HEADERS, ...corsHeaders(env), ...extra }
	});
}

function fail(env: Env, status: number, error: string, detail?: string): Response {
	return json(env, detail ? { ok: false, error, detail } : { ok: false, error }, status);
}

async function readJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
	const declared = Number(request.headers.get('content-length') ?? '0');
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new HttpError(413, 'Request body is too large.');
	}
	const text = await request.text();
	if (text.length > maxBytes) throw new HttpError(413, 'Request body is too large.');
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new HttpError(400, 'Request body must be JSON.');
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new HttpError(400, 'Request body must be a JSON object.');
	}
	return parsed as Record<string, unknown>;
}

class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function clientIp(request: Request): string {
	return (
		request.headers.get('CF-Connecting-IP') ??
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		'local'
	);
}

/** Compares digests, not the raw token, so the comparison time is constant. */
async function tokenMatches(provided: string, expected: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [a, b] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(provided)),
		crypto.subtle.digest('SHA-256', encoder.encode(expected))
	]);
	const left = new Uint8Array(a);
	const right = new Uint8Array(b);
	let diff = left.length ^ right.length;
	for (let index = 0; index < left.length; index += 1) {
		diff |= left[index] ^ right[index];
	}
	return diff === 0;
}

async function digest(value: string): Promise<string> {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomToken(bytes = 32): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	let binary = '';
	for (const byte of buffer) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function accountForToken(env: Env, token: string): Promise<Account | null> {
	if (env.SYNC_TOKEN && (await tokenMatches(token, env.SYNC_TOKEN))) {
		return { id: LEGACY_USER, username: env.OWNER_NAME?.trim() || 'you', legacy: true };
	}
	const row = await env.DB.prepare(
		'SELECT id, username FROM account WHERE token_hash = ?1 LIMIT 1'
	)
		.bind(await digest(token))
		.first<{ id: string; username: string }>();
	if (!row) return null;
	return { id: row.id, username: row.username, legacy: false };
}

async function authorize(
	request: Request,
	env: Env
): Promise<{ account: Account } | { response: Response }> {
	const header = request.headers.get('Authorization') ?? '';
	const match = /^Bearer\s+(\S+)$/i.exec(header);
	const ip = clientIp(request);
	if (!match) {
		takeRate(`auth:${ip}`, 20, 60_000);
		return { response: fail(env, 401, 'Missing bearer token.') };
	}
	if (match[1].length > 512) {
		return { response: fail(env, 401, 'Bad token.') };
	}
	let account: Account | null = null;
	try {
		account = await accountForToken(env, match[1]);
	} catch (error) {
		console.error('account lookup failed', error);
		return { response: fail(env, 500, 'Could not check that token.') };
	}
	if (!account) {
		if (!takeRate(`auth:${ip}`, 20, 60_000)) {
			return { response: fail(env, 429, 'Too many failed attempts. Wait a minute.') };
		}
		return { response: fail(env, 401, 'Bad token.') };
	}
	return { account };
}

function chunk<T>(values: T[], size: number): T[][] {
	if (values.length === 0) return [];
	const output: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		output.push(values.slice(index, index + size));
	}
	return output;
}

function uniqueById<T extends { id: string }>(rows: T[]): Map<string, T> {
	return new Map(rows.map((row) => [row.id, row]));
}

function sameMerge(a: import('../shared/model.ts').MergeRecord, b: import('../shared/model.ts').MergeRecord): boolean {
	return a.undone_at === b.undone_at;
}

async function handleIngest(request: Request, env: Env, account: Account): Promise<Response> {
	const body = await readJson(request, MAX_INGEST_BODY);
	const rawUrl = typeof body.url === 'string' ? body.url.slice(0, 2000) : '';
	if (!rawUrl) {
		// Diagnosis for capture clients that cannot show a response body.
		console.warn(
			'[ingest] no url',
			JSON.stringify({ keys: Object.keys(body), url_type: typeof body.url, url: body.url })
		);
		return fail(env, 400, 'A page URL is required.');
	}

	const chapterInput = body.chapter;
	let explicitChapter: number | null = null;
	if (chapterInput !== undefined && chapterInput !== null && String(chapterInput).trim() !== '') {
		explicitChapter = parseChapterNumber(chapterInput as string | number);
		if (explicitChapter === null) return fail(env, 400, 'Chapter must be a number above 0.');
	}

	const parsed = parseCapture({
		url: rawUrl,
		title: typeof body.title === 'string' ? body.title.slice(0, 500) : '',
		heading: typeof body.heading === 'string' ? body.heading.slice(0, 500) : '',
		breadcrumb: typeof body.breadcrumb === 'string' ? body.breadcrumb.slice(0, 1500) : '',
		label: typeof body.label === 'string' ? body.label.slice(0, 80) : '',
		chapter: explicitChapter,
		volume: typeof body.volume === 'number' || typeof body.volume === 'string' ? body.volume : null,
		cover_url: typeof body.cover_url === 'string' ? body.cover_url.slice(0, 2000) : ''
	});
	if (!parsed) {
		console.warn('[ingest] unparseable url', rawUrl.slice(0, 300));
		return fail(env, 400, 'That URL could not be read.');
	}

	const chapter = explicitChapter ?? parsed.chapter;
	const deviceId =
		typeof body.device_id === 'string' && /^[a-zA-Z0-9:_.-]{4,90}$/.test(body.device_id)
			? body.device_id
			: `capture-${parsed.site}`;
	const method =
		typeof body.method === 'string' &&
		['userscript', 'shortcut', 'manual', 'plus_one', 'import'].includes(body.method)
			? (body.method as ProgressEvent['method'])
			: 'manual';

	const now = new Date();
	const iso = now.toISOString();
	const stamp = nowStamp(deviceId, now);
	const db = env.DB;

	const existingSource = await findByPath(db, account.id, parsed.site, parsed.normalized_path);
	let seriesRow: Series | null = null;
	let sourceRow: import('../shared/model.ts').Source | null = null;
	let createdSeries = false;
	let seriesRestored = false;
	let sourceChanged = false;

	if (existingSource) {
		const existingSeries = await db
			.prepare('SELECT * FROM series WHERE id = ?1 AND user_id = ?2')
			.bind(existingSource.series_id, account.id)
			.first<SeriesDbRow>();
		sourceRow = existingSource;
		if (existingSeries) {
			seriesRow = decodeSeries(existingSeries);
			if (seriesRow.deleted_at) {
				seriesRow = {
					...seriesRow,
					deleted_at: null,
					updated_at: iso,
					device_id: deviceId,
					field_ts: { ...seriesRow.field_ts, deleted_at: stamp }
				};
				seriesRestored = true;
			}
		}

		const restored = Boolean(existingSource.deleted_at);
		const titleChanged = Boolean(parsed.site_title && parsed.site_title !== existingSource.site_title);
		const stale = Date.now() - Date.parse(existingSource.last_seen_at) > 5 * 60_000;
		if (restored || titleChanged || stale) {
			sourceRow = {
				...existingSource,
				deleted_at: null,
				last_seen_at: iso,
				site_title: titleChanged ? parsed.site_title : existingSource.site_title,
				updated_at: iso,
				device_id: deviceId,
				field_ts: {
					...existingSource.field_ts,
					...(titleChanged ? { site_title: stamp } : {}),
					...(restored ? { deleted_at: stamp } : {})
				}
			};
			sourceChanged = true;
		}
	}

	if (!seriesRow) {
		createdSeries = true;
		seriesRow = newSeries(
			deviceId,
			{
				title: parsed.series_title?.trim() || 'Untitled series',
				status: chapter !== null ? 'reading' : 'plan_to_read',
				cover_url: parsed.cover_url,
				needs_review:
					parsed.needs_review ||
					!parsed.series_title ||
					(chapter === null && /chapter/i.test(parsed.url))
			},
			now
		);
	}
	if (!sourceRow) {
		sourceRow = newSource(
			deviceId,
			{
				series_id: seriesRow.id,
				site: parsed.site,
				url: parsed.source_url,
				normalized_path: parsed.normalized_path,
				site_title: parsed.site_title,
				adapter_version: parsed.adapter_version
			},
			now
		);
		sourceChanged = true;
	}
	if (sourceRow.series_id !== seriesRow.id) {
		sourceRow = {
			...sourceRow,
			series_id: seriesRow.id,
			updated_at: iso,
			device_id: deviceId,
			field_ts: { ...sourceRow.field_ts, series_id: stamp }
		};
		sourceChanged = true;
	}

	// The site prints its own total ("Ch. 61 / 72"), so an ongoing series can get
	// one without a catalogue entry. It only ever raises the number.
	const observedTotal = parseChapterNumber(
		typeof body.total_chapters === 'number' || typeof body.total_chapters === 'string'
			? body.total_chapters
			: null
	);
	const raisedTotal = raiseChapterTotal(seriesRow.total_chapters, observedTotal, chapter);
	let totalChanged = false;
	if (raisedTotal !== null) {
		seriesRow = {
			...seriesRow,
			total_chapters: raisedTotal,
			updated_at: iso,
			device_id: deviceId,
			field_ts: { ...seriesRow.field_ts, total_chapters: stamp }
		};
		totalChanged = true;
	}

	let eventRow: ProgressEvent | null = null;
	let duplicate = false;
	if (chapter !== null) {
		const existingEvent = await findEventUnique(db, account.id, seriesRow.id, chapter, sourceRow.id);
		if (existingEvent && !existingEvent.deleted_at) {
			duplicate = true;
			eventRow = existingEvent;
		} else if (existingEvent?.deleted_at) {
			eventRow = {
				...existingEvent,
				deleted_at: null,
				updated_at: iso,
				device_id: deviceId,
				read_at: iso,
				method,
				field_ts: { ...existingEvent.field_ts, deleted_at: stamp }
			};
		} else {
			eventRow = newEvent(
				deviceId,
				{
					series_id: seriesRow.id,
					source_id: sourceRow.id,
					chapter,
					method,
					chapter_label:
						explicitChapter === null || explicitChapter === parsed.chapter
							? parsed.chapter_label
							: `Ch. ${chapterText(chapter)}`,
					volume: parsed.volume,
					chapter_url: parsed.url
				},
				now
			);
		}
	}

	const writes: Array<{
		kind: 'series' | 'source' | 'event';
		row: Series | import('../shared/model.ts').Source | ProgressEvent;
	}> = [];
	if (createdSeries || seriesRestored || totalChanged) {
		writes.push({ kind: 'series', row: seriesRow });
	}
	if (sourceChanged) writes.push({ kind: 'source', row: sourceRow });
	if (eventRow && !duplicate) writes.push({ kind: 'event', row: eventRow });

	if (writes.length > 0) {
		const end = await allocateSeq(db, writes.length);
		let nextSeq = end - writes.length + 1;
		const statements = writes.map((write) => {
			write.row.seq = nextSeq;
			nextSeq += 1;
			if (write.kind === 'series') return seriesStatement(db, account.id, write.row as Series);
			if (write.kind === 'source') {
				return sourceStatement(db, account.id, write.row as import('../shared/model.ts').Source);
			}
			return eventStatement(db, account.id, write.row as ProgressEvent);
		});
		try {
			await db.batch(statements);
		} catch (error) {
			console.error('ingest batch failed', error);
			return fail(env, 409, 'Could not write that capture. Try again.');
		}
	}

	const response: IngestResponse = {
		ok: true,
		series: {
			id: seriesRow.id,
			title: seriesRow.title,
			status: seriesRow.status,
			total_chapters: seriesRow.total_chapters,
			cover_url: seriesRow.cover_url,
			needs_review: seriesRow.needs_review
		},
		event: eventRow
			? {
					id: eventRow.id,
					chapter: eventRow.chapter,
					chapter_label: eventRow.chapter_label,
					read_at: eventRow.read_at
				}
			: null,
		created_series: createdSeries,
		duplicate,
		captured: {
			chapter,
			chapter_label: parsed.chapter_label,
			title: parsed.series_title,
			site: parsed.site,
			confidence: parsed.confidence
		},
		cursor: await readCursor(db)
	};
	return json(env, response);
}

async function handleSync(request: Request, env: Env, account: Account): Promise<Response> {
	const body = await readJson(request, MAX_SYNC_BODY);
	const db = env.DB;
	const sinceNumber = Number(body.since);
	const since = Number.isFinite(sinceNumber) && sinceNumber > 0 ? Math.floor(sinceNumber) : 0;
	const device = body.device ? validDevice(body.device) : null;
	if (body.device && !device) return fail(env, 400, 'Invalid device.');

	const push = (body.push ?? {}) as Record<string, unknown>;
	const rawSeries = Array.isArray(push.series) ? push.series.slice(0, 100) : [];
	const rawSources = Array.isArray(push.sources) ? push.sources.slice(0, 150) : [];
	const rawEvents = Array.isArray(push.events) ? push.events.slice(0, 200) : [];
	const rawMerges = Array.isArray(push.merges) ? push.merges.slice(0, 50) : [];

	const incomingSeries = rawSeries.map(validSeries).filter((row): row is Series => Boolean(row));
	const incomingSources = rawSources.map(validSource).filter((row): row is NonNullable<ReturnType<typeof validSource>> => Boolean(row));
	const incomingEvents = rawEvents.map(validEvent).filter((row): row is ProgressEvent => Boolean(row));
	const incomingMerges = rawMerges.map(validMerge).filter((row): row is NonNullable<ReturnType<typeof validMerge>> => Boolean(row));

	if (
		incomingSeries.length !== rawSeries.length ||
		incomingSources.length !== rawSources.length ||
		incomingEvents.length !== rawEvents.length ||
		incomingMerges.length !== rawMerges.length
	) {
		return fail(env, 400, 'One or more pushed rows were invalid.');
	}

	const seriesIds = new Set<string>();
	for (const row of incomingSeries) seriesIds.add(row.id);
	for (const row of incomingSources) seriesIds.add(row.series_id);
	for (const row of incomingEvents) seriesIds.add(row.series_id);

	const sourceIds = new Set<string>();
	for (const row of incomingSources) sourceIds.add(row.id);
	for (const row of incomingEvents) sourceIds.add(row.source_id);

	const foreign = await foreignIds(db, account.id, 'series', [...seriesIds]);
	if (foreign.length > 0) {
		return fail(env, 409, 'One or more rows belong to another account.');
	}

	const seriesRows: SeriesDbRow[] = [];
	for (const ids of chunk([...seriesIds], 40)) {
		const placeholders = ids.map(() => '?').join(',');
		const result = await db
			.prepare(`SELECT * FROM series WHERE user_id = ? AND id IN (${placeholders})`)
			.bind(account.id, ...ids)
			.all<SeriesDbRow>();
		seriesRows.push(...(result.results ?? []));
	}
	const seriesMap = new Map(seriesRows.map((row) => [row.id, decodeSeries(row)]));

	const sourceForeign = await foreignIds(db, account.id, 'source', [...sourceIds]);
	if (sourceForeign.length > 0) {
		return fail(env, 409, 'One or more rows belong to another account.');
	}
	const sourceRows: SourceDbRow[] = [];
	for (const ids of chunk([...sourceIds], 40)) {
		const placeholders = ids.map(() => '?').join(',');
		const result = await db
			.prepare(`SELECT * FROM source WHERE user_id = ? AND id IN (${placeholders})`)
			.bind(account.id, ...ids)
			.all<SourceDbRow>();
		sourceRows.push(...(result.results ?? []));
	}
	const paths = [...new Set(incomingSources.map((row) => row.normalized_path))];
	for (const pathChunk of chunk(paths, 40)) {
		const placeholders = pathChunk.map(() => '?').join(',');
		const result = await db
			.prepare(
				`SELECT * FROM source WHERE user_id = ? AND normalized_path IN (${placeholders})`
			)
			.bind(account.id, ...pathChunk)
			.all<SourceDbRow>();
		sourceRows.push(...(result.results ?? []));
	}
	const sourceMap = new Map<string, import('../shared/model.ts').Source>();
	const pathMap = new Map<string, import('../shared/model.ts').Source>();
	for (const row of sourceRows) {
		const decoded = decodeSource(row);
		sourceMap.set(decoded.id, decoded);
		pathMap.set(decoded.normalized_path, decoded);
	}

	const eventForeign = await foreignIds(
		db,
		account.id,
		'progress_event',
		[...new Set(incomingEvents.map((row) => row.id))]
	);
	if (eventForeign.length > 0) {
		return fail(env, 409, 'One or more rows belong to another account.');
	}
	const eventRows: EventDbRow[] = [];
	for (const ids of chunk([...new Set(incomingEvents.map((row) => row.id))], 40)) {
		const placeholders = ids.map(() => '?').join(',');
		const result = await db
			.prepare(`SELECT * FROM progress_event WHERE user_id = ? AND id IN (${placeholders})`)
			.bind(account.id, ...ids)
			.all<EventDbRow>();
		eventRows.push(...(result.results ?? []));
	}
	for (const tupleChunk of chunk(incomingEvents, 20)) {
		const placeholders = tupleChunk.map(() => '(?, ?, ?)').join(',');
		const values = tupleChunk.flatMap((row) => [row.series_id, row.chapter, row.source_id]);
		const result = await db
			.prepare(
				`SELECT * FROM progress_event WHERE user_id = ? AND (series_id, chapter, source_id) IN (${placeholders})`
			)
			.bind(account.id, ...values)
			.all<EventDbRow>();
		eventRows.push(...(result.results ?? []));
	}
	const eventMap = new Map<string, ProgressEvent>();
	const eventUnique = new Map<string, ProgressEvent>();
	for (const row of eventRows) {
		const decoded = decodeEvent(row);
		eventMap.set(decoded.id, decoded);
		eventUnique.set(`${decoded.series_id}\u0000${decoded.chapter}\u0000${decoded.source_id}`, decoded);
	}

	const mergeRows: MergeDbRow[] = [];
	for (const ids of chunk(incomingMerges.map((row) => row.id), 40)) {
		const placeholders = ids.map(() => '?').join(',');
		const result = await db
			.prepare(`SELECT * FROM merge_record WHERE user_id = ? AND id IN (${placeholders})`)
			.bind(account.id, ...ids)
			.all<MergeDbRow>();
		mergeRows.push(...(result.results ?? []));
	}
	const mergeMap = new Map(mergeRows.map((row) => [row.id, decodeMerge(row)]));

	const seriesWrites: Series[] = [];
	const sourceWrites: import('../shared/model.ts').Source[] = [];
	const eventWrites: ProgressEvent[] = [];
	const mergeWrites: import('../shared/model.ts').MergeRecord[] = [];
	const conflicts: SyncResponse['conflicts'] = { sources: [], events: [] };
	const accepted = {
		series: [] as string[],
		sources: [] as string[],
		events: [] as string[],
		merges: [] as string[]
	};
	const deferred = { sources: [] as string[], events: [] as string[] };

	for (const incoming of incomingSeries) {
		const base = seriesMap.get(incoming.id);
		const merged = mergeSeries(base, incoming);
		if (!base || !seriesEqual(merged, base)) {
			seriesWrites.push(merged);
			seriesMap.set(merged.id, merged);
		}
		accepted.series.push(incoming.id);
	}

	for (const incoming of incomingSources) {
		const byId = sourceMap.get(incoming.id) ?? null;
		const pathOwner = pathMap.get(incoming.normalized_path) ?? null;
		if (pathOwner && pathOwner.id !== incoming.id) {
			if (!conflicts.sources.some((row) => row.id === pathOwner.id)) {
				conflicts.sources.push(pathOwner);
			}
			continue;
		}
		const base = byId;
		const merged = mergeSource(base ?? undefined, incoming);
		if (!base || !sourceEqual(merged, base)) {
			sourceWrites.push(merged);
		}
		sourceMap.set(merged.id, merged);
		pathMap.set(merged.normalized_path, merged);
		accepted.sources.push(incoming.id);
	}

	const existingSourceIds = new Set(sourceMap.keys());
	const acceptedSourceIds = new Set([...existingSourceIds, ...sourceWrites.map((row) => row.id)]);
	const knownSeriesIds = new Set([...seriesMap.keys(), ...seriesWrites.map((row) => row.id)]);

	for (const incoming of incomingEvents) {
		if (!acceptedSourceIds.has(incoming.source_id) || !knownSeriesIds.has(incoming.series_id)) {
			deferred.events.push(incoming.id);
			continue;
		}
		const base = eventMap.get(incoming.id);
		const merged = mergeEvent(base, incoming);
		const key = `${merged.series_id}\u0000${merged.chapter}\u0000${merged.source_id}`;
		const owner = eventUnique.get(key);
		if (owner && owner.id !== merged.id) {
			if (!conflicts.events.some((row) => row.id === owner.id)) conflicts.events.push(owner);
			continue;
		}
		if (!base || !eventEqual(merged, base)) {
			eventWrites.push(merged);
			eventMap.set(merged.id, merged);
			eventUnique.set(key, merged);
		}
		accepted.events.push(incoming.id);
	}

	for (const incoming of incomingMerges) {
		const base = mergeMap.get(incoming.id);
		const merged = mergeMergeRecord(base, incoming);
		if (!base || !sameMerge(merged, base)) {
			mergeWrites.push(merged);
			mergeMap.set(merged.id, merged);
		}
		accepted.merges.push(incoming.id);
	}

	const writeCount = seriesWrites.length + sourceWrites.length + eventWrites.length + mergeWrites.length;
	const end = await allocateSeq(db, writeCount);
	let nextSeq = end - writeCount + 1;
	const assign = <T extends { seq?: number }>(row: T): T => {
		row.seq = nextSeq;
		nextSeq += 1;
		return row;
	};

	const statements = [
		...seriesWrites.map((row) => seriesStatement(db, account.id, assign(row))),
		...sourceWrites.map((row) => sourceStatement(db, account.id, assign(row))),
		...eventWrites.map((row) => eventStatement(db, account.id, assign(row))),
		...mergeWrites.map((row) => mergeStatement(db, account.id, assign(row))),
		...(device
			? [deviceStatement(db, account.id, { ...device, last_sync_at: new Date().toISOString() })]
			: [])
	];

	if (statements.length > 0) {
		try {
			await db.batch(statements);
		} catch (error) {
			console.error('sync batch failed', error);
			return fail(env, 409, 'A concurrent write conflicted. Retry sync.');
		}
	}

	const pulled = await pullChanges(db, account.id, since, 200);
	const maxSeq = pulled.changes.reduce((max, change) => Math.max(max, change.seq), since);
	const response: SyncResponse = {
		ok: true,
		cursor: maxSeq,
		hasMore: pulled.hasMore,
		changes: pulled.changes,
		conflicts,
		accepted,
		deferred,
		server_time: new Date().toISOString()
	};
	return json(env, response);
}

/** Rows that exist under another account must never be overwritten by id. */
async function foreignIds(
	db: D1Database,
	userId: string,
	table: 'series' | 'source' | 'progress_event' | 'merge_record',
	ids: string[]
): Promise<string[]> {
	const found: string[] = [];
	for (const part of chunk(ids, 40)) {
		const placeholders = part.map(() => '?').join(',');
		const result = await db
			.prepare(`SELECT id FROM ${table} WHERE user_id <> ? AND id IN (${placeholders})`)
			.bind(userId, ...part)
			.all<{ id: string }>();
		for (const row of result.results ?? []) found.push(row.id);
	}
	return found;
}

async function handleExport(env: Env, account: Account): Promise<Response> {
	const db = env.DB;
	const [seriesResult, sourceResult, eventResult, mergeResult] = await Promise.all([
		db.prepare('SELECT * FROM series WHERE user_id = ? ORDER BY seq').bind(account.id).all<SeriesDbRow>(),
		db.prepare('SELECT * FROM source WHERE user_id = ? ORDER BY seq').bind(account.id).all<SourceDbRow>(),
		db.prepare('SELECT * FROM progress_event WHERE user_id = ? ORDER BY seq').bind(account.id).all<EventDbRow>(),
		db.prepare('SELECT * FROM merge_record WHERE user_id = ? ORDER BY seq').bind(account.id).all<MergeDbRow>()
	]);
	return json(env, {
		ok: true,
		exported_at: new Date().toISOString(),
		series: (seriesResult.results ?? []).map(decodeSeries),
		sources: (sourceResult.results ?? []).map(decodeSource),
		events: (eventResult.results ?? []).map(decodeEvent),
		merges: (mergeResult.results ?? []).map(decodeMerge)
	});
}

async function handleSignup(request: Request, env: Env): Promise<Response> {
	const ip = clientIp(request);
	if (!takeRate(`signup:${ip}`, 5, 10 * 60_000)) {
		return fail(env, 429, 'Too many accounts from this address. Try again later.');
	}
	const body = await readJson(request, MAX_ACCOUNT_BODY);
	const username = typeof body.username === 'string' ? body.username.trim().replace(/\s+/g, ' ') : '';
	if (!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{1,31}$/.test(username)) {
		return fail(
			env,
			400,
			'Choose a name of 2–32 letters, numbers, spaces, dots, dashes or underscores.'
		);
	}
	const required = env.SIGNUP_CODE?.trim();
	if (required) {
		const provided = typeof body.invite === 'string' ? body.invite.trim() : '';
		if (!provided || !(await tokenMatches(provided, required))) {
			return fail(env, 403, 'That invite code is not valid.');
		}
	}

	const account: Account = { id: crypto.randomUUID(), username, legacy: false };
	const token = randomToken(32);
	const now = new Date().toISOString();
	try {
		await env.DB.prepare(
			`INSERT INTO account (id, username, username_key, token_hash, created_at, last_seen_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		)
			.bind(account.id, username, username.toLowerCase(), await digest(token), now, now)
			.run();
	} catch (error) {
		console.warn('signup conflict', error);
		return fail(env, 409, 'That name is already taken. Pick another.');
	}
	return json(env, { ok: true, token, account: { id: account.id, username } }, 201);
}

interface ShareLinkRow {
	token: string;
	user_id: string;
	created_at: string;
	revoked_at: string | null;
}

async function handleShareCreate(env: Env, account: Account): Promise<Response> {
	const existing = await env.DB.prepare(
		`SELECT token, user_id, created_at, revoked_at FROM share_link
		 WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1`
	)
		.bind(account.id)
		.first<ShareLinkRow>();
	if (existing) {
		return json(env, { ok: true, token: existing.token, created_at: existing.created_at });
	}
	const token = randomToken(18);
	const now = new Date().toISOString();
	await env.DB.prepare(
		'INSERT INTO share_link (token, user_id, created_at, revoked_at) VALUES (?, ?, ?, NULL)'
	)
		.bind(token, account.id, now)
		.run();
	return json(env, { ok: true, token, created_at: now });
}

async function handleShareRevoke(env: Env, account: Account): Promise<Response> {
	await env.DB.prepare(
		'UPDATE share_link SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'
	)
		.bind(new Date().toISOString(), account.id)
		.run();
	return json(env, { ok: true, revoked: true });
}

/**
 * A read-only view of one shelf. Notes are private and never leave the account;
 * tombstones are omitted so a deleted series cannot be recovered from a link.
 */
async function handleShareView(env: Env, rawToken: string): Promise<Response> {
	const token = rawToken.trim().slice(0, 128);
	if (!token) return fail(env, 404, 'That link is not available.');
	const link = await env.DB.prepare(
		'SELECT user_id, created_at FROM share_link WHERE token = ? AND revoked_at IS NULL LIMIT 1'
	)
		.bind(token)
		.first<{ user_id: string; created_at: string }>();
	if (!link) return fail(env, 404, 'That link is not available.');

	const owner = await env.DB.prepare('SELECT username FROM account WHERE id = ? LIMIT 1')
		.bind(link.user_id)
		.first<{ username: string }>();
	const [seriesResult, sourceResult, eventResult, mergeResult] = await Promise.all([
		env.DB.prepare(
			'SELECT * FROM series WHERE user_id = ? AND deleted_at IS NULL ORDER BY title COLLATE NOCASE'
		)
			.bind(link.user_id)
			.all<SeriesDbRow>(),
		env.DB.prepare('SELECT * FROM source WHERE user_id = ? AND deleted_at IS NULL ORDER BY seq')
			.bind(link.user_id)
			.all<SourceDbRow>(),
		env.DB.prepare('SELECT * FROM progress_event WHERE user_id = ? AND deleted_at IS NULL ORDER BY seq')
			.bind(link.user_id)
			.all<EventDbRow>(),
		env.DB.prepare('SELECT * FROM merge_record WHERE user_id = ? AND undone_at IS NULL ORDER BY seq')
			.bind(link.user_id)
			.all<MergeDbRow>()
	]);

	return json(env, {
		ok: true,
		username:
			owner?.username ?? (link.user_id === LEGACY_USER ? env.OWNER_NAME?.trim() || 'you' : 'someone'),
		shared_at: link.created_at,
		series: (seriesResult.results ?? []).map((row) => ({ ...decodeSeries(row), notes: '' })),
		sources: (sourceResult.results ?? []).map(decodeSource),
		events: (eventResult.results ?? []).map(decodeEvent),
		merges: (mergeResult.results ?? []).map(decodeMerge)
	});
}

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
	if (request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: corsHeaders(env) });
	}
	const ip = clientIp(request);
	if (!takeRate(`all:${ip}`, 240, 60_000)) {
		return fail(env, 429, 'Too many requests. Wait a minute.');
	}

	if (url.pathname === '/api/signup' && request.method === 'POST') {
		return handleSignup(request, env);
	}

	// A share link is a capability: knowing the token is the whole authorization.
	const shareMatch = /^\/api\/share\/([^/]+)$/.exec(url.pathname);
	if (shareMatch && request.method === 'GET') {
		if (!takeRate(`share:${ip}`, 120, 60_000)) {
			return fail(env, 429, 'Too many requests. Wait a minute.');
		}
		return handleShareView(env, decodeURIComponent(shareMatch[1]));
	}

	const auth = await authorize(request, env);
	if ('response' in auth) return auth.response;
	const account = auth.account;

	if (url.pathname === '/api/ping' && request.method === 'GET') {
		return json(env, {
			ok: true,
			time: new Date().toISOString(),
			cursor: await readCursor(env.DB),
			schema: 2,
			account: { id: account.id, username: account.username, legacy: account.legacy }
		});
	}
	if (url.pathname === '/api/ingest' && request.method === 'POST') {
		return handleIngest(request, env, account);
	}
	if (url.pathname === '/api/sync' && request.method === 'POST') {
		return handleSync(request, env, account);
	}
	if (url.pathname === '/api/export' && request.method === 'GET') {
		return handleExport(env, account);
	}
	if (url.pathname === '/api/share') {
		if (request.method === 'POST') return handleShareCreate(env, account);
		if (request.method === 'DELETE') return handleShareRevoke(env, account);
		return fail(env, 405, 'Method not allowed.');
	}
	if (
		['/api/ping', '/api/ingest', '/api/sync', '/api/export', '/api/signup'].includes(url.pathname)
	) {
		return fail(env, 405, 'Method not allowed.');
	}
	return fail(env, 404, 'Unknown endpoint.');
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
			try {
				return await handleApi(request, env, url);
			} catch (error) {
				if (error instanceof HttpError) {
					console.warn('[api]', error.status, error.message);
					return fail(env, error.status, error.message);
				}
				console.error('unhandled api error', error);
				return fail(env, 500, 'Server error. Try again.');
			}
		}
		return env.ASSETS.fetch(request);
	}
};

// Keep the D1 type referenced so the module stays self-documenting.
export type WorkerDatabase = D1Database;
