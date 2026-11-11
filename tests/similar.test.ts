import test from 'node:test';
import assert from 'node:assert/strict';
import { findSimilarSeries, titleSimilarity } from '../src/lib/similar.ts';

test('the same title under punctuation, case or an article is one series', () => {
	assert.equal(titleSimilarity('Solo Leveling', 'solo leveling'), 1);
	assert.equal(titleSimilarity('Solo Leveling', 'SOLO-LEVELING!'), 1);
	assert.ok(titleSimilarity('The Beginning After the End', 'Beginning After the End') >= 0.62);
});

test('site noise words do not make a different series', () => {
	assert.ok(titleSimilarity('Chainsaw Man (Official)', 'Chainsaw Man') === 1);
	assert.ok(titleSimilarity('Chainsaw Man Manhwa', 'Chainsaw Man') === 1);
});

test('a sequel sharing a name is offered, but a different series is not', () => {
	assert.ok(titleSimilarity('Solo Leveling: Ragnarok', 'Solo Leveling') > 0.6);
	assert.ok(titleSimilarity('Berserk', 'Chainsaw Man') < 0.3);
});

test('alt titles are enough to spot a duplicate', () => {
	const rows = [
		{ id: 'a', title: 'vg2', alt_titles: ['Verify Guard'] },
		{ id: 'b', title: 'Berserk', alt_titles: [] }
	];
	assert.deepEqual(
		findSimilarSeries('Verify Guard', rows).map((row) => row.id),
		['a']
	);
});

test('suggestions are ordered by confidence and cap at the caller', () => {
	const rows = [
		{ id: 'loose', title: 'Solo Leveling: Ragnarok', alt_titles: [] },
		{ id: 'exact', title: 'Solo Leveling', alt_titles: [] }
	];
	assert.deepEqual(
		findSimilarSeries('solo leveling', rows).map((row) => row.id),
		['exact', 'loose']
	);
});

test('a two-letter stub never suggests the whole shelf', () => {
	const rows = [{ id: 'a', title: 'Berserk', alt_titles: [] }];
	assert.deepEqual(findSimilarSeries('Be', rows), []);
});
