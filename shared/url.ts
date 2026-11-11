import type { Site } from './model.ts';

export interface NormalizedUrl {
	/** Canonical URL with tracking parameters and the hash removed. */
	url: string;
	host: string;
	site: Site;
	/** Lowercased host + path, no query. The source identity key. */
	normalized_path: string;
	pathname: string;
	searchParams: URLSearchParams;
}

const TRACKING_PARAMS = [
	/^utm_/i,
	/^fbclid$/i,
	/^gclid$/i,
	/^yclid$/i,
	/^igshid$/i,
	/^mc_(cid|eid)$/i,
	/^ref_src$/i,
	/^_ga$/i
];

export function siteFromHost(host: string): Site {
	const clean = host.toLowerCase().replace(/^www\./, '');
	if (/(^|\.)comix\./.test(clean)) return 'comix';
	if (/(^|\.)mangadot\./.test(clean)) return 'mangadot';
	return 'other';
}

export function hostRoot(host: string): string {
	return host.toLowerCase().replace(/^www\./, '').split('.')[0] ?? host;
}

export function hostLabel(host: string): string {
	return host.toLowerCase().replace(/^www\./, '');
}

/** Adds a scheme to a pasted bare domain, then normalises it. */
export function normalizeUrl(raw: string): NormalizedUrl | null {
	if (typeof raw !== 'string') return null;
	let text = raw.trim().replace(/[\u200b-\u200d\ufeff]/g, '');
	if (!text) return null;
	if (/^(javascript|data|file|ftp):/i.test(text)) return null;
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) === false) {
		if (!/^[\w.-]+\.[a-z]{2,}([/:?#]|$)/i.test(text)) return null;
		text = `https://${text}`;
	}

	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (!url.hostname.includes('.')) return null;

	url.hash = '';
	const keep = new URLSearchParams();
	for (const [key, value] of url.searchParams) {
		if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) continue;
		keep.append(key, value);
	}
	url.search = keep.toString();
	url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
	if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) {
		url.protocol = 'https:';
	}

	const pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
	const host = url.hostname;
	const site = siteFromHost(host);
	const normalized_path = `${host.toLowerCase()}${pathname.toLowerCase()}`;

	const clean = `${url.protocol}//${host}${pathname}${url.search ? `?${url.searchParams.toString()}` : ''}`;

	return {
		url: clean,
		host,
		site,
		normalized_path,
		pathname,
		searchParams: url.searchParams
	};
}
