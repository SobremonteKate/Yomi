import type { Series, Source } from '../../shared/model.ts';
import { cleanSeriesTitle } from '../../shared/parse.ts';
import { normalizeUrl } from '../../shared/url.ts';

/**
 * Cover lookup runs in the browser, not in the Worker.
 *
 * AniList answers Cloudflare Workers with 403, and its API is CORS-open, so the
 * device that is already open is the one place this works. Matching is strict:
 * a wrong cover is worse than the placeholder initial.
 */
const ENDPOINT = 'https://graphql.anilist.co';
const TIMEOUT_MS = 6000;

const QUERY = `query ($search: String, $perPage: Int) {
	Page(perPage: $perPage) {
		media(search: $search, type: MANGA) {
			title { romaji english native }
			coverImage { extraLarge large }
			description(asHtml: false)
			chapters
			status
		}
	}
}`;

interface Media {
	title?: { romaji?: string | null; english?: string | null; native?: string | null } | null;
	coverImage?: { extraLarge?: string | null; large?: string | null } | null;
	/** Catalogue synopsis, already flattened with asHtml: false. */
	description?: string | null;
	/** Published chapter count; null while a series is still releasing. */
	chapters?: number | null;
	status?: string | null;
}

/** Lowercase, accent-free, punctuation-free, leading article dropped. */
export function normalizeTitle(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/^(the|a|an) /, '');
}

function matchesTitle(item: Media, wanted: string): boolean {
	if (!wanted) return false;
	return [item.title?.romaji, item.title?.english, item.title?.native]
		.filter((name): name is string => Boolean(name))
		.map(normalizeTitle)
		.some((name) => name === wanted || (name.length >= 6 && wanted.includes(name)));
}

export function pickCover(media: Media[], title: string): string | null {
	const wanted = normalizeTitle(title);
	if (!wanted) return null;
	for (const item of media) {
		// Exact match first; otherwise the site title may carry a suffix such as
		// "Chainsaw Man Chapter 149" that the catalogue title does not.
		if (!matchesTitle(item, wanted)) continue;
		const cover = item.coverImage?.extraLarge ?? item.coverImage?.large ?? null;
		if (cover && /^https:\/\//i.test(cover)) return cover;
	}
	return null;
}

export interface SeriesMeta {
	cover: string | null;
	/** Published chapter total, for "149 of 172" and the up-to-date mark. */
	chapters: number | null;
	status: string | null;
	/** Plain-text synopsis from the same catalogue entry as the cover. */
	description: string | null;
}

const EMPTY_META: SeriesMeta = { cover: null, chapters: null, status: null, description: null };

/**
 * AniList's asHtml:false keeps line breaks as <br> and leaves a scattering of
 * entities, so the synopsis is flattened to text once here rather than in every
 * view that shows it.
 */
export function cleanDescription(raw: string | null | undefined, max = 4000): string | null {
	if (!raw) return null;
	const text = raw
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(?:p|div|li)>/gi, '\n')
		.replace(/<[^>]*>/g, '')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#0?39;|&apos;/gi, "'")
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	if (!text) return null;
	return text.slice(0, max);
}

/**
 * Cover and chapter total from the catalogue's own entry. A total is only
 * reported when AniList actually has one: on a releasing series `chapters` is
 * usually null, and guessing would be worse than showing nothing.
 */
export function pickMeta(media: Media[], title: string): SeriesMeta {
	const wanted = normalizeTitle(title);
	if (!wanted) return EMPTY_META;
	const matched = media.filter((item) => matchesTitle(item, wanted));
	if (matched.length === 0) return EMPTY_META;

	// The cover decides the entry, and the synopsis rides with it: a synopsis
	// from a different candidate is worse than no synopsis at all.
	let primary: Media | null = null;
	let cover: string | null = null;
	for (const item of matched) {
		const candidate = item.coverImage?.extraLarge ?? item.coverImage?.large ?? null;
		if (candidate && /^https:\/\//i.test(candidate)) {
			primary = item;
			cover = candidate;
			break;
		}
	}
	if (!primary) primary = matched[0];

	let chapters: number | null = null;
	let status: string | null = null;
	for (const item of matched) {
		if (typeof item.chapters === 'number' && item.chapters > 0) {
			chapters = Math.floor(item.chapters);
			status = item.status ?? null;
			break;
		}
	}
	return {
		cover,
		chapters,
		status,
		description: cleanDescription(primary.description)
	};
}

function cleanTitle(rawTitle: string): string {
	return rawTitle
		.replace(/\s*\((?:manga|manhwa|manhua|comic|webtoon)\)\s*$/i, '')
		.trim();
}

/*
 * One shelf-wide backfill is many requests, so pacing lives here rather than in
 * the caller: three in flight and a ceiling well under AniList's 90/minute.
 * A 429 is waited out once instead of silently dropping that series.
 */
const MINUTE_MS = 60_000;
const MAX_CONCURRENT = 3;
const MAX_PER_MINUTE = 60;

let inFlight = 0;
const waiting: (() => void)[] = [];
const starts: number[] = [];

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquire(): Promise<void> {
	while (inFlight >= MAX_CONCURRENT) {
		await new Promise<void>((resolve) => waiting.push(resolve));
	}
	inFlight += 1;
	for (;;) {
		const now = Date.now();
		while (starts.length > 0 && now - starts[0] >= MINUTE_MS) starts.shift();
		if (starts.length < MAX_PER_MINUTE) break;
		await sleep(MINUTE_MS - (now - starts[0]) + 25);
	}
	starts.push(Date.now());
}

function release(): void {
	inFlight -= 1;
	waiting.shift()?.();
}

async function scheduled<T>(run: () => Promise<T>): Promise<T> {
	await acquire();
	try {
		return await run();
	} finally {
		release();
	}
}

interface Attempt {
	media: Media[];
	/** Set when the catalogue asked us to back off; the caller may retry once. */
	retryAfterMs: number | null;
}

async function fetchOnce(search: string, perPage: number): Promise<Attempt> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ query: QUERY, variables: { search, perPage } }),
			signal: controller.signal
		});
		if (response.status === 429) {
			const header = Number(response.headers.get('retry-after'));
			const seconds = Number.isFinite(header) && header > 0 ? header : 30;
			return { media: [], retryAfterMs: Math.min(seconds * 1000, 65_000) };
		}
		if (!response.ok) return { media: [], retryAfterMs: null };
		const payload = (await response.json()) as {
			data?: { Page?: { media?: Media[] } };
		};
		return { media: payload.data?.Page?.media ?? [], retryAfterMs: null };
	} catch {
		return { media: [], retryAfterMs: null };
	} finally {
		clearTimeout(timer);
	}
}

async function queryAniList(search: string, perPage: number): Promise<Media[]> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const outcome = await scheduled(() => fetchOnce(search, perPage));
		if (outcome.retryAfterMs === null) return outcome.media;
		if (attempt === 0) await sleep(outcome.retryAfterMs);
	}
	return [];
}

const MAX_QUERIES = 3;

/**
 * Every title worth trying, best first: the name you gave the series, then the
 * page titles its captures came from (these carry the real title, where a slug
 * only has a guess), then any alt titles. Page titles go through the same
 * cleaner the capture parser uses, so "Verify Guard Ch. 2 - Comix" becomes
 * "Verify Guard" rather than a query AniList cannot answer.
 */
export function coverSearchTerms(
	series: Pick<Series, 'title' | 'alt_titles'>,
	sources: Source[]
): string[] {
	const raw: string[] = [series.title];
	for (const source of sources) {
		const pageTitle = source.site_title?.trim();
		if (!pageTitle) continue;
		const normalized = normalizeUrl(source.url);
		const cleaned = normalized
			? cleanSeriesTitle(pageTitle, normalized.host, source.site)
			: null;
		if (cleaned) raw.push(cleaned);
	}
	raw.push(...(series.alt_titles ?? []));

	const seen = new Set<string>();
	const terms: string[] = [];
	for (const value of raw) {
		const term = value.replace(/\s+/g, ' ').trim();
		const key = normalizeTitle(term);
		if (!key || key.length < 2 || seen.has(key)) continue;
		seen.add(key);
		terms.push(term);
	}
	return terms;
}

function toTerms(value: string | string[]): string[] {
	return (Array.isArray(value) ? value : [value]).filter((term) => term.trim().length > 0);
}

export async function lookupCover(terms: string | string[]): Promise<string | null> {
	return (await lookupMeta(terms)).cover;
}

/** One request per term, returning every field the enrichment pass can fill. */
export async function lookupMeta(terms: string | string[]): Promise<SeriesMeta> {
	for (const term of toTerms(terms).slice(0, MAX_QUERIES)) {
		const title = cleanTitle(term);
		if (title.length < 2) continue;
		const meta = pickMeta(await queryAniList(title, 5), title);
		if (meta.cover || meta.chapters !== null) return meta;
	}
	return EMPTY_META;
}

export interface CoverCandidate {
	title: string;
	cover: string;
}

export interface CoverSearch {
	query: string;
	candidates: CoverCandidate[];
}

function toCandidates(media: Media[]): CoverCandidate[] {
	const seen = new Set<string>();
	const candidates: CoverCandidate[] = [];
	for (const item of media) {
		const cover = item.coverImage?.extraLarge ?? item.coverImage?.large ?? null;
		if (!cover || !/^https:\/\//i.test(cover) || seen.has(cover)) continue;
		seen.add(cover);
		candidates.push({
			cover,
			title: item.title?.english || item.title?.romaji || item.title?.native || 'Untitled'
		});
	}
	return candidates;
}

/**
 * Every plausible cover for a title, for the manual picker. Unlike the
 * automatic lookup this returns the whole shortlist, so a wrong match can be
 * rejected by eye instead of guessed at. Accepts several candidate titles and
 * reports which one produced the grid, so the field can show it.
 */
export async function searchCovers(
	terms: string | string[],
	perPage = 8
): Promise<CoverSearch> {
	const list = toTerms(terms).slice(0, MAX_QUERIES);
	for (const term of list) {
		const title = cleanTitle(term);
		if (title.length < 2) continue;
		const candidates = toCandidates(await queryAniList(title, perPage));
		if (candidates.length > 0) return { query: title, candidates };
	}
	return { query: cleanTitle(list[0] ?? ''), candidates: [] };
}
