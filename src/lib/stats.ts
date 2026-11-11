import { absorbedSeriesIds, seriesStats } from '../../shared/merge.ts';
import type { MergeRecord, ProgressEvent, Series } from '../../shared/model.ts';

export interface MonthSummary {
	/** YYYY-MM, sortable and unique. */
	key: string;
	label: string;
	chapters: number;
	seriesTouched: number;
	daysActive: number;
	/** The series that took the most chapters this month. */
	topSeries: { series: Series; chapters: number } | null;
}

export interface ReadingStats {
	chapters: number;
	seriesTracked: number;
	seriesCompleted: number;
	rated: number;
	averageRating: number | null;
	/** Consecutive days with at least one chapter, ending today or yesterday. */
	streak: number;
	bestDay: { day: string; chapters: number } | null;
	busiestWeekday: string | null;
	/** Newest first, six entries, including months with no reading. */
	months: MonthSummary[];
	thisMonth: MonthSummary;
	topTags: { tag: string; count: number }[];
}

function dayKey(iso: string): string {
	const date = new Date(iso);
	if (!Number.isFinite(date.getTime())) return '';
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
		date.getDate()
	).padStart(2, '0')}`;
}

function monthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date: Date): string {
	return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function monthOf(key: string): Date {
	const [year, month] = key.split('-').map(Number);
	return new Date(year, (month ?? 1) - 1, 1);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Everything the stats screen shows, computed from the local log only.
 * Tombstoned series and merges are honoured, so a tidied shelf does not report
 * chapters against a row you folded away.
 */
export function buildStats(
	series: Series[],
	events: ProgressEvent[],
	merges: MergeRecord[],
	now = new Date()
): ReadingStats {
	const absorbed = absorbedSeriesIds(merges);
	const liveSeries = series.filter((row) => !row.deleted_at && !absorbed.has(row.id));
	const byId = new Map(liveSeries.map((row) => [row.id, row]));
	const liveEvents = events.filter(
		(event) => !event.deleted_at && byId.has(event.series_id)
	);

	const byMonth = new Map<string, ProgressEvent[]>();
	const byDay = new Map<string, number>();
	const weekdayCounts = new Array(7).fill(0) as number[];
	for (const event of liveEvents) {
		const day = dayKey(event.read_at);
		if (!day) continue;
		byDay.set(day, (byDay.get(day) ?? 0) + 1);
		weekdayCounts[new Date(event.read_at).getDay()] += 1;
		const month = day.slice(0, 7);
		const list = byMonth.get(month);
		if (list) list.push(event);
		else byMonth.set(month, [event]);
	}

	const monthKeys: string[] = [];
	for (let offset = 0; offset < 6; offset += 1) {
		const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
		monthKeys.push(monthKey(date));
	}

	const months: MonthSummary[] = monthKeys.map((key) => {
		const list = byMonth.get(key) ?? [];
		const perSeries = new Map<string, number>();
		const days = new Set<string>();
		for (const event of list) {
			perSeries.set(event.series_id, (perSeries.get(event.series_id) ?? 0) + 1);
			days.add(dayKey(event.read_at));
		}
		let top: { series: Series; chapters: number } | null = null;
		for (const [id, chapters] of perSeries) {
			const row = byId.get(id);
			if (!row) continue;
			if (!top || chapters > top.chapters) top = { series: row, chapters };
		}
		return {
			key,
			label: monthLabel(monthOf(key)),
			chapters: list.length,
			seriesTouched: perSeries.size,
			daysActive: days.size,
			topSeries: top
		};
	});

	let bestDay: { day: string; chapters: number } | null = null;
	for (const [day, count] of byDay) {
		if (!bestDay || count > bestDay.chapters) bestDay = { day, chapters: count };
	}

	let streak = 0;
	const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	if (!byDay.has(dayKey(cursor.toISOString()))) {
		cursor.setDate(cursor.getDate() - 1);
		if (!byDay.has(dayKey(cursor.toISOString()))) {
			cursor.setTime(Number.NaN);
		}
	}
	while (!Number.isNaN(cursor.getTime()) && byDay.has(dayKey(cursor.toISOString()))) {
		streak += 1;
		cursor.setDate(cursor.getDate() - 1);
	}

	const weekdaysRead = weekdayCounts.some((count) => count > 0);
	const busiestWeekday = weekdaysRead
		? WEEKDAYS[weekdayCounts.indexOf(Math.max(...weekdayCounts))]
		: null;

	const rated = liveSeries.filter((row) => row.rating !== null && row.rating !== undefined);
	const averageRating =
		rated.length > 0
			? Math.round(
					(rated.reduce((sum, row) => sum + (row.rating ?? 0), 0) / rated.length) * 10
				) / 10
			: null;

	const tagCounts = new Map<string, number>();
	for (const row of liveSeries) {
		for (const tag of row.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
	}
	const topTags = [...tagCounts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
		.slice(0, 8);

	return {
		chapters: liveEvents.length,
		seriesTracked: liveSeries.length,
		seriesCompleted: liveSeries.filter((row) => row.status === 'completed').length,
		rated: rated.length,
		averageRating,
		streak,
		bestDay,
		busiestWeekday,
		months,
		thisMonth: months[0],
		topTags
	};
}

/** One series' own reading pace, for the series page. */
export function seriesPaceText(series: Series, events: ProgressEvent[]): string {
	const stats = seriesStats(series, events);
	if (stats.chapterCount === 0) return 'No chapters logged yet';
	const days = new Set(events.filter((e) => !e.deleted_at).map((e) => dayKey(e.read_at)));
	if (days.size <= 1) return `${stats.chapterCount} ${stats.chapterCount === 1 ? 'chapter' : 'chapters'} in one sitting`;
	const average = Math.round((stats.chapterCount / days.size) * 10) / 10;
	return `${average} ${average === 1 ? 'chapter' : 'chapters'} per reading day`;
}
