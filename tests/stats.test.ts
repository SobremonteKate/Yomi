import test from 'node:test';
import assert from 'node:assert/strict';
import { newEvent, newSeries } from '../shared/merge.ts';
import type { MergeRecord, ProgressEvent, Series } from '../shared/model.ts';
import { buildStats } from '../src/lib/stats.ts';

const NOW = new Date('2026-03-15T12:00:00.000Z');

function series(id: string, overrides: Partial<Series> = {}): Series {
	return {
		...newSeries('device-a', { title: `Series ${id}`, status: 'reading' }, new Date('2026-01-01T00:00:00Z'), id),
		...overrides
	};
}

function event(id: string, seriesId: string, chapter: number, readAt: string): ProgressEvent {
	return newEvent(
		'device-a',
		{ series_id: seriesId, source_id: 'source-1', chapter, method: 'manual', read_at: readAt },
		new Date(readAt),
		id
	);
}

test('counts live chapters only and ignores tombstoned rows', () => {
	const rows = [series('a'), series('b'), series('gone', { deleted_at: '2026-03-01T00:00:00Z' })];
	const events = [
		event('e1', 'a', 1, '2026-03-15T09:00:00Z'),
		event('e2', 'a', 2, '2026-03-14T09:00:00Z'),
		event('e3', 'b', 1, '2026-02-10T09:00:00Z'),
		event('e4', 'gone', 1, '2026-03-12T09:00:00Z'),
		{ ...event('e5', 'a', 3, '2026-03-13T09:00:00Z'), deleted_at: '2026-03-13T10:00:00Z' }
	];
	const stats = buildStats(rows, events, [], NOW);
	assert.equal(stats.chapters, 3);
	assert.equal(stats.seriesTracked, 2);
	assert.equal(stats.thisMonth.chapters, 2);
	assert.equal(stats.thisMonth.seriesTouched, 1);
});

test('an absorbed merge target stops counting its chapters', () => {
	const rows = [series('keep'), series('absorbed')];
	const events = [event('e1', 'keep', 1, '2026-03-15T09:00:00Z'), event('e2', 'absorbed', 1, '2026-03-15T10:00:00Z')];
	const merge: MergeRecord = {
		id: 'm1',
		from_series_id: 'absorbed',
		to_series_id: 'keep',
		moved_source_ids: [],
		created_at: '2026-03-01T00:00:00Z',
		device_id: 'device-a',
		undone_at: null,
		updated_at: '2026-03-01T00:00:00Z'
	};
	assert.equal(buildStats(rows, events, [merge], NOW).chapters, 1);
	// Undoing the merge brings the chapter back into the count.
	assert.equal(buildStats(rows, events, [{ ...merge, undone_at: '2026-03-02T00:00:00Z' }], NOW).chapters, 2);
});

test('a streak counts back from today, or from yesterday if today is quiet', () => {
	const rows = [series('a')];
	const events = [
		event('e1', 'a', 1, '2026-03-15T09:00:00Z'),
		event('e2', 'a', 2, '2026-03-14T09:00:00Z'),
		event('e3', 'a', 3, '2026-03-13T09:00:00Z'),
		event('e4', 'a', 4, '2026-03-11T09:00:00Z')
	];
	assert.equal(buildStats(rows, events, [], NOW).streak, 3);
	assert.equal(buildStats(rows, events.slice(1), [], NOW).streak, 2);
	// A gap at both today and yesterday ends the streak at zero.
	assert.equal(buildStats(rows, [events[3]], [], NOW).streak, 0);
});

test('the monthly recap names the busiest series and the best day', () => {
	const rows = [series('a', { title: 'Chainsaw Man' }), series('b', { title: 'Dandadan' })];
	const events = [
		event('e1', 'a', 1, '2026-03-02T09:00:00Z'),
		event('e2', 'a', 2, '2026-03-02T10:00:00Z'),
		event('e3', 'a', 3, '2026-03-03T09:00:00Z'),
		event('e4', 'b', 1, '2026-03-05T09:00:00Z')
	];
	const month = buildStats(rows, events, [], NOW).thisMonth;
	assert.equal(month.chapters, 4);
	assert.equal(month.daysActive, 3);
	assert.equal(month.topSeries?.series.title, 'Chainsaw Man');
	assert.equal(month.topSeries?.chapters, 3);
	assert.equal(buildStats(rows, events, [], NOW).bestDay?.chapters, 2);
});

test('six months are always listed, newest first, including empty ones', () => {
	const stats = buildStats([series('a')], [event('e1', 'a', 1, '2026-03-15T09:00:00Z')], [], NOW);
	assert.equal(stats.months.length, 6);
	assert.equal(stats.months[0].key, '2026-03');
	assert.equal(stats.months[5].key, '2025-10');
	assert.equal(stats.months[4].chapters, 0);
});

test('ratings, tags and completed rows feed the summary', () => {
	const rows = [
		series('a', { rating: 9, tags: ['isekai'], status: 'completed' }),
		series('b', { rating: 7, tags: ['isekai', 'romance'] }),
		series('c', { tags: ['romance'] })
	];
	const stats = buildStats(rows, [event('e1', 'a', 1, '2026-03-15T09:00:00Z')], [], NOW);
	assert.equal(stats.rated, 2);
	assert.equal(stats.averageRating, 8);
	assert.equal(stats.seriesCompleted, 1);
	assert.deepEqual(stats.topTags[0], { tag: 'isekai', count: 2 });
	assert.equal(stats.topTags.length, 2);
});
