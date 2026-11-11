import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterUrlAfter } from '../src/lib/chapter-link.ts';

test('a chapter URL advances one number and keeps the rest of the address', () => {
	assert.equal(
		chapterUrlAfter('https://comix.to/title/abc/chapter-149?style=page', 149, 150),
		'https://comix.to/title/abc/chapter-150?style=page'
	);
	assert.equal(
		chapterUrlAfter('https://mangadot.net/manga/x/chapter/42/', 42, 43),
		'https://mangadot.net/manga/x/chapter/43/'
	);
});

test('decimal chapters and alternate chapter prefixes work', () => {
	assert.equal(
		chapterUrlAfter('https://example.test/series/ch-42.5', 42.5, 43),
		'https://example.test/series/ch-43'
	);
	assert.equal(
		chapterUrlAfter('https://example.test/series/chapters/12', 12, 13),
		'https://example.test/series/chapters/13'
	);
});

test('a bare final path segment is a chapter page', () => {
	assert.equal(
		chapterUrlAfter('https://example.test/read/thing/88', 88, 89),
		'https://example.test/read/thing/89'
	);
});

test('the number has to be a whole token, not part of a longer id', () => {
	assert.equal(chapterUrlAfter('https://example.test/chapter-1490', 149, 150), null);
	assert.equal(chapterUrlAfter('https://example.test/manga/thing-149-extra/1492', 149, 150), null);
});

test('a series page with no chapter number cannot be advanced', () => {
	assert.equal(chapterUrlAfter('https://example.test/manga/some-title', 40, 41), null);
	assert.equal(chapterUrlAfter('', 40, 41), null);
});

test('a backwards or equal chapter is refused', () => {
	assert.equal(chapterUrlAfter('https://example.test/chapter-10', 10, 10), null);
	assert.equal(chapterUrlAfter('https://example.test/chapter-10', 10, 9), null);
	assert.equal(chapterUrlAfter('https://example.test/chapter-10', Number.NaN, 11), null);
});
