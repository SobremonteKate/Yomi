export interface SharedShelfRow {
	title: string;
	cover_url?: string | null;
	total_chapters?: number | null;
	description?: string | null;
}

/** Titles compare the way a reader would: case, padding and extra spaces don't matter. */
export function shelfTitleKey(title: string): string {
	return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A shared shelf can be saved without turning into duplicates. Rows already on
 * the shelf, or repeated inside the snapshot, are skipped.
 */
export function newSharedRows<T extends SharedShelfRow>(
	rows: T[],
	existingTitles: Iterable<string>
): T[] {
	const seen = new Set<string>();
	for (const title of existingTitles) seen.add(shelfTitleKey(title));
	const fresh: T[] = [];
	for (const row of rows) {
		const key = shelfTitleKey(row.title ?? '');
		if (!key || seen.has(key)) continue;
		seen.add(key);
		fresh.push(row);
	}
	return fresh;
}
