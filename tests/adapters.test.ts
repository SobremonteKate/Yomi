import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanComixTitleCode, parseCapture } from '../shared/parse.ts';
import { normalizeUrl, siteFromHost } from '../shared/url.ts';

test('comix chapter page parses title, chapter and site', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/chainsaw-man/chapter-149',
		title: 'Chainsaw Man Chapter 149 | Comix',
		heading: 'Chainsaw Man',
		breadcrumb: 'Home / Manga / Chainsaw Man / Chapter 149'
	});
	assert.ok(parsed);
	assert.equal(parsed.site, 'comix');
	assert.equal(parsed.series_title, 'Chainsaw Man');
	assert.equal(parsed.chapter, 149);
	assert.equal(parsed.chapter_label, 'Chapter 149');
	assert.equal(parsed.confidence, 'high');
	assert.equal(parsed.needs_review, false);
	assert.equal(parsed.adapter_version, 'comix-1');
	assert.equal(parsed.source_url, 'https://comix.to/title/chainsaw-man');
	assert.equal(parsed.normalized_path, 'comix.to/title/chainsaw-man');
});

test('comix internal title code is not part of the series name', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/nr83-the-sword-bearing-flower/11490835-chapter-62'
	});
	assert.ok(parsed);
	assert.equal(parsed.series_title, 'The Sword Bearing Flower');
	assert.equal(parsed.title_source, 'url');
	assert.equal(parsed.chapter, 62);
});

test('a real leading number or short word survives slug cleanup', () => {
	const numbered = parseCapture({ url: 'https://comix.to/title/86-eighty-six/chapter-1' });
	const short = parseCapture({ url: 'https://comix.to/title/7th-time-loop/chapter-1' });
	assert.ok(numbered && short);
	assert.equal(numbered.series_title, '86 Eighty Six');
	assert.equal(short.series_title, '7th Time Loop');
});

test('a numeric Comix slug code is not part of the series name', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/2031-happy-face-from-slave-to-arena-legend/11346568-chapter-76'
	});
	assert.ok(parsed);
	assert.equal(parsed.series_title, 'Happy Face From Slave to Arena Legend');
});

test('an old Comix code title is repaired only when it matches its slug', () => {
	const source = 'https://comix.to/title/nr83-the-sword-bearing-flower/11490835-chapter-62';
	assert.equal(
		cleanComixTitleCode('Nr83 the Sword Bearing Flower', source),
		'The Sword Bearing Flower'
	);
	assert.equal(
		cleanComixTitleCode(
			'2031 Happy Face From Slave to Arena Legend',
			'https://comix.to/title/2031-happy-face-from-slave-to-arena-legend/11346568-chapter-76'
		),
		'Happy Face From Slave to Arena Legend'
	);
	assert.equal(cleanComixTitleCode('Nr83 a title I chose myself', source), null);
	assert.equal(cleanComixTitleCode('The Sword Bearing Flower', source), null);
});

test('cleanup never strips a real numeric title', () => {
	assert.equal(
		cleanComixTitleCode('86 Eighty Six', 'https://comix.to/title/86-eighty-six/chapter-1'),
		null
	);
	assert.equal(
		cleanComixTitleCode('7th Time Loop', 'https://comix.to/title/7th-time-loop/chapter-1'),
		null
	);
	assert.equal(
		cleanComixTitleCode('2099', 'https://comix.to/title/2099/chapter-1'),
		null
	);
});

test('all chapters of one series share one source path', () => {
	const one = parseCapture({
		url: 'https://comix.to/title/chainsaw-man/chapter-148',
		title: 'Chainsaw Man Chapter 148 | Comix'
	});
	const two = parseCapture({
		url: 'https://comix.to/title/chainsaw-man/chapter-149',
		title: 'Chainsaw Man Chapter 149 | Comix'
	});
	assert.ok(one && two);
	assert.equal(one.url, 'https://comix.to/title/chainsaw-man/chapter-148');
	assert.equal(two.url, 'https://comix.to/title/chainsaw-man/chapter-149');
	assert.equal(one.normalized_path, two.normalized_path);
	assert.equal(one.source_url, two.source_url);
});

test('mangadot fractional chapter and volume parse', () => {
	const parsed = parseCapture({
		url: 'https://mangadot.net/manga/solo-leveling/chapter-200.5',
		title: 'Solo Leveling - Chapter 200.5 - MangaDot',
		heading: 'Solo Leveling',
		label: 'Chapter 200.5'
	});
	assert.ok(parsed);
	assert.equal(parsed.site, 'mangadot');
	assert.equal(parsed.series_title, 'Solo Leveling');
	assert.equal(parsed.chapter, 200.5);
	assert.equal(parsed.chapter_label, 'Chapter 200.5');
});

test('mangadot id-only chapter page reads number and name from the title', () => {
	const parsed = parseCapture({
		url: 'https://mangadot.net/chapter/265763',
		title: 'Otr of the Flame — Chapter 34 | MangaDot'
	});
	assert.ok(parsed);
	assert.equal(parsed.site, 'mangadot');
	assert.equal(parsed.chapter, 34);
	assert.equal(parsed.series_title, 'Otr of the Flame');
	assert.equal(parsed.needs_review, false);
	assert.equal(parsed.adapter_version, 'mangadot-2');
	assert.equal(parsed.normalized_path, 'mangadot.net/manga/title/otr-of-the-flame');
});

test('two mangadot id-only chapters share one source row', () => {
	const first = parseCapture({
		url: 'https://mangadot.net/chapter/265763',
		title: 'Otr of the Flame — Chapter 34 | MangaDot'
	});
	const second = parseCapture({
		url: 'https://mangadot.net/chapter/266001',
		title: 'Otr of the Flame — Chapter 35 | MangaDot'
	});
	assert.ok(first && second);
	assert.equal(first.chapter, 34);
	assert.equal(second.chapter, 35);
	assert.equal(first.normalized_path, second.normalized_path);
	assert.equal(first.source_url, 'https://mangadot.net/chapter/265763');
});

test('a mangadot database id is never logged as a chapter number', () => {
	const parsed = parseCapture({ url: 'https://mangadot.net/chapter/265763' });
	assert.ok(parsed);
	assert.equal(parsed.chapter, null);
	assert.equal(parsed.series_title, null);
	assert.equal(parsed.needs_review, true);
});

test('volume and chapter label survive exactly as rendered', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/one-piece/volume-3/chapter-12',
		title: 'One Piece Vol.3 Ch.12 | Comix',
		heading: 'One Piece',
		label: 'Vol.3 Ch.12'
	});
	assert.ok(parsed);
	assert.equal(parsed.series_title, 'One Piece');
	assert.equal(parsed.chapter, 12);
	assert.equal(parsed.volume, 3);
	assert.equal(parsed.chapter_label, 'Vol.3 Ch.12');
});

test('hyphenated decimal chapter url is read as a decimal', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/lookism/chapter-42-5',
		title: 'Chapter 42.5 - Lookism'
	});
	assert.ok(parsed);
	assert.equal(parsed.chapter, 42.5);
	assert.equal(parsed.series_title, 'Lookism');
});

test('url-only capture is marked for review', () => {
	const parsed = parseCapture({
		url: 'https://mangadot.net/manga/one-piece/chapter-1090'
	});
	assert.ok(parsed);
	assert.equal(parsed.series_title, 'One Piece');
	assert.equal(parsed.title_source, 'url');
	assert.equal(parsed.needs_review, true);
});

test('an episode subtitle after the chapter marker is not part of the series name', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/containment-zone-management/chapter-23',
		title: 'Containment Zone Management Episode 23 - The Pool (2) | Comix'
	});
	assert.ok(parsed);
	assert.equal(parsed.series_title, 'Containment Zone Management');
	assert.equal(parsed.chapter, 23);
	assert.equal(parsed.chapter_label, 'Episode 23');
});

test('a title that starts with the chapter marker keeps the series name', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/chainsaw-man/chapter-149',
		title: 'Ch. 149 - Chainsaw Man - Comix'
	});
	assert.ok(parsed);
	assert.equal(parsed.series_title, 'Chainsaw Man');
});

test('a URL sent as the page title is ignored, not used as the series name', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/newthing/chapter-1',
		title: 'https://comix.to/title/newthing/chapter-1',
		heading: 'https://comix.to/title/newthing/chapter-1'
	});
	assert.ok(parsed);
	assert.equal(parsed.series_title, 'Newthing');
	assert.equal(parsed.title_source, 'url');
	assert.equal(parsed.needs_review, true);
	assert.equal(parsed.site_title, '');
});

test('series page without a chapter is accepted', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/chainsaw-man',
		title: 'Chainsaw Man | Comix',
		heading: 'Chainsaw Man'
	});
	assert.ok(parsed);
	assert.equal(parsed.chapter, null);
	assert.equal(parsed.is_chapter_page, false);
	assert.equal(parsed.series_title, 'Chainsaw Man');
	assert.equal(parsed.needs_review, false);
});

test('query parameters do not change source identity', () => {
	const first = normalizeUrl('https://www.comix.to/title/one-piece/chapter-1?utm_source=x&page=2#top');
	const second = normalizeUrl('https://comix.to/title/one-piece/chapter-1?utm_medium=y');
	assert.ok(first && second);
	assert.equal(first.normalized_path, second.normalized_path);
	assert.equal(first.normalized_path, 'comix.to/title/one-piece/chapter-1');
	assert.equal(siteFromHost('www.comix.to'), 'comix');
	assert.equal(siteFromHost('mangadot.net'), 'mangadot');
});

test('non-http urls are refused', () => {
	assert.equal(parseCapture({ url: 'javascript:alert(1)' }), null);
	assert.equal(normalizeUrl('not a url'), null);
});

test('site boilerplate is stripped from titles', () => {
	const parsed = parseCapture({
		url: 'https://mangadot.net/manga/the-beginning-after-the-end/chapter-88',
		title: 'Read The Beginning After the End Chapter 88 Online Free | MangaDot',
		breadcrumb: 'Home / Manga / The Beginning After the End / Chapter 88'
	});
	assert.ok(parsed);
	assert.equal(parsed.series_title, 'The Beginning After the End');
	assert.equal(parsed.chapter, 88);
});

test('titles with dashes are preserved', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/re-zero/chapter-3',
		title: 'Re:Zero - Starting Life in Another World Chapter 3 | Comix',
		heading: 'Re:Zero - Starting Life in Another World'
	});
	assert.ok(parsed);
	assert.equal(parsed.series_title, 'Re:Zero - Starting Life in Another World');
	assert.equal(parsed.chapter, 3);
});

test('explicit chapter input wins over the title', () => {
	const parsed = parseCapture({
		url: 'https://comix.to/title/bleach/chapter-12',
		title: 'Bleach Chapter 12 | Comix',
		chapter: 13
	});
	assert.ok(parsed);
	assert.equal(parsed.chapter, 13);
});
