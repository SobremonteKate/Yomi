import test from 'node:test';
import assert from 'node:assert/strict';
import {
	compareStamps,
	mergeEvent,
	mergeSeries,
	mergeSource,
	newEvent,
	newSeries,
	newSource,
	raiseChapterTotal,
	sameStamps,
	seriesStats
} from '../shared/merge.ts';
import type { ProgressEvent, Series, Source } from '../shared/model.ts';

function iso(minute: number): string {
	return new Date(Date.UTC(2026, 0, 1, 10, minute, 0)).toISOString();
}

function baseSeries(): Series {
	return newSeries('device-a', { title: 'Original Title', notes: 'old note', status: 'reading' }, new Date(iso(0)), 'series-1');
}

test('per-field last write wins without clobbering other fields', () => {
	const base = baseSeries();
	const incoming: Series = {
		...base,
		notes: 'new note',
		updated_at: iso(5),
		device_id: 'device-b',
		field_ts: { ...base.field_ts, notes: { t: iso(5), d: 'device-b' } }
	};
	const merged = mergeSeries(base, incoming);
	assert.equal(merged.notes, 'new note');
	assert.equal(merged.title, 'Original Title');
	assert.equal(merged.status, 'reading');
});

test('an older edit cannot overwrite a newer one', () => {
	const base: Series = {
		...baseSeries(),
		notes: 'newer',
		updated_at: iso(5),
		field_ts: { ...baseSeries().field_ts, notes: { t: iso(5), d: 'device-a' } }
	};
	const stale: Series = {
		...base,
		notes: 'stale',
		updated_at: iso(2),
		device_id: 'device-b',
		field_ts: { ...base.field_ts, notes: { t: iso(2), d: 'device-b' } }
	};
	const merged = mergeSeries(base, stale);
	assert.equal(merged.notes, 'newer');
});

test('within a second, device id makes the result deterministic', () => {
	const early = { t: '2026-01-01T10:00:00.000Z', d: 'device-a' };
	const lateSameSecond = { t: '2026-01-01T10:00:00.300Z', d: 'device-b' };
	assert.equal(compareStamps(lateSameSecond, early), 1);
	assert.equal(compareStamps(early, lateSameSecond), -1);
	assert.equal(compareStamps(early, early), 0);
});

test('tombstones beat older edits and can be explicitly restored', () => {
	const base = baseSeries();
	const tombstone: Series = {
		...base,
		deleted_at: iso(10),
		updated_at: iso(10),
		device_id: 'device-b',
		field_ts: { ...base.field_ts, deleted_at: { t: iso(10), d: 'device-b' } }
	};
	const deleted = mergeSeries(base, tombstone);
	assert.equal(deleted.deleted_at, iso(10));

	const olderEdit: Series = {
		...deleted,
		title: 'Sneaky rename',
		deleted_at: null,
		updated_at: iso(8),
		field_ts: { ...deleted.field_ts, title: { t: iso(8), d: 'device-c' } }
	};
	const stillDeleted = mergeSeries(deleted, olderEdit);
	assert.equal(stillDeleted.deleted_at, iso(10));
	assert.equal(stillDeleted.title, 'Original Title');

	const restored: Series = {
		...deleted,
		deleted_at: null,
		updated_at: iso(20),
		device_id: 'device-c',
		field_ts: { ...deleted.field_ts, deleted_at: { t: iso(20), d: 'device-c' } }
	};
	assert.equal(mergeSeries(deleted, restored).deleted_at, null);
});

test('progress is the union: furthest chapter survives a re-read', () => {
	const series = baseSeries();
	const first: ProgressEvent = newEvent(
		'device-a',
		{ series_id: series.id, source_id: 'source-1', chapter: 12, method: 'manual', read_at: iso(0) },
		new Date(iso(0)),
		'event-1'
	);
	const furthest: ProgressEvent = newEvent(
		'device-b',
		{ series_id: series.id, source_id: 'source-1', chapter: 42, method: 'plus_one', read_at: iso(3) },
		new Date(iso(3)),
		'event-2'
	);
	const reRead: ProgressEvent = newEvent(
		'device-a',
		{ series_id: series.id, source_id: 'source-1', chapter: 1, method: 'manual', read_at: iso(6) },
		new Date(iso(6)),
		'event-3'
	);
	const stats = seriesStats(series, [first, furthest, reRead]);
	assert.equal(stats.furthest, 42);
	assert.equal(stats.chapterCount, 3);
	assert.equal(stats.nextChapter, 43);
	assert.equal(stats.lastReadAt, iso(6));
});

test('event tombstones and restores are explicit', () => {
	const event = newEvent(
		'device-a',
		{ series_id: 'series-1', source_id: 'source-1', chapter: 42, method: 'plus_one' },
		new Date(iso(0)),
		'event-1'
	);
	const tombstone: ProgressEvent = {
		...event,
		deleted_at: iso(5),
		updated_at: iso(5),
		field_ts: { ...event.field_ts, deleted_at: { t: iso(5), d: 'device-b' } }
	};
	const deleted = mergeEvent(event, tombstone);
	assert.equal(deleted.deleted_at, iso(5));
	assert.equal(mergeEvent(deleted, event).deleted_at, iso(5));

	const restore: ProgressEvent = {
		...deleted,
		deleted_at: null,
		updated_at: iso(8),
		field_ts: { ...deleted.field_ts, deleted_at: { t: iso(8), d: 'device-a' } }
	};
	assert.equal(mergeEvent(deleted, restore).deleted_at, null);
});

test('a source can be repointed at another series', () => {
	const source = newSource(
		'device-a',
		{
			series_id: 'series-1',
			site: 'comix',
			url: 'https://comix.to/title/x/chapter-1',
			normalized_path: 'comix.to/title/x/chapter-1'
		},
		new Date(iso(0)),
		'source-1'
	);
	const moved: Source = {
		...source,
		series_id: 'series-2',
		updated_at: iso(5),
		device_id: 'device-b',
		field_ts: { ...source.field_ts, series_id: { t: iso(5), d: 'device-b' } }
	};
	const merged = mergeSource(source, moved);
	assert.equal(merged.series_id, 'series-2');
	assert.equal(merged.url, source.url);
});

test('a synopsis syncs per field like any other value', () => {
	const base = baseSeries();
	const incoming: Series = {
		...base,
		description: 'A boy and his chainsaw.',
		updated_at: iso(5),
		device_id: 'device-b',
		field_ts: { ...base.field_ts, description: { t: iso(5), d: 'device-b' } }
	};
	assert.equal(mergeSeries(base, incoming).description, 'A boy and his chainsaw.');

	const stale: Series = { ...base, description: 'Older blurb' };
	assert.equal(
		mergeSeries(mergeSeries(base, incoming), stale).description,
		'A boy and his chainsaw.'
	);
});

test('a row from before the synopsis existed still merges', () => {
	const base = baseSeries();
	const legacy = { ...base } as Partial<Series>;
	delete legacy.description;
	assert.equal(mergeSeries(base, legacy as Series).description, '');
});

test('stamp equality ignores object key order', () => {
	const a = { title: { t: iso(0), d: 'a' }, notes: { t: iso(1), d: 'b' } };
	const b = { notes: { t: iso(1), d: 'b' }, title: { t: iso(0), d: 'a' } };
	assert.equal(sameStamps(a, b), true);
	assert.equal(sameStamps(a, { ...a, notes: { t: iso(2), d: 'b' } }), false);
});

test("a site total fills a blank one, so an ongoing series can show 61/72", () => {
	assert.equal(raiseChapterTotal(null, 72, 61), 72);
	assert.equal(raiseChapterTotal(null, 232), 232);
});

test('a site total raises the number as chapters appear but never lowers it', () => {
	assert.equal(raiseChapterTotal(69, 72, 70), 72);
	// A site with fewer chapters than the catalogue's published count must not
	// shrink the bar, and a total you typed stays yours.
	assert.equal(raiseChapterTotal(232, 69, 61), null);
	assert.equal(raiseChapterTotal(100, 72, 61), null);
});

test('a total below the chapter being read is page furniture, not a count', () => {
	assert.equal(raiseChapterTotal(null, 41, 61), null);
	assert.equal(raiseChapterTotal(null, 0), null);
	assert.equal(raiseChapterTotal(null, Number.NaN), null);
});
