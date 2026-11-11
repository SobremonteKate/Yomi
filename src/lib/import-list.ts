import type { Status } from '../../shared/model.ts';
import { normalizeRating, normalizeTags } from '../../shared/model.ts';

export interface ListEntry {
	title: string;
	altTitles: string[];
	totalChapters: number | null;
	chaptersRead: number | null;
	status: Status;
	rating: number | null;
	notes: string;
	coverUrl: string | null;
	tags: string[];
}

export interface ParsedList {
	source: 'anilist' | 'mal';
	entries: ListEntry[];
	/** Rows that were not manga, or had no usable title. */
	skipped: number;
}

const STATUS_FROM_ANILIST: Record<string, Status> = {
	CURRENT: 'reading',
	REPEATING: 'reading',
	COMPLETED: 'completed',
	PAUSED: 'on_hold',
	DROPPED: 'dropped',
	PLANNING: 'plan_to_read'
};

const STATUS_FROM_MAL: Record<string, Status> = {
	reading: 'reading',
	completed: 'completed',
	'on-hold': 'on_hold',
	dropped: 'dropped',
	'plan to read': 'plan_to_read'
};

function positive(value: unknown): number | null {
	const numeric = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100) / 100 : null;
}

function cleanText(value: unknown, max = 500): string {
	return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** AniList scores follow the account's scoring system: 100, 10, 5 or 3 point. */
function anilistRating(value: unknown): number | null {
	const numeric = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return null;
	if (numeric > 10) return normalizeRating(numeric / 10);
	if (numeric <= 3) return normalizeRating(numeric * 3);
	if (numeric <= 5) return normalizeRating(numeric * 2);
	return normalizeRating(numeric);
}

function xmlValue(block: string, tag: string): string {
	const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
	return match ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim() : '';
}

function decodeEntities(value: string): string {
	return value
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&amp;/g, '&');
}

function parseMal(xml: string): ParsedList {
	const mangaBlock = /<manga>([\s\S]*?)<\/manga>/i.exec(xml)?.[1] ?? '';
	const blocks = [...mangaBlock.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
	const entries: ListEntry[] = [];
	let skipped = 0;
	for (const block of blocks) {
		const title = decodeEntities(xmlValue(block, 'series_title'));
		if (!title) {
			skipped += 1;
			continue;
		}
		const statusText = xmlValue(block, 'my_status').toLowerCase();
		const status = STATUS_FROM_MAL[statusText] ?? 'plan_to_read';
		const score = Number(xmlValue(block, 'my_score'));
		const progress = Number(xmlValue(block, 'my_read_chapters'));
		entries.push({
			title,
			altTitles: [],
			totalChapters: positive(xmlValue(block, 'series_num_chapters')),
			chaptersRead: Number.isFinite(progress) && progress > 0 ? progress : null,
			status,
			rating: Number.isFinite(score) && score > 0 ? normalizeRating(score) : null,
			notes: cleanText(decodeEntities(xmlValue(block, 'my_comments')), 4000),
			coverUrl: null,
			tags: []
		});
	}
	return { source: 'mal', entries, skipped };
}

interface AniListMedia {
	title?: { romaji?: string; english?: string; native?: string };
	chapters?: number | null;
	coverImage?: { large?: string; medium?: string } | null;
	type?: string;
	format?: string;
	synonyms?: string[];
	tags?: Array<{ name?: string }>;
}

interface AniListEntry {
	media?: AniListMedia;
	status?: string;
	score?: number;
	progress?: number;
	notes?: string;
}

function parseAniList(payload: unknown): ParsedList {
	const root = payload as { lists?: unknown };
	if (!Array.isArray(root.lists)) {
		throw new Error('That JSON is not an AniList export: no lists were found.');
	}
	const entries: ListEntry[] = [];
	let skipped = 0;
	for (const list of root.lists as Array<{ entries?: unknown }>) {
		if (!Array.isArray(list?.entries)) continue;
		for (const raw of list.entries as AniListEntry[]) {
			const media = raw?.media;
			if (!media) {
				skipped += 1;
				continue;
			}
			// AniList exports anime and manga side by side; only the manga lists
			// describe chapters.
			const type = (media.type ?? '').toUpperCase();
			if (type && type !== 'MANGA') {
				skipped += 1;
				continue;
			}
			const title =
				cleanText(media.title?.english) ||
				cleanText(media.title?.romaji) ||
				cleanText(media.title?.native);
			if (!title) {
				skipped += 1;
				continue;
			}
			const altTitles = [media.title?.romaji, media.title?.native, ...(media.synonyms ?? [])]
				.map((value) => cleanText(value, 300))
				.filter((value): value is string => Boolean(value) && value !== title);
			const cover = media.coverImage?.large ?? media.coverImage?.medium ?? '';
			entries.push({
				title,
				altTitles: [...new Set(altTitles)].slice(0, 10),
				totalChapters: positive(media.chapters),
				chaptersRead: positive(raw.progress),
				status: STATUS_FROM_ANILIST[(raw.status ?? '').toUpperCase()] ?? 'plan_to_read',
				rating: anilistRating(raw.score),
				notes: cleanText(raw.notes, 4000),
				coverUrl: /^https?:\/\//i.test(cover) ? cover : null,
				tags: normalizeTags((media.tags ?? []).map((tag) => cleanText(tag?.name, 32)).slice(0, 12))
			});
		}
	}
	return { source: 'anilist', entries, skipped };
}

/**
 * Reads an AniList JSON export or a MyAnimeList XML export. Detection is by
 * content rather than file extension, because both are commonly renamed.
 */
export function parseReadingList(text: string): ParsedList {
	const trimmed = text.trim();
	if (!trimmed) throw new Error('That file is empty.');
	if (trimmed.startsWith('<')) {
		if (!/<myanimelist/i.test(trimmed)) {
			throw new Error('That XML is not a MyAnimeList export.');
		}
		return parseMal(trimmed);
	}
	let payload: unknown;
	try {
		payload = JSON.parse(trimmed);
	} catch {
		throw new Error('That file is neither an AniList JSON export nor a MyAnimeList XML export.');
	}
	return parseAniList(payload);
}
