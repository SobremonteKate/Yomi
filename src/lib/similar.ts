/**
 * "You may already own this" — the check that runs while a URL is being added.
 *
 * Duplicates appear when the same series arrives under two slugs or two sites,
 * so a title that merely differs in punctuation, casing, a leading article or a
 * trailing "(Official)" must not become a second row. The score is deliberately
 * conservative: a suggestion costs one tap, a wrong merge loses history.
 */

const NOISE = new Set([
	'the',
	'a',
	'an',
	'and',
	'of',
	'to',
	'in',
	'on',
	'manhwa',
	'manhua',
	'manga',
	'webtoon',
	'comic',
	'official',
	'english',
	'read',
	'reading',
	'online'
]);

function normalize(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function titleKey(value: string): string {
	return normalize(value).replace(/\s+/g, '');
}

export function titleTokens(value: string): string[] {
	return normalize(value)
		.split(' ')
		.filter((token) => token.length > 1 && !NOISE.has(token));
}

/** 0–1: 1 means the two titles are the same series under any spelling. */
export function titleSimilarity(a: string, b: string): number {
	const keyA = titleKey(a);
	const keyB = titleKey(b);
	if (!keyA || !keyB) return 0;
	if (keyA === keyB) return 1;

	const tokensA = new Set(titleTokens(a));
	const tokensB = new Set(titleTokens(b));
	if (tokensA.size === 0 || tokensB.size === 0) {
		// Both names are noise words only; fall back to the compact key.
		return keyA.includes(keyB) || keyB.includes(keyA) ? 0.9 : 0;
	}

	let shared = 0;
	for (const token of tokensA) if (tokensB.has(token)) shared += 1;
	if (shared === 0) return 0;

	const union = tokensA.size + tokensB.size - shared;
	const jaccard = shared / union;
	// One title fully contains the other's words ("Solo Leveling" vs
	// "Solo Leveling: Ragnarok") is a useful hint, but only when the shorter
	// name is most of the longer one.
	const smaller = Math.min(tokensA.size, tokensB.size);
	const containment = shared === smaller ? shared / Math.max(tokensA.size, tokensB.size) : 0;
	return Math.max(jaccard, containment);
}

export interface TitledRow {
	title: string;
	alt_titles?: string[];
}

/**
 * Rows worth offering when a title is about to become a new series. Only scores
 * above the threshold qualify; an exact key always does.
 */
export function findSimilarSeries<T extends TitledRow>(
	title: string,
	candidates: T[],
	threshold = 0.62
): T[] {
	const wanted = title.trim();
	if (titleKey(wanted).length < 3) return [];
	const scored: { row: T; score: number }[] = [];
	for (const row of candidates) {
		const names = [row.title, ...(row.alt_titles ?? [])].filter(Boolean);
		let score = 0;
		for (const name of names) score = Math.max(score, titleSimilarity(wanted, name));
		if (score >= threshold) scored.push({ row, score });
	}
	return scored.sort((a, b) => b.score - a.score).map((entry) => entry.row);
}
