import type { SiteAdapter } from './index.ts';

/**
 * Comix adapter. Keep this file small: the only site-specific knowledge is the
 * host, the title suffix and where the series slug sits. Everything else runs
 * through the shared parser, so a markup change degrades to a URL-only stub
 * instead of breaking capture.
 */
const SERIES_PATH = /\/(?:title|manga|series|comic|comics)\/([^/]+)/i;

export function comixSlug(url: URL): string | null {
	return url.pathname.match(SERIES_PATH)?.[1] ?? null;
}

/**
 * Splits Comix's internal slug prefix from the real title slug. The code is
 * four or five letters/digits and always contains a digit (`nr83`, `7grxe`,
 * `2031`). `the-sword-bearing-flower` has no code and comes back null.
 */
export function comixSlugCode(slug: string): { code: string; rest: string } | null {
	const match = slug.match(/^([a-z0-9]{4,5})-(.+)$/i);
	if (!match || !/\d/.test(match[1])) return null;
	return { code: match[1], rest: match[2] };
}

export const comixAdapter: SiteAdapter = {
	site: 'comix',
	version: 'comix-1',
	matches: (host) => /(^|\.)comix\./.test(host.toLowerCase()),
	cleanTitle: (title) =>
		title
			.replace(/\s*[|·•]\s*Comix\b.*$/i, '')
			.replace(/\s+[-–—]\s+Read\b.*$/i, '')
			.replace(/\s+[-–—]\s+Comix\b.*$/i, '')
			.trim(),
	slug: (url) => {
		const slug = comixSlug(url);
		if (!slug) return null;
		// The code is site metadata, not part of the name. Real leading words
		// stay put: they are shorter, or they have no digit.
		return comixSlugCode(slug)?.rest ?? slug;
	}
};
