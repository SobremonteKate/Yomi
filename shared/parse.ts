import { SITE_LABEL, type Site } from './model.ts';
import { normalizeUrl, type NormalizedUrl } from './url.ts';
import { adapterFor, type SiteAdapter } from './adapters/index.ts';
import { comixSlug, comixSlugCode } from './adapters/comix.ts';

export interface CaptureInput {
	url: string;
	/** document.title — the tab title. */
	title?: string | null;
	/** Visible page heading, usually the series name. */
	heading?: string | null;
	/** Visible breadcrumb text, e.g. "Home / Manga / Chainsaw Man / Chapter 149". */
	breadcrumb?: string | null;
	/** The chapter label exactly as the page renders it. */
	label?: string | null;
	chapter?: number | string | null;
	volume?: number | string | null;
	cover_url?: string | null;
}

export interface ParsedCapture {
	url: string;
	/** The series page URL this chapter belongs to. Source identity uses this. */
	source_url: string;
	host: string;
	site: Site;
	site_label: string;
	normalized_path: string;
	series_title: string | null;
	title_source: 'heading' | 'title' | 'breadcrumb' | 'url' | 'none';
	site_title: string;
	chapter: number | null;
	chapter_label: string;
	volume: number | null;
	cover_url: string | null;
	confidence: 'high' | 'medium' | 'low';
	needs_review: boolean;
	adapter_version: string;
	is_chapter_page: boolean;
}

const CHAPTER_TEXT =
	/(?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*#?\s*(\d+(?:[.,]\d+)?)/i;
const CHAPTER_GLOBAL =
	/\b(?:chapter|chap\.?|ch\.?|episode|ep\.?)\s*#?\s*\d+(?:[.,]\d+)?\b/gi;
const VOLUME_TEXT = /\b(?:volume|vol)\.?\s*(\d+)\b/i;
const VOLUME_GLOBAL = /\b(?:volume|vol)\.?\s*\d+\b/gi;

const SITE_NOISE =
	/\b(?:comix|mangadot|manga\s*dot|read\s+online|reading\s+online|official\s+site|scan(?:lation)?s?|raws?)\b/i;

const GENERIC_SEGMENTS = new Set([
	'manga',
	'manhwa',
	'manhua',
	'comic',
	'comics',
	'series',
	'title',
	'read',
	'reader',
	'chapter',
	'chapters',
	'episode',
	'episodes',
	'c',
	'en',
	'home',
	'index'
]);

function collapse(value: string): string {
	return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A text field that contains nothing but a URL is a capture that sent the wrong
 * slot (a Shortcut passing "Shortcut Input" as the page name does this). Treat it
 * as absent so the title falls through to the slug instead of naming a series
 * "https://".
 */
function withoutUrlText(value: string): string {
	const text = collapse(value);
	return /^(?:https?:\/\/|www\.)\S*$/i.test(text) ? '' : text;
}

function tokenToChapter(token: string): number | null {
	const normalized = token.replace(',', '.');
	const split = normalized.match(/^(\d+)[-.](\d+)$/);
	let value: number;
	if (split) {
		value = split[2].length === 1 ? Number(`${split[1]}.${split[2]}`) : Number(split[1]);
	} else {
		value = Number(normalized);
	}
	if (!Number.isFinite(value) || value <= 0) return null;
	return Math.round(value * 100) / 100;
}

function chapterFromUrl(
	normalized: NormalizedUrl,
	adapter: SiteAdapter
): { chapter: number | null; volume: number | null } {
	const path = decodeURIComponent(normalized.pathname);
	const patterns = [
		/(?:^|[/_-])(?:chapter|chap|ch|episode|ep)[-_ /]?(\d+(?:[.-]\d+)?)(?=$|[/_?#-])/gi,
		/(?:^|[/_-])ch[-_ /]?(\d+(?:[.-]\d+)?)(?=$|[/_?#-])/gi
	];
	let token: string | null = null;
	// MangaDot's /chapter/265763 is a database id, not a chapter number. Reading
	// it as one produced "ch. 265763" rows; the real number lives in the title.
	const opaque = adapter.opaqueChapterId?.(new URL(normalized.url)) ?? false;
	if (!opaque) {
		for (const pattern of patterns) {
			for (const match of path.matchAll(pattern)) token = match[1];
		}
	}
	let chapter = token ? tokenToChapter(token) : null;

	if (chapter === null) {
		const queryChapter = normalized.searchParams.get('chapter') ?? normalized.searchParams.get('ch');
		if (queryChapter) chapter = tokenToChapter(queryChapter);
	}
	const volumeMatch = path.match(/(?:^|[/_-])(?:volume|vol)[-_ /]?(\d+)(?=$|[/?#-])/i);
	const queryVolume = normalized.searchParams.get('volume') ?? normalized.searchParams.get('vol');
	const volumeValue = volumeMatch?.[1] ?? queryVolume;
	const volume = volumeValue && /^\d+$/.test(volumeValue) ? Number(volumeValue) : null;
	return { chapter, volume };
}

/**
 * A chapter URL is not a source. Strip the volume/chapter segment so all
 * chapters on one site's series page share a single source row.
 */
export function deriveSourceUrl(
	normalized: NormalizedUrl,
	seriesTitle: string | null = null
): {
	url: string;
	normalized_path: string;
	pathname: string;
} {
	const original = {
		url: normalized.url,
		normalized_path: normalized.normalized_path,
		pathname: normalized.pathname
	};
	const segments = normalized.pathname.split('/').filter(Boolean);
	let cut = -1;
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index];
		if (/^(?:chapter|chap|ch|episode|ep)(?:[-_ /]?\d|$)/i.test(segment)) {
			cut = index;
			break;
		}
		if (/^(?:volume|vol)(?:[-_ /]?\d)/i.test(segment)) {
			cut = index;
			break;
		}
	}
	if (cut <= 0) {
		// Some sites hide the series behind an opaque chapter id (MangaDot's
		// /chapter/265763). With no series path in the URL, the cleaned title is
		// the only stable key, so all chapters of one series share a single row.
		const adapter = adapterFor(normalized.host);
		const url = new URL(normalized.url);
		const key = adapter.opaqueChapterId?.(url)
			? (adapter.seriesKey?.(url, seriesTitle) ?? null)
			: null;
		if (key) {
			return { url: normalized.url, normalized_path: key.toLowerCase(), pathname: url.pathname };
		}
		return original;
	}
	const base = segments.slice(0, cut);
	if (base.length === 0) return original;
	const pathname = `/${base.join('/')}`;
	const origin = new URL(normalized.url).origin;
	return {
		url: `${origin}${pathname}`,
		normalized_path: `${normalized.host.toLowerCase()}${pathname.toLowerCase()}`,
		pathname
	};
}

function isSiteOnly(value: string, host: string): boolean {
	const text = collapse(value)
		.toLowerCase()
		.replace(/[.\-_]+$/, '')
		.replace(/^(read|reading)\s+/, '')
		.replace(/\s+(online|free|manga|manhwa|manhua)$/, '');
	if (!text) return true;
	if (text === SITE_LABEL.comix.toLowerCase() || text === 'comix' || text === 'mangadot') {
		return true;
	}
	if (/^(comix|mangadot|manga\s*dot)(\s+(online|manga|free|read))?$/.test(text)) return true;
	if (/^(home|manga|manhwa|manhua|series|comics?|read online|read manga)$/.test(text)) return true;
	const root = host.replace(/^www\./, '').split('.')[0];
	return text === root;
}

function isChapterOnly(value: string): boolean {
	const stripped = collapse(value)
		.replace(CHAPTER_GLOBAL, '')
		.replace(VOLUME_GLOBAL, '')
		.replace(/[|·•,;:–—-]+/g, '')
		.trim();
	return stripped.length === 0;
}

function looksLikeSiteBoilerplate(value: string): boolean {
	return (
		SITE_NOISE.test(value) ||
		/\b(?:read|reading)\b.*\b(?:online|free)\b/i.test(value) ||
		/\b(?:home|browse|latest releases?)\b/i.test(value)
	);
}

function splitTitleCandidates(raw: string): string[] {
	return collapse(raw)
		.split(/\s*[|·•]\s*/)
		.filter(Boolean);
}

/**
 * Cuts a title at its first chapter/episode marker, because everything after that
 * marker describes the chapter ("... Episode 23 - The Pool (2)"). Returns null when
 * the marker starts the string or nothing usable precedes it, so the caller keeps
 * the original text.
 */
function dropChapterTail(value: string): string | null {
	const match = CHAPTER_TEXT.exec(value);
	if (!match || match.index === undefined || match.index === 0) return null;
	const head = value
		.slice(0, match.index)
		.replace(/[\s\-–—:|·•,;]+$/, '')
		.trim();
	return head.length >= 2 && !isChapterOnly(head) ? head : null;
}

function stripChapterClauses(value: string): string {
	let text = value
		.replace(CHAPTER_GLOBAL, ' ')
		.replace(VOLUME_GLOBAL, ' ')
		.replace(/\b(?:chapter|chap|ch)\.?\s*$/i, ' ')
		.replace(/\(\s*\)/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.replace(/^[\s\-–—:|·•,;]+/, '')
		.replace(/[\s\-–—:|·•,;]+$/, '');
	return collapse(text);
}

function dedupeRepeated(text: string): string {
	const words = text.split(' ');
	const half = Math.floor(words.length / 2);
	if (words.length >= 6 && words.length % 2 === 0) {
		const first = words.slice(0, half).join(' ').toLowerCase();
		const second = words.slice(half).join(' ').toLowerCase();
		if (first === second) return words.slice(0, half).join(' ');
	}
	return text;
}

export function cleanSeriesTitle(raw: string, host: string, site: Site): string | null {
	let text = collapse(raw);
	if (!text) return null;

	text = text.replace(/^\s*(read|reading)\s+/i, '');

	// "Episode 23 - The Pool (2)" names that chapter, not the series.
	const head = dropChapterTail(text);
	if (head) text = head;

	const candidates = splitTitleCandidates(text);
	const parts = candidates.flatMap((candidate) =>
		candidate.split(/\s+[-–—]\s+/).filter(Boolean)
	);

	if (parts.length > 1) {
		const useful = parts.filter((part) => {
			if (isSiteOnly(part, host)) return false;
			if (looksLikeSiteBoilerplate(part) && parts.length > 1) return false;
			return true;
		});
		const nonChapter = useful.filter((part) => !isChapterOnly(part));
		text = (nonChapter.length > 0 ? nonChapter : useful).join(' - ');
	} else if (candidates.length > 0) {
		text = candidates.find((candidate) => !isSiteOnly(candidate, host)) ?? candidates[0];
	}

	text = stripChapterClauses(text);
	text = text
		.replace(/^\s*(read|reading)\s+/i, '')
		.replace(/\b(?:read|reading)\b\s*$/i, '')
		.replace(/\b(?:online|free|english|scan(?:lation)?s?|raw|official)\b/gi, ' ')
		.replace(/\b(?:comix|mangadot|manga\s*dot)\b.*$/i, ' ')
		.replace(/\s*[|·•]\s*$/, '')
		.replace(/\s{2,}/g, ' ')
		.trim();

	text = dedupeRepeated(text);
	text = stripChapterClauses(text);

	if (!text || text.length < 2) return null;
	if (isSiteOnly(text, host) || looksLikeSiteBoilerplate(text)) return null;
	if (!/[a-z0-9]/i.test(text)) return null;
	return text.slice(0, 300);
}

function titleFromBreadcrumb(raw: string | null | undefined, host: string, site: Site): string | null {
	if (!raw) return null;
	const segments = collapse(raw)
		.split(/\s*(?:\/|›|»|\||>|•)\s*/)
		.filter(Boolean)
		.filter((segment) => !isSiteOnly(segment, host))
		.filter((segment) => !isChapterOnly(segment));
	if (segments.length === 0) return null;
	for (let index = segments.length - 1; index >= 0; index -= 1) {
		const cleaned = cleanSeriesTitle(segments[index], host, site);
		if (cleaned) return cleaned;
	}
	return null;
}

export function slugToTitle(slug: string): string | null {
	let text = decodeURIComponent(slug)
		.replace(/\.(?:html?|php|aspx?)$/i, '')
		.replace(/[-_]+/g, ' ')
		.replace(/\b(?:chapter|chap|ch|episode|ep)[- ]?\d+.*$/i, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
	if (!text) return null;
	const small = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);
	const words = text.split(' ').map((word, index) => {
		if (word !== word.toLowerCase()) return word;
		if (index > 0 && small.has(word)) return word;
		return word.charAt(0).toUpperCase() + word.slice(1);
	});
	text = words.join(' ');
	return text.length >= 2 ? text.slice(0, 300) : null;
}

function titleCompareKey(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/['’`]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * Old captures put Comix's slug code into the display title (`Nr83 the Sword…`).
 * Returns the canonical title only when the current title is exactly that
 * auto-generated code + slug, so hand-edited names and real numeric titles are
 * left alone.
 */
export function cleanComixTitleCode(title: string, sourceUrl: string): string | null {
	const normalized = normalizeUrl(sourceUrl);
	if (!normalized || normalized.site !== 'comix') return null;
	let url: URL;
	try {
		url = new URL(normalized.url);
	} catch {
		return null;
	}
	const slug = comixSlug(url);
	const parts = slug ? comixSlugCode(slug) : null;
	if (!parts) return null;

	const text = collapse(title);
	if (text.length <= parts.code.length) return null;
	if (text.slice(0, parts.code.length).toLowerCase() !== parts.code.toLowerCase()) return null;
	if (!/[\s\-–—:|·•]/.test(text.charAt(parts.code.length))) return null;

	const rest = text
		.slice(parts.code.length)
		.replace(/^[\s\-–—:|·•]+/, '')
		.trim();
	if (!rest) return null;
	if (titleCompareKey(rest) !== titleCompareKey(parts.rest.replace(/-/g, ' '))) return null;

	const clean = slugToTitle(parts.rest);
	return clean && clean !== text ? clean : null;
}

function seriesTitleFromUrl(normalized: NormalizedUrl, site: Site): string | null {
	const adapter = adapterFor(normalized.host);
	const adapterSlug = adapter.slug(new URL(normalized.url));
	if (adapterSlug) {
		const title = slugToTitle(adapterSlug);
		if (title) return title;
	}
	const segments = normalized.pathname
		.split('/')
		.filter(Boolean)
		.map((segment) => {
			try {
				return decodeURIComponent(segment);
			} catch {
				return segment;
			}
		});

	const chapterIndex = segments.findIndex(
		(segment) =>
			/^(?:chapter|chap|ch|episode|ep)[-_]?\d/i.test(segment) ||
			/^\d+(?:[.-]\d+)?$/.test(segment)
	);

	const candidates = segments
		.map((segment, index) => ({ segment, index }))
		.filter(({ segment, index }) => {
			if (index === chapterIndex) return false;
			const lower = segment.toLowerCase();
			if (GENERIC_SEGMENTS.has(lower)) return false;
			if (/^\d+(?:[.-]\d+)?$/.test(segment)) return false;
			if (/^[0-9a-f]{8,}$/i.test(segment)) return false;
			if (segment.length < 2 || segment.length > 120) return false;
			return true;
		});

	const beforeChapter = candidates.filter(({ index }) => chapterIndex === -1 || index < chapterIndex);
	const chosen =
		beforeChapter.sort((a, b) => b.segment.length - a.segment.length)[0] ??
		candidates.sort((a, b) => b.segment.length - a.segment.length)[0];

	if (!chosen) return null;
	return slugToTitle(chosen.segment);
}

function chapterLabelFrom(
	label: string | null | undefined,
	combinedText: string,
	chapter: number | null
): string {
	if (label) {
		const cleaned = collapse(label).slice(0, 80);
		if (cleaned) return cleaned;
	}
	const match = combinedText.match(
		new RegExp(
			`((?:vol(?:ume)?\\.?\\s*\\d+\\s*[·|,:;–—-]?\\s*)?${CHAPTER_TEXT.source})`,
			'i'
		)
	);
	if (match) return collapse(match[1]).slice(0, 80);
	return chapter !== null ? `Ch. ${chapter}` : '';
}

export function parseCapture(input: CaptureInput): ParsedCapture | null {
	const normalized = normalizeUrl(input.url);
	if (!normalized) return null;
	const adapter = adapterFor(normalized.host);
	const site = normalized.site;

	const pageTitle = withoutUrlText(input.title ?? '');
	const heading = withoutUrlText(input.heading ?? '');
	const breadcrumb = withoutUrlText(input.breadcrumb ?? '');
	const fromUrl = chapterFromUrl(normalized, adapter);

	const combinedText = [heading, breadcrumb, pageTitle, input.label ?? '']
		.filter(Boolean)
		.join(' · ');

	const explicitChapter =
		input.chapter !== null && input.chapter !== undefined
			? tokenToChapter(String(input.chapter).replace(/[^\d.,-]/g, ''))
			: null;
	const textChapterMatch = combinedText.match(CHAPTER_TEXT);
	const textChapter = textChapterMatch ? tokenToChapter(textChapterMatch[1]) : null;
	const chapter = explicitChapter ?? textChapter ?? fromUrl.chapter;

	const explicitVolume =
		input.volume !== null && input.volume !== undefined ? Number(input.volume) : null;
	const textVolume = combinedText.match(VOLUME_TEXT);
	const volume =
		(explicitVolume !== null && Number.isFinite(explicitVolume) && explicitVolume > 0
			? explicitVolume
			: null) ??
		(textVolume ? Number(textVolume[1]) : null) ??
		fromUrl.volume;

	let seriesTitle: string | null = null;
	let titleSource: ParsedCapture['title_source'] = 'none';

	if (heading) {
		const cleanedHeading = cleanSeriesTitle(heading, normalized.host, site);
		if (cleanedHeading) {
			seriesTitle = cleanedHeading;
			titleSource = 'heading';
		}
	}
	if (!seriesTitle && pageTitle) {
		const fromPageTitle = cleanSeriesTitle(adapter.cleanTitle(pageTitle), normalized.host, site);
		if (fromPageTitle) {
			seriesTitle = fromPageTitle;
			titleSource = 'title';
		}
	}
	if (!seriesTitle && breadcrumb) {
		const fromCrumb = titleFromBreadcrumb(breadcrumb, normalized.host, site);
		if (fromCrumb) {
			seriesTitle = fromCrumb;
			titleSource = 'breadcrumb';
		}
	}
	if (!seriesTitle) {
		const fromSlug = seriesTitleFromUrl(normalized, site);
		if (fromSlug) {
			seriesTitle = fromSlug;
			titleSource = 'url';
		}
	}

	if (seriesTitle && titleSource === 'title') {
		seriesTitle = cleanSeriesTitle(seriesTitle, normalized.host, site) ?? seriesTitle;
	}

	const chapter_label = chapterLabelFrom(input.label, combinedText, chapter);
	const source = deriveSourceUrl(normalized, seriesTitle);
	const cover = typeof input.cover_url === 'string' ? input.cover_url.trim() : '';
	const cover_url = /^https?:\/\//i.test(cover) ? cover.slice(0, 2000) : null;

	const strongTitle = titleSource === 'heading' || titleSource === 'title' || titleSource === 'breadcrumb';
	const urlSaysChapter = /(?:chapter|chap|ch|episode|ep)[-_/]?\d/i.test(normalized.pathname);

	let confidence: ParsedCapture['confidence'] = 'low';
	if (chapter !== null && seriesTitle && strongTitle) confidence = 'high';
	else if ((chapter !== null && seriesTitle) || (seriesTitle && strongTitle)) confidence = 'medium';
	else if (chapter !== null) confidence = 'medium';

	const needs_review =
		!seriesTitle ||
		titleSource === 'url' ||
		confidence === 'low' ||
		(chapter === null && urlSaysChapter);

	return {
		url: normalized.url,
		source_url: source.url,
		host: normalized.host,
		site,
		site_label: SITE_LABEL[site],
		normalized_path: source.normalized_path,
		series_title: seriesTitle,
		title_source: titleSource,
		site_title: pageTitle.slice(0, 500),
		chapter,
		chapter_label,
		volume,
		cover_url,
		confidence,
		needs_review,
		adapter_version: adapter.version,
		is_chapter_page: chapter !== null
	};
}

/** Human-readable explanation of what a capture could and could not read. */
export function captureSummary(parsed: ParsedCapture): string {
	if (parsed.needs_review && !parsed.chapter) {
		return 'No chapter number found. Add the series now and log chapters from the app.';
	}
	if (parsed.needs_review) {
		return 'Title is uncertain. Check the name before adding.';
	}
	return `${parsed.site_label} · ${parsed.chapter_label || 'series page'}`;
}
