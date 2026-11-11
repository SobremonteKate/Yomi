import type { SiteAdapter } from './index.ts';

/**
 * MangaDot adapter. Same contract as the Comix adapter: host, title suffix,
 * series slug. Adjust `cleanTitle` here if the site changes its tab title.
 *
 * One quirk shapes everything else: a chapter page is `/chapter/265763`, a
 * database id with no series slug and no chapter number. The readable values
 * live only in the page title ("Otr of the Flame — Chapter 34 | MangaDot"), so
 * the id must be ignored and the title used as the series key instead.
 */
const OPAQUE_CHAPTER = /^\/chapter\/\d+\/?$/i;

function titleKey(title: string): string | null {
	const slug = title
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 120);
	return slug || null;
}

export const mangadotAdapter: SiteAdapter = {
	site: 'mangadot',
	version: 'mangadot-2',
	matches: (host) => /(^|\.)mangadot\./.test(host.toLowerCase()),
	cleanTitle: (title) =>
		title
			.replace(/\s*[|·•]\s*Manga\s*Dot\b.*$/i, '')
			.replace(/\s*[|·•]\s*MangaDot\b.*$/i, '')
			.replace(/\s+[-–—]\s+Manga\s*Dot\b.*$/i, '')
			.replace(/\s+[-–—]\s+MangaDot\b.*$/i, '')
			.trim(),
	slug: (url) => {
		const match = url.pathname.match(/\/(?:manga|series|comic|title)\/([^/]+)/i);
		return match?.[1] ?? null;
	},
	opaqueChapterId: (url) => OPAQUE_CHAPTER.test(url.pathname),
	seriesKey: (url, seriesTitle) => {
		const key = seriesTitle ? titleKey(seriesTitle) : null;
		return key ? `${url.host.toLowerCase()}/manga/title/${key}` : null;
	}
};
