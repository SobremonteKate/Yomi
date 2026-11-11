/*
 * Yomi service worker.
 *
 * The app's data does not live here: IndexedDB is the store, the Worker is the
 * sync target. This file only makes the shell load with no network.
 *
 * Strategy:
 *   - navigations: network first, cached shell as the offline fallback
 *   - same-origin assets: cache first, refresh in the background
 *   - /api/* and non-GET: never touched
 */

const VERSION = 'yomi-v1';
const SHELL = '/';
const PRECACHE = [
	'/',
	'/manifest.webmanifest',
	'/icons/icon.svg',
	'/icons/icon-192.png',
	'/icons/icon-512.png',
	'/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(VERSION)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
			.then(() => self.clients.claim())
	);
});

async function networkFirst(request) {
	const cache = await caches.open(VERSION);
	try {
		const response = await fetch(request);
		if (response.ok) cache.put(SHELL, response.clone());
		return response;
	} catch {
		const cached = (await cache.match(SHELL)) ?? (await cache.match(request));
		if (cached) return cached;
		return new Response('Offline. Open Yomi once with a connection to install the shell.', {
			status: 503,
			headers: { 'Content-Type': 'text/plain; charset=utf-8' }
		});
	}
}

async function cacheFirst(request) {
	const cache = await caches.open(VERSION);
	const cached = await cache.match(request);
	if (cached) {
		// Refresh quietly; a failed refresh never breaks the cached page.
		void fetch(request)
			.then((response) => {
				if (response.ok) cache.put(request, response.clone());
			})
			.catch(() => {});
		return cached;
	}
	const response = await fetch(request);
	if (response.ok) cache.put(request, response.clone());
	return response;
}

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

	if (request.mode === 'navigate') {
		event.respondWith(networkFirst(request));
		return;
	}

	event.respondWith(cacheFirst(request));
});
