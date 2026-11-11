import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneSelection, toggleSelection } from '../src/lib/selection.ts';

const ids = ['a', 'b', 'c', 'd', 'e'];

test('a click toggles one row and keeps shelf order', () => {
	assert.deepEqual(toggleSelection([], ids, 'c'), ['c']);
	assert.deepEqual(toggleSelection(['c'], ids, 'c'), []);
	assert.deepEqual(toggleSelection(['e'], ids, 'b'), ['b', 'e']);
});

test('a shift-click adds the range from the anchor, in either direction', () => {
	assert.deepEqual(toggleSelection(['b'], ids, 'd', 'b'), ['b', 'c', 'd']);
	assert.deepEqual(toggleSelection(['d'], ids, 'b', 'd'), ['b', 'c', 'd']);
});

test('a shift-click adds to an existing selection instead of replacing it', () => {
	assert.deepEqual(toggleSelection(['a', 'c'], ids, 'e', 'c'), ['a', 'c', 'd', 'e']);
});

test('a stale anchor falls back to a plain toggle', () => {
	assert.deepEqual(toggleSelection(['a'], ids, 'd', 'gone'), ['a', 'd']);
});

test('an unknown id changes nothing', () => {
	assert.deepEqual(toggleSelection(['a'], ids, 'zz'), ['a']);
});

test('ids that left the shelf are pruned', () => {
	assert.deepEqual(pruneSelection(['a', 'gone', 'c'], ids), ['a', 'c']);
	const selection = ['a', 'c'];
	// Unchanged selections keep their identity, so derived values settle.
	assert.equal(pruneSelection(selection, ids), selection);
});
