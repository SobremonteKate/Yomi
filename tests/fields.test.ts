import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSeries, newSeries } from '../shared/merge.ts';
import { normalizeRating, normalizeTags, type Series } from '../shared/model.ts';

function iso(minute: number): string {
	return new Date(Date.UTC(2026, 0, 1, 10, minute, 0)).toISOString();
}

function baseSeries(): Series {
	return newSeries('device-a', { title: 'Rated Thing' }, new Date(iso(0)), 'series-1');
}

test('a rating and its tags sync per field like any other value', () => {
	const base = baseSeries();
	const incoming: Series = {
		...base,
		rating: 8.5,
		tags: ['isekai', 'slow burn'],
		updated_at: iso(5),
		device_id: 'device-b',
		field_ts: {
			...base.field_ts,
			rating: { t: iso(5), d: 'device-b' },
			tags: { t: iso(5), d: 'device-b' }
		}
	};
	const merged = mergeSeries(base, incoming);
	assert.equal(merged.rating, 8.5);
	assert.deepEqual(merged.tags, ['isekai', 'slow burn']);
	// An unrelated older edit still cannot roll the score back.
	const stale: Series = { ...base, rating: 2, tags: [], updated_at: iso(1) };
	const kept = mergeSeries(merged, stale);
	assert.equal(kept.rating, 8.5);
	assert.deepEqual(kept.tags, ['isekai', 'slow burn']);
});

test('clearing a rating is a real change and syncs', () => {
	const rated = mergeSeries(baseSeries(), {
		...baseSeries(),
		rating: 7,
		updated_at: iso(2),
		field_ts: { ...baseSeries().field_ts, rating: { t: iso(2), d: 'device-a' } }
	});
	const cleared: Series = {
		...rated,
		rating: null,
		updated_at: iso(6),
		field_ts: { ...rated.field_ts, rating: { t: iso(6), d: 'device-b' } }
	};
	assert.equal(mergeSeries(rated, cleared).rating, null);
});

test('rows from before ratings and tags existed decode safely', () => {
	const legacy = { ...baseSeries() } as Partial<Series>;
	delete legacy.rating;
	delete legacy.tags;
	const merged = mergeSeries(undefined, legacy as Series);
	assert.equal(merged.rating, null);
	assert.deepEqual(merged.tags, []);
});

test('a score is kept between 1 and 10, in half points', () => {
	assert.equal(normalizeRating(8.26), 8.5);
	assert.equal(normalizeRating(8.2), 8);
	assert.equal(normalizeRating(42), 10);
	assert.equal(normalizeRating(0), null);
	assert.equal(normalizeRating('7'), 7);
	assert.equal(normalizeRating('not a number'), null);
	assert.equal(normalizeRating(null), null);
});

test('tags are split, lower-cased, de-duplicated and capped', () => {
	assert.deepEqual(normalizeTags('Isekai, #Slow Burn, isekai'), ['isekai', 'slow burn']);
	assert.deepEqual(normalizeTags(['Romance ', 'ROMANCE', '  ']), ['romance']);
	assert.deepEqual(normalizeTags(''), []);
	assert.equal(normalizeTags(Array.from({ length: 30 }, (_, index) => `tag${index}`)).length, 12);
	assert.equal(normalizeTags('x'.repeat(60))[0].length, 32);
});
