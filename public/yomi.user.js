// ==UserScript==
// @name         Yomi — log the chapter you are reading
// @namespace    https://github.com/yomi
// @version      1.1.0
// @description  Posts the chapter page you already opened to your own Yomi Worker. Zero taps, one request per chapter.
// @author       you
// @match        *://*.comix.to/*
// @match        *://comix.to/*
// @match        *://*.mangadot.net/*
// @match        *://mangadot.net/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

/*
 * Setup (once per browser):
 *   1. Install this file in Tampermonkey or Violentmonkey.
 *   2. Tampermonkey → this script → the user-script menu (or the extension's
 *      "Yomi" commands) → "Set Worker endpoint", paste
 *      https://<worker>.<you>.workers.dev/api
 *   3. Same menu → "Set sync token", paste the Worker's SYNC_TOKEN.
 *   4. Open a chapter. It logs itself. The small toast confirms.
 *
 * Notes:
 *   - The server parses the URL again, so a site markup change only costs you
 *     the title/heading, never the chapter number.
 *   - The reader's own chapter list ("61 / 72") is passed up as the series
 *     total, so an ongoing series shows 61/72 without you typing the number.
 *     A total that is already higher, or one you set by hand, is never lowered.
 *   - A failed post is queued and retried on the next page or after 60s.
 *   - Add another site by adding an @match line and its host to SITES below.
 */

(function () {
	'use strict';

	var SITES = [/\.comix\./i, /\.mangadot\./i];
	var QUEUE_KEY = 'yomi_queue';
	var SENT_KEY = 'yomi_sent';
	var ENDPOINT_KEY = 'yomi_endpoint';
	var TOKEN_KEY = 'yomi_token';
	var AUTO_KEY = 'yomi_auto';
	var DEVICE = 'pc-userscript';
	var RETRY_MS = 60 * 1000;
	var REACTION_MS = 1200;

	if (!SITES.some(function (pattern) { return pattern.test(location.hostname); })) return;

	var auto = GM_getValue(AUTO_KEY, true);
	var timer = null;
	var lastUrl = '';
	var flushing = false;

	function readString(key, fallback) {
		var value = GM_getValue(key, fallback);
		return typeof value === 'string' ? value : fallback;
	}

	function endpoint() {
		var value = readString(ENDPOINT_KEY, '').trim().replace(/\/+$/, '');
		return /\/api$/.test(value) ? value : value + '/api';
	}

	function token() {
		return readString(TOKEN_KEY, '').trim();
	}

	function cleanTitle(raw) {
		return String(raw || '')
			.replace(/\s*[|·•]\s*(Comix|Manga\s*Dot|MangaDot)\b.*$/i, '')
			.replace(/\s+[-–—]\s+(Read|Comix|Manga\s*Dot)\b.*$/i, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	// MangaDot serves /chapter/265763 — a database id, not a chapter number.
	var OPAQUE_CHAPTER = /^\/chapter\/\d+\/?$/i;

	function opaqueChapterPage() {
		return /(^|\.)mangadot\./i.test(location.hostname) && OPAQUE_CHAPTER.test(location.pathname);
	}

	function chapterFromUrl(url) {
		var match = url.match(/(?:chapter|chap|ch|episode|ep)[-_ /]?(\d+(?:[.-]\d+)?)(?=$|[/?#-])/i);
		if (!match) return null;
		var parts = match[1].split(/[.-]/);
		var value = parts.length === 2 && parts[1].length === 1
			? Number(parts[0] + '.' + parts[1])
			: Number(parts[0]);
		return Number.isFinite(value) && value > 0 ? value : null;
	}

	function heading() {
		var selectors = ['.chapter-title', '.chapter-heading', '.reader-header h1', 'main h1', 'article h1', 'h1'];
		for (var index = 0; index < selectors.length; index += 1) {
			var node = document.querySelector(selectors[index]);
			var text = node && node.textContent ? node.textContent.trim() : '';
			if (text) return text;
		}
		return '';
	}

	function breadcrumb() {
		var selectors = ['nav[aria-label*="read" i]', '.breadcrumb', '.breadcrumbs', 'nav.breadcrumb'];
		for (var index = 0; index < selectors.length; index += 1) {
			var node = document.querySelector(selectors[index]);
			var text = node && node.textContent ? node.textContent.replace(/\s+/g, ' ').trim() : '';
			if (text && text.length < 400) return text;
		}
		return '';
	}

	function cover() {
		var meta = document.querySelector('meta[property="og:image"]');
		var value = meta ? meta.getAttribute('content') : '';
		return value && /^https?:/i.test(value) ? value : '';
	}

	/*
	 * The chapter list prints every row as "61 / 72", which is the only place an
	 * ongoing series' total exists: every catalogue leaves that count empty while
	 * a series is still releasing. Only a denominator several rows agree on counts,
	 * so a stray "1 / 4" from a page counter is ignored.
	 */
	function chapterTotal() {
		var lines = (document.body.innerText || '').split(/\n+/);
		var tally = {};
		for (var index = 0; index < lines.length; index += 1) {
			var match = /^\s*(\d{1,6}(?:[.,]\d{1,2})?)\s*\/\s*(\d{1,6}(?:[.,]\d{1,2})?)\s*$/.exec(lines[index]);
			if (!match) continue;
			var total = Number(match[2].replace(',', '.'));
			if (!isFinite(total) || total <= 0) continue;
			tally[total] = (tally[total] || 0) + 1;
		}
		var best = null;
		var bestCount = 2;
		for (var key in tally) {
			if (tally[key] > bestCount) {
				bestCount = tally[key];
				best = Number(key);
			}
		}
		return best;
	}

	function capture() {
		var url = location.href;
		// On an id-only page the URL says nothing; leave the chapter empty and let
		// the Worker read it from the title ("Otr of the Flame — Chapter 34").
		var opaque = opaqueChapterPage();
		var chapter = opaque ? null : chapterFromUrl(url);
		if (!opaque && chapter === null) return null;
		var total = chapterTotal();
		if (total !== null && chapter !== null && total < chapter) total = null;
		return {
			url: url,
			title: document.title,
			heading: heading(),
			breadcrumb: breadcrumb(),
			label: '',
			chapter: chapter,
			total_chapters: total,
			cover_url: cover(),
			device_id: DEVICE,
			method: 'userscript'
		};
	}

	function queue() {
		var stored = GM_getValue(QUEUE_KEY, []);
		return Array.isArray(stored) ? stored : [];
	}

	function saveQueue(rows) {
		GM_setValue(QUEUE_KEY, rows.slice(-25));
	}

	function alreadySent(url) {
		var stored = GM_getValue(SENT_KEY, {});
		if (!stored || typeof stored !== 'object') return false;
		return typeof stored[url] === 'number';
	}

	function markSent(url) {
		var stored = GM_getValue(SENT_KEY, {});
		if (!stored || typeof stored !== 'object') stored = {};
		var cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
		var next = {};
		Object.keys(stored).forEach(function (key) {
			if (stored[key] > cutoff) next[key] = stored[key];
		});
		next[url] = Date.now();
		GM_setValue(SENT_KEY, next);
	}

	function toast(message, tone) {
		var host = document.createElement('div');
		host.style.cssText = 'position:fixed;z-index:2147483000;right:16px;bottom:16px;pointer-events:none;';
		var shadow = host.attachShadow({ mode: 'open' });
		var style = document.createElement('style');
		style.textContent =
			':host{all:initial}' +
			'.card{font:500 12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.02em;' +
			'background:#ededE4;color:#141411;border:1.5px solid #141411;box-shadow:4px 4px 0 rgba(20,20,17,.18);' +
			'padding:9px 12px;max-width:260px;opacity:0;transform:translateY(6px);transition:opacity .18s,transform .18s}' +
			'.card.on{opacity:1;transform:none}' +
			'.card b{display:block;color:#cb2a10;font-size:9px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:3px}' +
			'.card.err{border-color:#cb2a10}.card.err b{color:#cb2a10}' +
			'@media (prefers-color-scheme:dark){.card{background:#121310;color:#eeeeE1;border-color:#eeeeE1}}';
		var card = document.createElement('div');
		card.className = 'card' + (tone === 'err' ? ' err' : '');
		var label = document.createElement('b');
		label.textContent = tone === 'err' ? 'Yomi · not logged' : 'Yomi · logged';
		var body = document.createElement('span');
		body.textContent = message;
		card.appendChild(label);
		card.appendChild(body);
		shadow.appendChild(style);
		shadow.appendChild(card);
		document.body.appendChild(host);
		requestAnimationFrame(function () { card.classList.add('on'); });
		setTimeout(function () {
			card.classList.remove('on');
			setTimeout(function () { host.remove(); }, 260);
		}, 3200);
	}

	function post(row) {
		return fetch(endpoint() + '/ingest', {
			method: 'POST',
			headers: {
				Authorization: 'Bearer ' + token(),
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(row),
			credentials: 'omit',
			redirect: 'error'
		}).then(function (response) {
			return response.json().catch(function () { return {}; }).then(function (body) {
				if (!response.ok) {
					throw new Error((body && body.error) || 'HTTP ' + response.status);
				}
				return body;
			});
		});
	}

	function describe(body, row) {
		var title = body && body.series ? body.series.title : cleanTitle(row.title);
		var chapter = body && body.event ? body.event.chapter : row.chapter;
		var suffix = body && body.duplicate ? ' · already there' : '';
		return 'Ch. ' + chapter + (title ? ' · ' + title : '') + suffix;
	}

	function flush() {
		if (flushing) return;
		if (!endpoint() || !token()) return;
		var rows = queue();
		if (rows.length === 0) return;
		flushing = true;
		var row = rows[0];
		post(row)
			.then(function () {
				saveQueue(queue().slice(1));
				markSent(row.url);
			})
			.catch(function () { /* keep it queued */ })
			.finally(function () {
				flushing = false;
			});
	}

	function send(row, silent) {
		if (!endpoint() || !token()) {
			GM_setValue(QUEUE_KEY, queue().concat([row]));
			if (!silent) toast('Set the Worker endpoint and token first (script menu).', 'err');
			return;
		}
		post(row)
			.then(function (body) {
				markSent(row.url);
				if (!body || body.ok !== true) throw new Error('Rejected');
				if (!silent) toast(describe(body, row));
			})
			.catch(function (error) {
				GM_setValue(QUEUE_KEY, queue().concat([row]));
				if (!silent) {
					toast('Queued: ' + (error && error.message ? error.message : 'request failed'), 'err');
				}
			});
	}

	function maybeLog() {
		if (!auto) return;
		var row = capture();
		if (!row) return;
		if (row.url === lastUrl) return;
		if (alreadySent(row.url)) return;
		lastUrl = row.url;
		send(row, false);
	}

	function schedule() {
		if (timer) clearTimeout(timer);
		timer = setTimeout(function () {
			flush();
			maybeLog();
		}, REACTION_MS);
	}

	function hookHistory() {
		var wrap = function (name) {
			var original = history[name];
			if (typeof original !== 'function') return;
			history[name] = function () {
				var result = original.apply(this, arguments);
				schedule();
				return result;
			};
		};
		wrap('pushState');
		wrap('replaceState');
		window.addEventListener('popstate', schedule);
		window.addEventListener('hashchange', schedule);
	}

	GM_registerMenuCommand('Yomi: log this page now', function () {
		var row = capture();
		if (!row) {
			toast('No chapter number in this URL.', 'err');
			return;
		}
		lastUrl = '';
		send(row, false);
	});

	GM_registerMenuCommand('Yomi: set Worker endpoint', function () {
		var value = window.prompt('Worker endpoint (ends in /api)', endpoint());
		if (value === null) return;
		GM_setValue(ENDPOINT_KEY, value.trim().replace(/\/+$/, ''));
		toast('Endpoint saved.');
		flush();
	});

	GM_registerMenuCommand('Yomi: set sync token', function () {
		var value = window.prompt('Sync token (the Worker SYNC_TOKEN)');
		if (value === null) return;
		GM_setValue(TOKEN_KEY, value.trim());
		toast('Token saved.');
		flush();
	});

	GM_registerMenuCommand('Yomi: auto-log ' + (auto ? 'OFF' : 'ON'), function () {
		auto = !auto;
		GM_setValue(AUTO_KEY, auto);
		toast(auto ? 'Auto-log is ON.' : 'Auto-log is OFF. Use the menu command.');
	});

	hookHistory();
	window.addEventListener('load', schedule);
	setInterval(flush, RETRY_MS);
	schedule();
})();
