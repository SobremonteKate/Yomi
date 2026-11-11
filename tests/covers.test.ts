import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Source } from '../shared/model.ts';
import { cleanDescription, coverSearchTerms, pickCover, pickMeta } from '../src/lib/covers.ts';

const stamp = { t: '2026-11-04T00:00:00.000Z', d: 'test' };

function source(overrides: Partial<Source>): Source {
	return {
		id: 'src-1',
		series_id: 'series-1',
		site: 'comix',
		url: 'https://comix.to/title/verify-guard/chapter-2',
		normalized_path: 'comix.to/title/verify-guard/chapter-2',
		site_title: '',
		adapter_version: 'comix-1',
		first_seen_at: stamp.t,
		last_seen_at: stamp.t,
		updated_at: stamp.t,
		device_id: 'test',
		deleted_at: null,
		field_ts: {},
		...overrides
	};
}

test('page titles become a search term the catalogue can answer', () => {
	// The slug is a placeholder; only the page title names the series.
	const terms = coverSearchTerms(
		{ title: 'vg2', alt_titles: [] },
		[source({ site_title: 'Verify Guard Ch. 2 - Comix' })]
	);

	assert.equal(terms[0], 'vg2');
	assert.ok(terms.includes('Verify Guard'), `expected a cleaned page title, got ${terms.join(' | ')}`);
	assert.ok(!terms.some((term) => /comix/i.test(term)), 'site boilerplate should be stripped');
});

test('the series title stays first so the name you gave it wins', () => {
	const terms = coverSearchTerms(
		{ title: 'Chainsaw Man', alt_titles: ['Chainsawman'] },
		[source({ site_title: 'Chainsaw Man Chapter 149 - Comix' })]
	);

	assert.deepEqual(terms[0], 'Chainsaw Man');
	assert.equal(terms.length, 2, `duplicates should collapse, got ${terms.join(' | ')}`);
	assert.equal(terms[1], 'Chainsawman');
});

test('alt titles are used when a page title is missing', () => {
	const terms = coverSearchTerms(
		{ title: 'rq9g containment zone management', alt_titles: ['Containment Zone Management'] },
		[source({ site_title: '' })]
	);

	assert.equal(terms.length, 2);
	assert.equal(terms[1], 'Containment Zone Management');
});

test('a longer page title still matches the catalogue title', () => {
	const media = [
		{
			title: { romaji: 'Chainsaw Man', english: 'Chainsaw Man' },
			coverImage: { large: 'https://s4.anilist.co/cover.png' }
		}
	];

	assert.equal(
		pickCover(media, 'Chainsaw Man Chapter 149 - Comix'),
		'https://s4.anilist.co/cover.png'
	);
});

test('a different series is not accepted just because it shares words', () => {
	const media = [
		{
			title: { romaji: 'Chainsaw Man: Buddy Stories', english: 'Chainsaw Man: Buddy Stories' },
			coverImage: { large: 'https://s4.anilist.co/other.png' }
		}
	];

	assert.equal(pickCover(media, 'Chainsaw Man'), null);
});

test('the catalogue total comes from the same matched entry as the cover', () => {
	const media = [
		{
			title: { romaji: 'Otr of the Flame' },
			coverImage: { large: 'https://s4.anilist.co/otr.png' },
			chapters: 34.7,
			status: 'FINISHED'
		}
	];

	const meta = pickMeta(media, 'Otr of the Flame Chapter 34 - MangaDot');
	assert.equal(meta.cover, 'https://s4.anilist.co/otr.png');
	assert.equal(meta.chapters, 34);
	assert.equal(meta.status, 'FINISHED');
});

test('a releasing series reports no total instead of a guess', () => {
	const media = [
		{
			title: { romaji: 'Chainsaw Man' },
			coverImage: { large: 'https://s4.anilist.co/csm.png' },
			chapters: null,
			status: 'RELEASING'
		}
	];

	const meta = pickMeta(media, 'Chainsaw Man');
	assert.equal(meta.cover, 'https://s4.anilist.co/csm.png');
	assert.equal(meta.chapters, null);
});

test('a similarly named series never supplies the total', () => {
	const media = [
		{ title: { romaji: 'Chainsaw Man: Buddy Stories' }, chapters: 5, status: 'FINISHED' }
	];

	assert.equal(pickMeta(media, 'Chainsaw Man').chapters, null);
});

test('the synopsis belongs to the same entry as the cover', () => {
	const media = [
		{
			title: { romaji: 'Otr of the Flame' },
			coverImage: { large: 'https://s4.anilist.co/otr.png' },
			description: 'The real blurb.'
		},
		{
			title: { romaji: 'Otr of the Flame: Side Story' },
			coverImage: { large: 'https://s4.anilist.co/side.png' },
			description: 'A different series entirely.'
		}
	];

	const meta = pickMeta(media, 'Otr of the Flame');
	assert.equal(meta.cover, 'https://s4.anilist.co/otr.png');
	assert.equal(meta.description, 'The real blurb.');
});

test('a catalogue synopsis is flattened to plain text', () => {
	const text = cleanDescription(
		'A boy &amp; his <i>chainsaw</i>.<br><br>He hunts <b>devils</b>.&nbsp;<script>x</script>'
	);
	assert.equal(text, 'A boy & his chainsaw.\n\nHe hunts devils. x');
	assert.equal(cleanDescription('   '), null);
	assert.equal(cleanDescription(null), null);
});
