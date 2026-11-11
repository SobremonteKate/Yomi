/**
 * Multi-select for the shelf.
 *
 * The range rules are the part that is easy to get subtly wrong, so they live
 * here rather than in the component and are covered by tests.
 */

/** Drops ids that are no longer on the shelf, keeping shelf order. */
export function pruneSelection(selection: string[], ids: string[]): string[] {
	const live = new Set(ids);
	const kept = selection.filter((id) => live.has(id));
	// Keep the array identity when nothing was pruned: a derived value should not
	// look changed on every re-read.
	return kept.length === selection.length ? selection : kept;
}

/**
 * One click toggles a row. A shift-click adds every row between the last
 * clicked one and this one, so a run of twenty is two clicks instead of twenty.
 */
export function toggleSelection(
	selection: string[],
	ids: string[],
	id: string,
	anchor: string | null = null
): string[] {
	const index = ids.indexOf(id);
	if (index === -1) return selection;

	if (anchor && anchor !== id) {
		const from = ids.indexOf(anchor);
		if (from !== -1) {
			const start = Math.min(from, index);
			const end = Math.max(from, index);
			const chosen = new Set(selection);
			for (const item of ids.slice(start, end + 1)) chosen.add(item);
			return ids.filter((item) => chosen.has(item));
		}
	}

	if (selection.includes(id)) return selection.filter((item) => item !== id);
	const chosen = new Set(selection);
	chosen.add(id);
	return ids.filter((item) => chosen.has(item));
}
