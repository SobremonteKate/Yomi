import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReadingList } from '../src/lib/import-list.ts';

const anilist = {
	user: { name: 'reader' },
	lists: [
		{
			name: 'Reading',
			status: 'CURRENT',
			entries: [
				{
					status: 'CURRENT',
					score: 85,
					progress: 42,
					notes: 'good so far',
					media: {
						type: 'MANGA',
						title: { romaji: 'Chensoman', english: 'Chainsaw Man', native: 'チェンソーマン' },
						synonyms: ['CSM'],
						chapters: 97,
						coverImage: { large: 'https://img.example/csm.jpg' },
						tags: [{ name: 'Gore' }, { name: 'Gore' }, { name: 'Action' }]
					}
				},
				{
					status: 'COMPLETED',
					score: 0,
					progress: 12,
					media: {
						type: 'ANIME',
						title: { english: 'Chainsaw Man (TV)' },
						chapters: null
					}
				}
			]
		},
		{
			name: 'Planning',
			entries: [
				{
					status: 'PLANNING',
					score: 0,
					progress: 0,
					media: { type: 'MANGA', title: { romaji: 'Dandadan' }, chapters: null }
				}
			]
		}
	]
};

const mal = `<?xml version="1.0" encoding="UTF-8"?>
<myanimelist>
  <manga>
    <entry>
      <series_mangadb_id>13</series_mangadb_id>
      <series_title><![CDATA[One Piece]]></series_title>
      <my_read_chapters>1080</my_read_chapters>
      <my_score>9</my_score>
      <my_status>Reading</my_status>
      <series_num_chapters>0</series_num_chapters>
      <my_comments>Still going &amp; going</my_comments>
    </entry>
    <entry>
      <series_mangadb_id>2</series_mangadb_id>
      <series_title>Berserk &amp; Friends</series_title>
      <my_read_chapters>0</my_read_chapters>
      <my_score>0</my_score>
      <my_status>Plan to Read</my_status>
      <series_num_chapters>380</series_num_chapters>
    </entry>
  </manga>
  <anime>
    <entry><series_title>Not a manga</series_title></entry>
  </anime>
</myanimelist>`;

test('an AniList export yields only its manga entries', () => {
	const parsed = parseReadingList(JSON.stringify(anilist));
	assert.equal(parsed.source, 'anilist');
	assert.equal(parsed.entries.length, 2);
	assert.equal(parsed.skipped, 1);

	const [first, second] = parsed.entries;
	assert.equal(first.title, 'Chainsaw Man');
	assert.deepEqual(first.altTitles, ['Chensoman', 'チェンソーマン', 'CSM']);
	assert.equal(first.totalChapters, 97);
	assert.equal(first.chaptersRead, 42);
	assert.equal(first.status, 'reading');
	// AniList writes the score in the account's own system: 85/100 is 8.5.
	assert.equal(first.rating, 8.5);
	assert.equal(first.notes, 'good so far');
	assert.equal(first.coverUrl, 'https://img.example/csm.jpg');
	assert.deepEqual(first.tags, ['gore', 'action']);

	assert.equal(second.title, 'Dandadan');
	assert.equal(second.status, 'plan_to_read');
	assert.equal(second.rating, null);
	assert.equal(second.chaptersRead, null);
});

test('a MyAnimeList export reads chapters, scores and statuses', () => {
	const parsed = parseReadingList(mal);
	assert.equal(parsed.source, 'mal');
	assert.equal(parsed.entries.length, 2);
	assert.equal(parsed.skipped, 0);

	const [onePiece, berserk] = parsed.entries;
	assert.equal(onePiece.title, 'One Piece');
	assert.equal(onePiece.chaptersRead, 1080);
	assert.equal(onePiece.rating, 9);
	assert.equal(onePiece.status, 'reading');
	assert.equal(onePiece.notes, 'Still going & going');
	// A zero total means "still publishing", not a total of zero.
	assert.equal(onePiece.totalChapters, null);

	assert.equal(berserk.title, 'Berserk & Friends');
	assert.equal(berserk.status, 'plan_to_read');
	assert.equal(berserk.rating, null);
	assert.equal(berserk.totalChapters, 380);
});

test('a file that is neither export is refused with a readable message', () => {
	assert.throws(() => parseReadingList('hello'), /AniList JSON/);
	assert.throws(() => parseReadingList(''), /empty/);
	assert.throws(() => parseReadingList('<html><body>nope</body></html>'), /MyAnimeList/);
	assert.throws(() => parseReadingList('{"lists":"nope"}'), /no lists/);
});
