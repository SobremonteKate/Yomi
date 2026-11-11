import test from 'node:test';
import assert from 'node:assert/strict';
import {
	filterShelf,
	searchTokens,
	seriesMatches,
	sortShelf
} from '../src/lib/shelf.ts';

const row = (overrides: Record<string, unknown> = {}) =>
	({
		id: 's1',
		title: 'Chainsaw Man',
		alt_titles: [] as string[],
		description: '',
		status: 'reading',
		needs_review: false,
		created_at: '2026-01-01T00:00:00.000Z',
		...overrides
	}) as never;

test('search matches every token across title, alt titles and synopsis', () => {
	const series = row({ description: 'A boy and his chainsaw devil.' });
	assert.equal(seriesMatches(series, 'chainsaw'), true);
	assert.equal(seriesMatches(series, 'chainsaw devil'), true);
	assert.equal(seriesMatches(series, 'devil chainsaw'), true);
	assert.equal(seriesMatches(series, 'devil makima'), false);
	assert.equal(seriesMatches(series, ''), true);
});

test('accents and punctuation do not hide a row', () => {
	const series = row({ title: 'Okonogi-san’s Café' });
	assert.equal(seriesMatches(series, 'cafe'), true);
	assert.equal(seriesMatches(series, 'OKONOGI'), true);
});

test('page titles from captures are searchable too', () => {
	const series = row({ title: 'vg2' });
	assert.equal(seriesMatches(series, 'verify guard', ['Verify Guard Ch. 2 - Comix']), true);
	assert.equal(seriesMatches(series, 'verify guard'), false);
});

test('the review filter is its own shelf, independent of status', () => {
	const rows = [
		row({ id: 'a', needs_review: true, status: 'reading' }),
		row({ id: 'b', needs_review: false, status: 'reading' }),
		row({ id: 'c', needs_review: true, status: 'plan_to_read' })
	];
	assert.deepEqual(
		filterShelf(rows, 'review').map((item) => item.id),
		['a', 'c']
	);
	assert.deepEqual(
		filterShelf(rows, 'reading').map((item) => item.id),
		['a', 'b']
	);
	assert.equal(filterShelf(rows, 'all').length, 3);
});

test('sort by recency uses the supplied per-row score, then title', () => {
	const rows = [
		row({ id: 'a', title: 'Berserk' }),
		row({ id: 'b', title: 'Act-Age' }),
		row({ id: 'c', title: 'Claymore' })
	];
	const scores: Record<string, number> = { a: 30, b: 30, c: 10 };
	const sorted = sortShelf(rows, 'recent', (item) => scores[item.id] ?? 0);
	assert.deepEqual(
		sorted.map((item) => item.id),
		['b', 'a', 'c']
	);
});

test('sort by title ignores case and sort by added goes newest first', () => {
	const rows = [
		row({ id: 'a', title: 'berserk', created_at: '2026-01-01T00:00:00.000Z' }),
		row({ id: 'b', title: 'Act-Age', created_at: '2026-03-01T00:00:00.000Z' }),
		row({ id: 'c', title: 'Claymore', created_at: '2026-02-01T00:00:00.000Z' })
	];
	assert.deepEqual(
		sortShelf(rows, 'title', () => 0).map((item) => item.title),
		['Act-Age', 'berserk', 'Claymore']
	);
	assert.deepEqual(
		sortShelf(rows, 'added', () => 0).map((item) => item.id),
		['b', 'c', 'a']
	);
});

test('tokenising drops empty space instead of matching everything', () => {
	assert.deepEqual(searchTokens('   '), []);
});
