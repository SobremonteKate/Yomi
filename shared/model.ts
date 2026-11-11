export type Status = 'reading' | 'plan_to_read' | 'on_hold' | 'completed' | 'dropped';

export const STATUSES: Status[] = ['reading', 'plan_to_read', 'on_hold', 'completed', 'dropped'];

export const STATUS_LABEL: Record<Status, string> = {
	reading: 'Reading',
	plan_to_read: 'Plan to read',
	on_hold: 'On hold',
	completed: 'Completed',
	dropped: 'Dropped'
};

export const STATUS_SHORT: Record<Status, string> = {
	reading: 'Reading',
	plan_to_read: 'Plan',
	on_hold: 'Hold',
	completed: 'Done',
	dropped: 'Dropped'
};

export type Site = 'comix' | 'mangadot' | 'other';
export type CaptureMethod = 'userscript' | 'shortcut' | 'manual' | 'plus_one' | 'import';

export const SITE_LABEL: Record<Site, string> = {
	comix: 'Comix',
	mangadot: 'MangaDot',
	other: 'Web'
};

/** A timestamp plus the device that wrote it. Compared as a pair, never alone. */
export interface FieldStamp {
	t: string;
	d: string;
}

export type FieldStamps = Record<string, FieldStamp>;

export interface Series {
	id: string;
	title: string;
	alt_titles: string[];
	status: Status;
	total_chapters: number | null;
	cover_url: string | null;
	/** Plain-text synopsis, filled from the catalogue or pasted by hand. */
	description: string;
	/** Your score from 1 to 10, or null when you have not rated it. */
	rating: number | null;
	/** Free-form labels used for filtering, stored lower-case and de-duplicated. */
	tags: string[];
	notes: string;
	queue_rank: number | null;
	created_at: string;
	updated_at: string;
	device_id: string;
	deleted_at: string | null;
	/** True when capture could not confidently read a title or chapter. */
	needs_review: boolean;
	field_ts: FieldStamps;
	seq?: number;
}

export interface Source {
	id: string;
	series_id: string;
	site: Site;
	url: string;
	normalized_path: string;
	site_title: string;
	adapter_version: string;
	first_seen_at: string;
	last_seen_at: string;
	updated_at: string;
	device_id: string;
	deleted_at: string | null;
	field_ts: FieldStamps;
	seq?: number;
}

export interface ProgressEvent {
	id: string;
	series_id: string;
	source_id: string;
	chapter: number;
	chapter_label: string;
	volume: number | null;
	chapter_url: string;
	read_at: string;
	device_id: string;
	method: CaptureMethod;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	field_ts: FieldStamps;
	seq?: number;
}

/** Audit record for a reversible merge. The absorbed row stays in the database. */
export interface MergeRecord {
	id: string;
	from_series_id: string;
	to_series_id: string;
	moved_source_ids: string[];
	created_at: string;
	device_id: string;
	undone_at: string | null;
	updated_at: string;
	seq?: number;
}

export interface Device {
	id: string;
	label: string;
	platform: string;
	last_sync_at: string | null;
}

export const SERIES_FIELDS = [
	'title',
	'alt_titles',
	'status',
	'total_chapters',
	'cover_url',
	'description',
	'rating',
	'tags',
	'notes',
	'queue_rank',
	'needs_review'
] as const;

export type SeriesField = (typeof SERIES_FIELDS)[number];

export function emptyStamps(): FieldStamps {
	return {};
}

/** Longest synopsis worth storing: a metadata blurb, not a chapter dump. */
export const MAX_DESCRIPTION = 4000;

/** Tags are shelf labels, not a taxonomy: a dozen short ones is plenty. */
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 32;

/** A score of 1–10, rounded to a half point; anything else is "unrated". */
export function normalizeRating(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const numeric = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return null;
	return Math.min(10, Math.round(numeric * 2) / 2);
}

/**
 * Splits a comma- or hash-separated tag string, lower-cases it and removes
 * duplicates, so "Isekai, isekai #Slow Burn" is two tags, not three.
 */
export function normalizeTags(value: unknown): string[] {
	const raw = Array.isArray(value)
		? value
		: typeof value === 'string'
			? value.split(/[,#]/)
			: [];
	const tags: string[] = [];
	const seen = new Set<string>();
	for (const item of raw) {
		const tag = String(item ?? '')
			.replace(/^#/, '')
			.replace(/\s+/g, ' ')
			.trim()
			.toLowerCase()
			.slice(0, MAX_TAG_LENGTH);
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		tags.push(tag);
		if (tags.length >= MAX_TAGS) break;
	}
	return tags;
}

/** Serialise a chapter without floating-point noise. */
export function chapterText(value: number): string {
	if (!Number.isFinite(value)) return '';
	const rounded = Math.round(value * 100) / 100;
	return String(rounded);
}

/**
 * Accepts a raw chapter expression from an input or a page label.
 * "Vol. 3 Ch. 12" -> 12, "42.5" -> 42.5, "Chapter 149" -> 149.
 */
export function parseChapterNumber(raw: string | number | null | undefined): number | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
	const text = String(raw).trim();
	if (!text) return null;
	const prefixed = text.match(
		/(?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*#?\s*(\d+(?:[.,]\d+)?)/i
	);
	const source = prefixed ? prefixed[1] : text.replace(/[^\d.,-]/g, '');
	const normalized = source.replace(',', '.');
	const value = Number.parseFloat(normalized);
	if (!Number.isFinite(value) || value <= 0) return null;
	return Math.round(value * 100) / 100;
}

export function isStatus(value: unknown): value is Status {
	return typeof value === 'string' && (STATUSES as string[]).includes(value);
}

export function platformLabel(): string {
	const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
	if (/iphone|ipad|ipod/i.test(ua)) return 'iPhone';
	if (/android/i.test(ua)) return 'Android';
	if (/macintosh|mac os x/i.test(ua)) return 'Mac';
	if (/windows/i.test(ua)) return 'Windows';
	if (/linux/i.test(ua)) return 'Linux';
	return 'Web';
}

export function defaultDeviceLabel(): string {
	const platform = platformLabel();
	if (platform === 'iPhone' || platform === 'Android') return 'Phone';
	if (platform === 'Windows' || platform === 'Mac' || platform === 'Linux') return 'Desktop';
	return 'This device';
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return 'never';
	const then = Date.parse(iso);
	if (!Number.isFinite(then)) return 'unknown';
	const diff = now - then;
	if (diff < -60_000) return 'just now';
	const abs = Math.abs(diff);
	if (abs < 45_000) return 'just now';
	if (abs < 90_000) return '1 min ago';
	if (abs < 3_600_000) return `${Math.round(abs / 60_000)} min ago`;
	if (abs < 7_200_000) return '1 hr ago';
	if (abs < 86_400_000) return `${Math.round(abs / 3_600_000)} hr ago`;
	if (abs < 172_800_000) return 'yesterday';
	if (abs < 2_592_000_000) return `${Math.round(abs / 86_400_000)} days ago`;
	const date = new Date(then);
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function dayLabel(iso: string, now = Date.now()): string {
	const date = new Date(iso);
	if (!Number.isFinite(date.getTime())) return 'Unknown date';
	const today = new Date(now);
	if (date.toDateString() === today.toDateString()) return 'Today';
	const yesterday = new Date(now - 86_400_000);
	if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
	return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function clockLabel(iso: string): string {
	const date = new Date(iso);
	if (!Number.isFinite(date.getTime())) return '';
	return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
