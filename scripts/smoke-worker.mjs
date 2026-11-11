import fs from 'node:fs';
import assert from 'node:assert/strict';
import { newEvent, newSeries, newSource } from '../shared/merge.ts';

const base = process.env.YOMI_URL || 'http://127.0.0.1:8787/api';
const token =
	process.env.YOMI_TOKEN?.trim() ||
	/^SYNC_TOKEN=(.+)$/m.exec(fs.readFileSync('.dev.vars', 'utf8'))?.[1]?.trim();
if (!token) throw new Error('SYNC_TOKEN missing from .dev.vars (or set YOMI_TOKEN)');

const run = Math.random().toString(36).slice(2, 8);
const now = new Date();
const iso = now.toISOString();

async function api(path, options = {}) {
	const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
	if (options.auth !== false) headers.Authorization = `Bearer ${options.token ?? token}`;
	const response = await fetch(`${base}${path}`, {
		method: options.method ?? 'GET',
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined
	});
	const text = await response.text();
	let body = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = text;
	}
	return { status: response.status, body, headers: response.headers };
}

async function exportAll() {
	const result = await api('/export');
	assert.equal(result.status, 200, `export status ${result.status}`);
	return result.body;
}

function device(id) {
	return { id, label: 'Smoke test', platform: 'Node', last_sync_at: null };
}

const checks = [];
function ok(name) {
	checks.push(name);
	console.log(`  ✓ ${name}`);
}

console.log(`Smoke testing ${base} (run ${run})`);

// Unauthorized requests are refused.
{
	const result = await api('/ping', { auth: false });
	assert.equal(result.status, 401);
	ok('unauthenticated ping is rejected');
}

// CORS preflight for capture clients.
{
	const response = await fetch(`${base}/ingest`, { method: 'OPTIONS' });
	assert.equal(response.status, 204);
	assert.equal(response.headers.get('access-control-allow-origin'), '*');
	ok('CORS preflight succeeds');
}

// Ping.
const ping = await api('/ping');
assert.equal(ping.status, 200);
assert.equal(ping.body.ok, true);
ok('authenticated ping');

const title = `Smoke Test ${run}`;
const first = await api('/ingest', {
	method: 'POST',
	body: {
		url: `https://comix.to/title/smoke-${run}/chapter-1`,
		title: `${title} Chapter 1 | Comix`,
		heading: title,
		label: 'Chapter 1',
		method: 'userscript'
	}
});
assert.equal(first.status, 200, JSON.stringify(first.body));
assert.equal(first.body.created_series, true);
assert.equal(first.body.series.title, title);
assert.equal(first.body.event.chapter, 1);
ok('ingest creates a series and chapter');

const second = await api('/ingest', {
	method: 'POST',
	body: {
		url: `https://comix.to/title/smoke-${run}/chapter-2`,
		title: `${title} Chapter 2 | Comix`,
		heading: title,
		label: 'Chapter 2',
		method: 'userscript'
	}
});
assert.equal(second.status, 200);
assert.equal(second.body.created_series, false);
assert.equal(second.body.series.id, first.body.series.id);
assert.equal(second.body.event.chapter, 2);
ok('a second chapter attaches to the same series and source');

const again = await api('/ingest', {
	method: 'POST',
	body: {
		url: `https://comix.to/title/smoke-${run}/chapter-1`,
		title: `${title} Chapter 1 | Comix`,
		heading: title,
		method: 'shortcut'
	}
});
assert.equal(again.status, 200);
assert.equal(again.body.duplicate, true);
assert.equal(again.body.event.chapter, 1);
ok('ingest is idempotent for the same chapter');

// MangaDot serves /chapter/<database id>: the number and the name are only in
// the page title, and a stray id must never be logged as progress.
const otf = `Otr of the Flame ${run}`;
const idFirst = await api('/ingest', {
	method: 'POST',
	body: {
		url: 'https://mangadot.net/chapter/265763',
		title: `${otf} — Chapter 34 | MangaDot`,
		method: 'shortcut'
	}
});
assert.equal(idFirst.status, 200, JSON.stringify(idFirst.body));
assert.equal(idFirst.body.event.chapter, 34);
assert.equal(idFirst.body.series.title, otf);
ok('mangadot id page reads the chapter from its title, not the id');

const idSecond = await api('/ingest', {
	method: 'POST',
	body: {
		url: 'https://mangadot.net/chapter/266001',
		title: `${otf} — Chapter 35 | MangaDot`,
		method: 'shortcut'
	}
});
assert.equal(idSecond.status, 200, JSON.stringify(idSecond.body));
assert.equal(idSecond.body.created_series, false);
assert.equal(idSecond.body.series.id, idFirst.body.series.id);
assert.equal(idSecond.body.event.chapter, 35);
ok('two mangadot id-only chapters share one series and source');

// The reader prints its own total ("61 / 72"), which is the only place an
// ongoing series' count exists. It fills a blank one and never lowers one.
const totalSeries = `Total Test ${run}`;
const totalFirst = await api('/ingest', {
	method: 'POST',
	body: {
		url: `https://comix.to/title/smoke-total-${run}/chapter-61`,
		title: `${totalSeries} Chapter 61 | Comix`,
		heading: totalSeries,
		method: 'userscript',
		total_chapters: 72
	}
});
assert.equal(totalFirst.status, 200, JSON.stringify(totalFirst.body));
assert.equal(totalFirst.body.event.chapter, 61);
assert.equal(totalFirst.body.series.total_chapters, 72);
ok('the site total fills an ongoing series count');

const totalLower = await api('/ingest', {
	method: 'POST',
	body: {
		url: `https://comix.to/title/smoke-total-${run}/chapter-62`,
		title: `${totalSeries} Chapter 62 | Comix`,
		heading: totalSeries,
		method: 'userscript',
		total_chapters: 70
	}
});
assert.equal(totalLower.status, 200, JSON.stringify(totalLower.body));
assert.equal(totalLower.body.series.id, totalFirst.body.series.id);
assert.equal(totalLower.body.series.total_chapters, 72, 'a lower site total must not shrink the count');
ok('a lower site total does not shrink the count');

const captured = await exportAll();
const capturedSeries = captured.series.find((row) => row.id === first.body.series.id);
const capturedSources = captured.sources.filter((row) => row.series_id === first.body.series.id);
const capturedEvents = captured.events.filter(
	(row) => row.series_id === first.body.series.id && !row.deleted_at
);
assert.equal(capturedSeries.title, title);
assert.equal(capturedSources.length, 1);
assert.equal(capturedEvents.length, 2);
assert.equal(capturedSources[0].url, `https://comix.to/title/smoke-${run}`);
assert.equal(new Set(capturedEvents.map((row) => row.chapter)).size, 2);
ok('one series, one source, two append-only events');

// Push a fresh series, source and event to the server.
const deviceA = device(`smoke-pc-${run}`);
const pushedSeries = newSeries(
	deviceA.id,
	{
		title: `Push Test ${run}`,
		status: 'reading',
		notes: 'from the test',
		rating: 8.5,
		tags: ['action', 'smoke']
	},
	new Date(iso),
	`push-series-${run}`
);
const pushedSource = newSource(
	deviceA.id,
	{
		series_id: pushedSeries.id,
		site: 'mangadot',
		url: `https://mangadot.net/manga/push-${run}`,
		normalized_path: `mangadot.net/manga/push-${run}`,
		site_title: `Push Test ${run} | MangaDot`,
		adapter_version: 'mangadot-1'
	},
	new Date(iso),
	`push-source-${run}`
);
const pushedEvent = newEvent(
	deviceA.id,
	{
		series_id: pushedSeries.id,
		source_id: pushedSource.id,
		chapter: 7.5,
		method: 'manual',
		chapter_label: 'Ch. 7.5'
	},
	new Date(iso),
	`push-event-${run}`
);

const cursorBeforePush = ping.body.cursor;
const push = await api('/sync', {
	method: 'POST',
	body: {
		since: cursorBeforePush,
		device: deviceA,
		push: { series: [pushedSeries], sources: [pushedSource], events: [pushedEvent], merges: [] }
	}
});
assert.equal(push.status, 200, JSON.stringify(push.body));
assert.ok(push.body.accepted.series.includes(pushedSeries.id));
assert.ok(push.body.accepted.sources.includes(pushedSource.id));
assert.ok(push.body.accepted.events.includes(pushedEvent.id));
ok('sync accepts pushed rows');

// A second device sees the pushed rows from zero.
const deviceB = device(`smoke-phone-${run}`);
const pulled = await api('/sync', {
	method: 'POST',
	body: { since: 0, device: deviceB, push: { series: [], sources: [], events: [], merges: [] } }
});
assert.equal(pulled.status, 200);
assert.ok(pulled.body.changes.some((change) => change.kind === 'series' && change.row.id === pushedSeries.id));
assert.ok(pulled.body.changes.some((change) => change.kind === 'event' && change.row.id === pushedEvent.id));
assert.ok(pulled.body.changes.length <= 200);
ok('a fresh device pulls the same rows');

// Older field edits lose; newer ones win.
const cursorAfterPush = push.body.cursor;
const oldStatus = new Date(Date.parse(iso) - 60_000).toISOString();
const stale = {
	...pushedSeries,
	status: 'dropped',
	updated_at: oldStatus,
	field_ts: { ...pushedSeries.field_ts, status: { t: oldStatus, d: 'stale-device' } }
};
const stalePush = await api('/sync', {
	method: 'POST',
	body: {
		since: cursorAfterPush,
		device: deviceB,
		push: { series: [stale], sources: [], events: [], merges: [] }
	}
});
assert.equal(stalePush.status, 200);
let snapshot = await exportAll();
assert.equal(
	snapshot.series.find((row) => row.id === pushedSeries.id).status,
	'reading',
	'older status must not overwrite'
);
ok('older field edit does not win');

const newStatus = new Date(Date.parse(iso) + 60_000).toISOString();
const fresh = {
	...pushedSeries,
	status: 'completed',
	updated_at: newStatus,
	field_ts: { ...pushedSeries.field_ts, status: { t: newStatus, d: deviceB.id } }
};
const freshPush = await api('/sync', {
	method: 'POST',
	body: {
		since: stalePush.body.cursor,
		device: deviceA,
		push: { series: [fresh], sources: [], events: [], merges: [] }
	}
});
assert.equal(freshPush.status, 200);
snapshot = await exportAll();
assert.equal(snapshot.series.find((row) => row.id === pushedSeries.id).status, 'completed');
ok('newer field edit wins');

// A duplicate series URL is rejected and the canonical source is returned.
const collisionSource = {
	...pushedSource,
	id: `push-source-dupe-${run}`,
	device_id: deviceB.id,
	updated_at: iso,
	field_ts: {
		...pushedSource.field_ts,
		series_id: { t: iso, d: deviceB.id },
		site_title: { t: iso, d: deviceB.id }
	}
};
const collisionEvent = newEvent(
	deviceB.id,
	{
		series_id: pushedSeries.id,
		source_id: collisionSource.id,
		chapter: 8,
		method: 'shortcut'
	},
	new Date(),
	`push-event-dupe-${run}`
);
const collision = await api('/sync', {
	method: 'POST',
	body: {
		since: freshPush.body.cursor,
		device: deviceB,
		push: {
			series: [],
			sources: [collisionSource],
			events: [collisionEvent],
			merges: []
		}
	}
});
assert.equal(collision.status, 200, JSON.stringify(collision.body));
assert.ok(collision.body.conflicts.sources.some((row) => row.id === pushedSource.id));
assert.ok(collision.body.deferred.events.includes(collisionEvent.id));
assert.ok(!collision.body.accepted.events.includes(collisionEvent.id));
snapshot = await exportAll();
assert.ok(!snapshot.events.some((row) => row.id === collisionEvent.id));
ok('duplicate URL is returned as a conflict and its event is deferred');

// Field-level merge keeps two edits from different devices.
const noteTime = new Date(Date.parse(newStatus) + 60_000).toISOString();
const note = {
	...fresh,
	notes: 'edited on the phone',
	status: 'completed',
	updated_at: noteTime,
	field_ts: { ...fresh.field_ts, notes: { t: noteTime, d: deviceB.id } }
};
const notePush = await api('/sync', {
	method: 'POST',
	body: {
		since: collision.body.cursor,
		device: deviceA,
		push: { series: [note], sources: [], events: [], merges: [] }
	}
});
assert.equal(notePush.status, 200);
snapshot = await exportAll();
const mergedSeries = snapshot.series.find((row) => row.id === pushedSeries.id);
assert.equal(mergedSeries.notes, 'edited on the phone');
assert.equal(mergedSeries.status, 'completed');
assert.equal(mergedSeries.rating, 8.5);
assert.deepEqual(mergedSeries.tags, ['action', 'smoke']);
ok('per-field merge keeps unrelated edits, ratings and tags');

// ---------------------------------------------------------------------------
// Accounts, isolation and the read-only share link
// ---------------------------------------------------------------------------

async function signup(username) {
	const result = await api('/signup', {
		method: 'POST',
		auth: false,
		body: { username }
	});
	assert.equal(result.status, 201, JSON.stringify(result.body));
	assert.ok(result.body.token);
	return result.body;
}

const accountA = await signup(`smoke-a-${run}`);
const accountB = await signup(`smoke-b-${run}`);
ok('two accounts can be created on the same Worker');

{
	const pingA = await api('/ping', { token: accountA.token });
	assert.equal(pingA.status, 200);
	assert.equal(pingA.body.account.username, `smoke-a-${run}`);
	assert.equal(pingA.body.schema, 2);
	ok('a token identifies its own account');
}

const accountDevice = device(`smoke-account-${run}`);
const accountSeries = newSeries(
	accountDevice.id,
	{ title: `Private ${run}`, status: 'reading', rating: 9, tags: ['private'] },
	new Date(),
	`private-series-${run}`
);
{
	const result = await api('/sync', {
		method: 'POST',
		token: accountA.token,
		body: {
			since: 0,
			device: accountDevice,
			push: { series: [accountSeries], sources: [], events: [], merges: [] }
		}
	});
	assert.equal(result.status, 200, JSON.stringify(result.body));
	assert.ok(result.body.accepted.series.includes(accountSeries.id));
	ok('an account syncs into its own log');
}

{
	const [exportA, exportB, exportLegacy] = await Promise.all([
		api('/export', { token: accountA.token }),
		api('/export', { token: accountB.token }),
		exportAll()
	]);
	assert.ok(exportA.body.series.some((row) => row.id === accountSeries.id));
	assert.ok(!exportB.body.series.some((row) => row.id === accountSeries.id));
	assert.ok(!exportLegacy.series.some((row) => row.id === accountSeries.id));
	// The legacy shelf keeps its own rows, which A cannot see either.
	assert.ok(!exportA.body.series.some((row) => row.id === pushedSeries.id));
	ok('accounts never see each other\u2019s rows');
}

{
	// Knowing another account's row id must not be enough to overwrite it.
	const hijack = await api('/sync', {
		method: 'POST',
		token: accountB.token,
		body: {
			since: 0,
			device: accountDevice,
			push: {
				series: [{ ...accountSeries, title: 'Stolen', rating: 1 }],
				sources: [],
				events: [],
				merges: []
			}
		}
	});
	assert.equal(hijack.status, 409);
	const after = await api('/export', { token: accountA.token });
	assert.equal(after.body.series.find((row) => row.id === accountSeries.id).title, `Private ${run}`);
	ok('another account cannot overwrite a row by id');
}

{
	const first = await api('/share', { method: 'POST', token: accountA.token });
	assert.equal(first.status, 200, JSON.stringify(first.body));
	const again = await api('/share', { method: 'POST', token: accountA.token });
	assert.equal(again.body.token, first.body.token);
	ok('a share link is created once and reused');

	const view = await api(`/share/${first.body.token}`, { auth: false });
	assert.equal(view.status, 200, JSON.stringify(view.body));
	assert.equal(view.body.username, `smoke-a-${run}`);
	const shared = view.body.series.find((row) => row.id === accountSeries.id);
	assert.equal(shared.rating, 9);
	assert.deepEqual(shared.tags, ['private']);
	assert.equal(shared.notes, '');
	assert.ok(!view.body.series.some((row) => row.id === pushedSeries.id));
	ok('a share link shows one shelf, without notes');

	const revoke = await api('/share', { method: 'DELETE', token: accountA.token });
	assert.equal(revoke.status, 200);
	const gone = await api(`/share/${first.body.token}`, { auth: false });
	assert.equal(gone.status, 404);
	ok('turning the link off retires the address');
}

console.log(`\n${checks.length} checks passed.`);
