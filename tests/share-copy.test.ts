import test from 'node:test';
import assert from 'node:assert/strict';
import { newSharedRows, shelfTitleKey } from '../src/lib/share-copy.ts';

const row = (title: string) => ({ title });

test('a shared shelf skips titles the reader already has', () => {
	const fresh = newSharedRows(
		[row('Dandadan'), row('Chainsaw Man'), row('Sakamoto Days')],
		['chainsaw man']
	);
	assert.deepEqual(
		fresh.map((item) => item.title),
		['Dandadan', 'Sakamoto Days']
	);
});

test('case, padding and repeated spaces do not create duplicates', () => {
	assert.equal(shelfTitleKey('  Chainsaw   Man '), 'chainsaw man');
	const fresh = newSharedRows([row('One Piece'), row(' one   piece '), row('One Punch Man')], []);
	assert.deepEqual(
		fresh.map((item) => item.title),
		['One Piece', 'One Punch Man']
	);
});

test('repeated titles inside the snapshot only save once', () => {
	const fresh = newSharedRows([row('Dandadan'), row('Dandadan')], []);
	assert.equal(fresh.length, 1);
});

test('an untitled row is never saved', () => {
	const fresh = newSharedRows([row('   '), row('Dandadan')], []);
	assert.deepEqual(
		fresh.map((item) => item.title),
		['Dandadan']
	);
});
