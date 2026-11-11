import type { Series, Status } from '../../shared/model.ts';

/**
 * Shelf view state — search, sort and the review filter.
 *
 * These are the rules behind the shelf header, kept pure so they can be tested
 * without mounting the Svelte app. Progress is not consulted here; the caller
 * supplies a numeric score per row, because "recently read" is a fact about
 * events, not about the series row itself.
 */

export type ShelfSort = 'recent' | 'added' | 'title';

export const SHELF_SORTS: ShelfSort[] = ['recent', 'added', 'title'];

export const SHELF_SORT_LABEL: Record<ShelfSort, string> = {
	recent: 'Newest read first',
	added: 'Recently added',
	title: 'Title A–Z'
};

export function searchTokens(query: string): string[] {
	return query
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.split(/\s+/)
		.filter(Boolean);
}

/**
 * Every token has to appear somewhere in the row — title, alt titles, synopsis
 * or the page titles its captures came from. That makes "chainsaw man" and
 * "man chainsaw" both find the row, without ranking surprises.
 */
export function seriesMatches(
	row: Pick<Series, 'title' | 'alt_titles' | 'description'>,
	query: string,
	extras: readonly string[] = []
): boolean {
	const tokens = searchTokens(query);
	if (tokens.length === 0) return true;
	const haystack = [row.title, ...(row.alt_titles ?? []), row.description ?? '', ...extras]
		.join('\n')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '');
	return tokens.every((token) => haystack.includes(token));
}

export function filterShelf<T extends Pick<Series, 'status' | 'needs_review'>>(
	rows: T[],
	filter: Status | 'all' | 'review'
): T[] {
	if (filter === 'all') return [...rows];
	if (filter === 'review') return rows.filter((row) => row.needs_review);
	return rows.filter((row) => row.status === filter);
}

export function sortShelf<T extends Pick<Series, 'id' | 'title' | 'created_at'>>(
	rows: T[],
	sort: ShelfSort,
	score: (row: T) => number
): T[] {
	const sorted = [...rows];
	if (sort === 'title') {
		return sorted.sort((a, b) => a.title.localeCompare(b.title));
	}
	if (sort === 'added') {
		return sorted.sort((a, b) => {
			const difference = Date.parse(b.created_at) - Date.parse(a.created_at);
			if (Number.isFinite(difference) && difference !== 0) return difference;
			return a.title.localeCompare(b.title);
		});
	}
	return sorted.sort((a, b) => {
		const difference = score(b) - score(a);
		if (difference !== 0) return difference;
		return a.title.localeCompare(b.title);
	});
}
