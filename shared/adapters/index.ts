import type { Site } from '../model.ts';
import { comixAdapter } from './comix.ts';
import { mangadotAdapter } from './mangadot.ts';

export interface SiteAdapter {
	site: Site;
	version: string;
	matches(host: string): boolean;
	/** Removes the site's own suffix before the generic title cleanup runs. */
	cleanTitle(title: string): string;
	/** Best slug for the series, when the site puts it in a known path segment. */
	slug(url: URL): string | null;
	/**
	 * True when the URL points at a chapter but carries only a database id, so
	 * that id must never be read as a chapter number.
	 */
	opaqueChapterId?(url: URL): boolean;
	/**
	 * Stable source key for a chapter URL that has no series path of its own
	 * (MangaDot's /chapter/265763). Returning the same key for every chapter of
	 * one series keeps them on a single row instead of one row per chapter.
	 */
	seriesKey?(url: URL, seriesTitle: string | null): string | null;
}

const genericAdapter: SiteAdapter = {
	site: 'other',
	version: 'generic-1',
	matches: () => true,
	cleanTitle: (title) => title,
	slug: () => null
};

export const ADAPTERS: SiteAdapter[] = [comixAdapter, mangadotAdapter, genericAdapter];

export function adapterFor(host: string): SiteAdapter {
	return ADAPTERS.find((adapter) => adapter.matches(host)) ?? genericAdapter;
}

export function adapterVersions(): Record<string, string> {
	return Object.fromEntries(
		ADAPTERS.filter((adapter) => adapter.site !== 'other').map((adapter) => [
			adapter.site,
			adapter.version
		])
	);
}
