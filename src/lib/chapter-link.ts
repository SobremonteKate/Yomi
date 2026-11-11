/**
 * Chapter pages are the one thing Yomi cannot ask a site for: there is no
 * catalogue endpoint, only the URL the reader last saved. When that URL names
 * the chapter, the next page is a number away, so the shelf can link straight
 * to it instead of sending the reader hunting through the series page.
 */
export function chapterUrlAfter(url: string, from: number, to: number): string | null {
	if (!url || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
	const fromText = chapterNumberText(from);
	const toText = chapterNumberText(to);
	const escaped = fromText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// Ordered from most explicit to least: a bare last path segment is the only
	// one that can plausibly collide with a series id, so it is tried last.
	const patterns = [
		new RegExp(`((?:chapter|chap|ch)[-_/ ]?)(${escaped})(?=$|[^0-9.])`, 'i'),
		new RegExp(`((?:/(?:chapters?|episodes?|eps?|c)[-_/]?))(${escaped})(?=$|[/?#])`, 'i'),
		new RegExp(`(/)(${escaped})(?=$|[/?#])`)
	];
	for (const pattern of patterns) {
		if (pattern.test(url)) {
			return url.replace(pattern, (_match, prefix: string) => `${prefix}${toText}`);
		}
	}
	return null;
}

/** 149 stays 149; 42.50 becomes 42.5, not 42.50000000001. */
function chapterNumberText(value: number): string {
	return String(Math.round(value * 100) / 100);
}
