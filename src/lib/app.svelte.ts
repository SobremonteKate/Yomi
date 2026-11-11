import { absorbedSeriesIds, seriesStats, type SeriesStats } from '../../shared/merge.ts';
import { parseCapture, type ParsedCapture } from '../../shared/parse.ts';
import type {
	Device,
	MergeRecord,
	ProgressEvent,
	Series,
	SeriesField,
	Source,
	Status
} from '../../shared/model.ts';
import {
	STATUS_LABEL,
	chapterText,
	normalizeRating,
	normalizeTags,
	parseChapterNumber,
	relativeTime
} from '../../shared/model.ts';
import type { AccountInfo } from '../../shared/protocol.ts';
import {
	createAccount as createAccountRequest,
	createShareLink,
	pingAccount,
	revokeShareLink
} from './account.ts';
import { chapterUrlAfter } from './chapter-link.ts';
import { parseReadingList } from './import-list.ts';
import { newSharedRows, type SharedShelfRow } from './share-copy.ts';
import { buildStats, type ReadingStats } from './stats.ts';
import {
	getMeta,
	getOrCreateDevice,
	loadAll,
	pendingCount,
	requestPersistence,
	setMeta,
	wipeLocalDatabase
} from './db.ts';
import * as repo from './repo.ts';
import { coverSearchTerms, lookupMeta } from './covers.ts';
import { cleanComixTitleCodes } from './title-cleanup.ts';
import { SHELF_SORT_LABEL, filterShelf, seriesMatches, sortShelf, type ShelfSort } from './shelf.ts';
import { findSimilarSeries } from './similar.ts';
import {
	initSyncState,
	onSyncApplied,
	refreshPending,
	resolveEndpoint,
	scheduleSync,
	startSyncLoop,
	syncNow,
	syncState,
	testConnection
} from './sync.ts';

export type Route =
	| { name: 'library' }
	| { name: 'series'; id: string }
	| { name: 'settings' }
	| { name: 'stats' }
	| { name: 'share'; token: string; api: string };

export type Filter = Status | 'all' | 'review';

/** A queued row plus the rank position that holds its place. */
export interface QueueEntry {
	series: Series;
	rank: number;
}

/** Where a reader should continue: the next chapter page, the last saved one, or the series. */
export interface ReadingLink {
	url: string;
	chapter: number | null;
	derived: boolean;
}

interface ToastAction {
	label: string;
	run: () => void | Promise<void>;
}

interface Toast {
	id: number;
	text: string;
	detail?: string;
	action?: ToastAction;
}

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

class AppStore {
	ready = $state(false);
	loadError = $state('');
	series = $state<Series[]>([]);
	sources = $state<Source[]>([]);
	events = $state<ProgressEvent[]>([]);
	merges = $state<MergeRecord[]>([]);
	device = $state<Device | null>(null);
	persisted = $state<boolean | null>(null);
	filter = $state<Filter>('reading');
	shelfQuery = $state('');
	shelfSort = $state<ShelfSort>('recent');
	tagFilter = $state('');
	route = $state<Route>({ name: 'library' });
	account = $state<AccountInfo | null>(null);
	accountChecking = $state(false);
	shareToken = $state<string | null>(null);
	shareBusy = $state(false);
	add = $state({ open: false, url: '', title: '' });
	toast = $state<Toast | null>(null);
	captureNotice = $state<{ message: string; href: string } | null>(null);
	canInstall = $state(false);
	onboardingOpen = $state(false);
	now = $state(Date.now());

	private installEvent: BeforeInstallPromptEvent | null = null;
	private initialized = false;
	private toastSeq = 0;
	private toastTimer: ReturnType<typeof setTimeout> | null = null;
	private unsubscribe: (() => void) | null = null;
	private clock: ReturnType<typeof setInterval> | null = null;
	private enrichAttempts = new Set<string>();
	private enrichBusy = false;
	detailsFilling = $state(false);
	detailsProgress = $state({ done: 0, total: 0 });

	async init(): Promise<void> {
		if (this.initialized) return;
		this.initialized = true;
		try {
			await this.repairComixTitles(await getOrCreateDevice());
			const data = await loadAll();
			this.apply(data);
			this.device = data.device;
			await initSyncState();
			this.shareToken = (await getMeta<string | null>('share_token', null)) ?? null;
			void this.refreshAccount();
			this.unsubscribe = onSyncApplied(() => void this.reload());
			this.parseHash();
			window.addEventListener('hashchange', this.handleHashChange);
			window.addEventListener('beforeinstallprompt', this.captureInstall);
			startSyncLoop();
			this.pickUpDeepLink();
			this.clock = window.setInterval(() => {
				this.now = Date.now();
			}, 30_000);
			this.persisted = await requestPersistence();
			this.ready = true;
			void this.enrichSeries();
			void this.maybeOnboard();
		} catch (error) {
			console.error(error);
			this.loadError =
				error instanceof Error ? error.message : 'The local reading log could not open.';
			this.ready = true;
		}
	}

	private captureInstall = (event: Event): void => {
		event.preventDefault();
		this.installEvent = event as BeforeInstallPromptEvent;
		this.canInstall = true;
	};

	/** A share link stays tour-free; moving on to the shelf is the invitation. */
	private handleHashChange = (): void => {
		this.parseHash();
		if (this.ready) void this.maybeOnboard();
	};

	private parseHash = (): void => {
		const hash = window.location.hash.replace(/^#/, '');
		const [pathPart, queryPart = ''] = hash.split('?');
		const parts = pathPart.split('/').filter(Boolean);
		const params = new URLSearchParams(queryPart);
		if (parts[0] === 'settings') {
			this.route = { name: 'settings' };
			return;
		}
		if (parts[0] === 'stats') {
			this.route = { name: 'stats' };
			return;
		}
		if (parts[0] === 'share' && parts[1]) {
			this.route = {
				name: 'share',
				token: decodeURIComponent(parts[1]),
				api: params.get('api') ?? ''
			};
			return;
		}
		if (parts[0] === 's' && parts[1]) {
			this.route = { name: 'series', id: decodeURIComponent(parts[1]) };
			return;
		}
		this.route = { name: 'library' };
	};

	private pickUpDeepLink(): void {
		const params = new URLSearchParams(window.location.search);
		const path = window.location.pathname.replace(/\/+$/, '');

		// /c?url=… is the share-sheet path: the Shortcut only has to open a URL,
		// and this app performs the capture with the token it already holds.
		if (path === '/c' || path.startsWith('/c/')) {
			const search = window.location.search;
			const href = window.location.href;
			const title = params.get('title') ?? '';
			// A URL parked in `title` is the classic Shortcut slip; use it rather
			// than losing the capture.
			let captured = (params.get('url') ?? params.get('add') ?? '').trim();
			if (!captured && path.startsWith('/c/')) captured = this.urlFromCapturePath(path);
			if (!captured && /^https?:/i.test(title.trim())) captured = title.trim();
			this.clearCapturePath();
			if (captured) {
				// `total` is the optional step: the page's own "61 / 72", read by the
				// Shortcut's JavaScript action and carried on the link.
				void this.captureFromLink(captured, params.get('title'), params.get('total'));
				return;
			}
			// Leave this on screen: the exact URL Yomi received is the only way to
			// tell a broken Shortcut apart from a stripped query string.
			const rawPath = path.startsWith('/c/') ? path.slice('/c/'.length) : '';
			this.captureNotice = {
				message: rawPath.trim()
					? 'The link arrived, but its value was not a page URL.'
					: search && !/^\?url=$/.test(search)
						? `Something arrived, but not a page URL: ${search.slice(0, 60)}`
						: 'Nothing followed /c/ in the link — the Shortcut’s Text probably stops at the prefix.',
				href
			};
			return;
		}

		const url = params.get('add');
		if (!url) return;
		this.openAdd(url, params.get('title') ?? '');
		this.clearCapturePath();
	}

	private clearCapturePath(): void {
		const clean = window.location.pathname.startsWith('/c')
			? `/${window.location.hash}`
			: `${window.location.pathname}${window.location.hash}`;
		window.history.replaceState({}, '', clean);
	}

	/** `/c/<encoded url>` — the same capture without relying on a query string. */
	private urlFromCapturePath(path: string): string {
		const raw = path.slice('/c/'.length);
		if (!raw) return '';
		let value = raw;
		try {
			value = decodeURIComponent(raw);
		} catch {
			value = raw;
		}
		// Some clients collapse the double slash in `https://` when it sits in a path.
		value = value.replace(/^(https?):\/(?!\/)/i, '$1://');
		return this.unwrapCaptureUrl(value);
	}

	dismissCaptureNotice(): void {
		this.captureNotice = null;
	}

	/** Undoes a second round of percent-encoding, which Shortcuts sometimes adds. */
	private unwrapCaptureUrl(raw: string): string {
		let value = raw.trim();
		for (let pass = 0; pass < 2 && /^https?%3a/i.test(value); pass += 1) {
			try {
				value = decodeURIComponent(value);
			} catch {
				break;
			}
		}
		return value;
	}

	/** Logs a page shared from the Shortcut, with no request details on the phone. */
	private async captureFromLink(
		rawUrl: string,
		rawTitle: string | null,
		rawTotal: string | null = null
	): Promise<void> {
		const parsed = parseCapture({ url: this.unwrapCaptureUrl(rawUrl), title: rawTitle ?? '' });
		if (!parsed) {
			this.showToast('That capture link carried no page URL', {
				detail: rawUrl.slice(0, 70),
				action: { label: 'Add by hand', run: () => this.openAdd() }
			});
			return;
		}

		// A page whose link and title both failed to say what it is would become an
		// "Untitled" row, so say what is missing instead of saving noise.
		if (parsed.chapter === null && !parsed.series_title) {
			this.showToast('That page carried no title or chapter', {
				detail: 'An id-only link like MangaDot\u2019s needs the page-name step in the Shortcut.',
				action: { label: 'Add by hand', run: () => this.openAdd() }
			});
			return;
		}

		const chapter = parsed.chapter;
		// Only a number the page actually printed gets through; a garbled
		// JavaScript result is ignored rather than guessed at.
		const total = parseChapterNumber(rawTotal);
		try {
			const result = await this.addParsed(parsed, {
				status: chapter !== null ? 'reading' : 'plan_to_read',
				chapter,
				chapterLabel: parsed.chapter_label,
				logChapter: chapter !== null,
				method: 'shortcut',
				total_chapters: total
			});
			this.captureNotice = null;

			// Safari and the installed app keep separate storage on iOS. If this copy
			// of the app was never connected, say so instead of quietly going local.
			const token = String((await getMeta('token', '')) ?? '');
			if (!token && !result.duplicate_event) {
				this.showToast(
					result.event
						? `Logged ch. ${chapterText(chapter ?? 0)} · this device only`
						: 'Saved on this device only',
					{
						detail: result.series.title,
						action: { label: 'Connect', run: () => this.navigate('settings') }
					}
				);
			}
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'That capture did not save.');
		}
	}

	private apply(data: Awaited<ReturnType<typeof loadAll>>): void {
		this.series = data.series;
		this.sources = data.sources;
		this.events = data.events;
		this.merges = data.merges;
		this.device = data.device;
		syncState.pending = data.pending;
	}

	private async repairComixTitles(device: Device): Promise<void> {
		try {
			await cleanComixTitleCodes(device);
		} catch (error) {
			console.warn('Could not clean old Comix titles', error);
		}
	}

	async reload(): Promise<void> {
		try {
			if (this.device) await this.repairComixTitles(this.device);
			const data = await loadAll();
			this.apply(data);
			void this.enrichSeries();
		} catch (error) {
			console.warn('Could not reload the local store', error);
		}
	}

	/** True when the row is missing at least one catalogue detail. */
	private needsDetails(row: Series): boolean {
		return !row.cover_url || row.total_chapters == null || !row.description;
	}

	/**
	 * Fills a missing cover, chapter total and synopsis from AniList, one series
	 * at a time. Runs on the open device because the Worker's egress is refused,
	 * and never overwrites a value you set yourself.
	 */
	private async enrichSeries(limit = 4): Promise<void> {
		if (this.enrichBusy || typeof window === 'undefined') return;
		const missing = this.series
			.filter(
				(row) =>
					this.needsDetails(row) &&
					!row.deleted_at &&
					!this.enrichAttempts.has(row.id)
			)
			.slice(0, limit);
		if (missing.length === 0) return;
		this.enrichBusy = true;
		try {
			for (const row of missing) {
				this.enrichAttempts.add(row.id);
				await this.enrichRow(row);
			}
		} finally {
			this.enrichBusy = false;
		}
	}

	/** Fetches one row's catalogue details; returns how many fields it filled. */
	private async enrichRow(row: Series): Promise<number> {
		const meta = await lookupMeta(coverSearchTerms(row, this.sourcesFor(row.id)));
		const current = this.series.find((item) => item.id === row.id);
		if (!current) return 0;
		const patch: Record<string, unknown> = {};
		if (meta.cover && !current.cover_url) patch.cover_url = meta.cover;
		if (meta.chapters !== null && current.total_chapters == null) {
			patch.total_chapters = meta.chapters;
		}
		if (meta.description && !current.description) patch.description = meta.description;
		if (Object.keys(patch).length === 0) return 0;
		await this.setField(row.id, patch);
		return Object.keys(patch).length;
	}

	/** One row's catalogue details, on demand from the series page. */
	async fetchDetails(seriesId: string): Promise<void> {
		const row = this.seriesById(seriesId);
		if (!row) return;
		if (!this.needsDetails(row)) {
			this.showToast('Cover, total and synopsis are already set');
			return;
		}
		this.enrichAttempts.add(seriesId);
		try {
			const filled = await this.enrichRow(row);
			this.showToast(
				filled > 0 ? 'Details filled from AniList' : 'No catalogue match found',
				{
					detail:
						filled > 0
							? row.title
							: 'Add a synopsis by hand, or try a page title that matches the catalogue.'
				}
			);
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not reach AniList.');
		}
	}

	/**
	 * The explicit version of the background enrich pass: every row still missing a
	 * cover, total or synopsis is looked up once, including rows the quiet pass
	 * already gave up on. Awaiting it gives Settings a progress line.
	 */
	async fillMissingDetails(): Promise<void> {
		if (this.detailsFilling) return;
		const targets = this.liveSeries.filter((row) => this.needsDetails(row));
		if (targets.length === 0) {
			this.showToast('Details are already complete');
			return;
		}
		this.detailsFilling = true;
		this.detailsProgress = { done: 0, total: targets.length };
		let filled = 0;
		let failed = 0;
		try {
			for (const row of targets) {
				this.enrichAttempts.add(row.id);
				try {
					if ((await this.enrichRow(row)) > 0) filled += 1;
				} catch {
					failed += 1;
				}
				this.detailsProgress = {
					done: this.detailsProgress.done + 1,
					total: targets.length
				};
			}
		} finally {
			this.detailsFilling = false;
		}
		const checked = targets.length;
		this.showToast(
			filled > 0
				? `Filled details for ${filled} of ${checked}`
				: 'The catalogue had nothing new',
			{
				detail:
					failed > 0
						? `${failed} could not be reached — try again later`
						: 'AniList matches on the series title and page names.'
			}
		);
	}

	navigate(name: Route['name'], id?: string): void {
		if (name === 'settings') window.location.hash = '#/settings';
		else if (name === 'stats') window.location.hash = '#/stats';
		else if (name === 'series' && id) window.location.hash = `#/s/${encodeURIComponent(id)}`;
		else window.location.hash = '#/';
	}

	openAdd(url = '', title = ''): void {
		this.add = { open: true, url, title };
	}

	closeAdd(): void {
		this.add = { ...this.add, open: false };
	}

	seriesById(id: string | undefined): Series | undefined {
		if (!id) return undefined;
		return this.series.find((row) => row.id === id);
	}

	titleById(id: string): string {
		return this.seriesById(id)?.title ?? 'Removed series';
	}

	sourcesFor(seriesId: string): Source[] {
		return this.sources
			.filter((row) => row.series_id === seriesId && !row.deleted_at)
			.sort((a, b) => {
				const aManual = a.normalized_path.startsWith('manual:') ? 1 : 0;
				const bManual = b.normalized_path.startsWith('manual:') ? 1 : 0;
				if (aManual !== bManual) return aManual - bManual;
				return Date.parse(a.first_seen_at) - Date.parse(b.first_seen_at);
			});
	}

	eventsFor(seriesId: string): ProgressEvent[] {
		return this.events
			.filter((row) => row.series_id === seriesId)
			.sort((a, b) => Date.parse(b.read_at) - Date.parse(a.read_at));
	}

	statsFor(series: Series): SeriesStats {
		return seriesStats(
			series,
			this.events.filter((row) => row.series_id === series.id)
		);
	}

	get liveSeries(): Series[] {
		const absorbed = absorbedSeriesIds(this.merges);
		return this.series.filter((row) => !row.deleted_at && !absorbed.has(row.id));
	}

	get counts(): Record<Filter, number> {
		const counts: Record<Filter, number> = {
			reading: 0,
			plan_to_read: 0,
			on_hold: 0,
			completed: 0,
			dropped: 0,
			review: 0,
			all: 0
		};
		for (const row of this.liveSeries) {
			counts[row.status] += 1;
			counts.all += 1;
			if (row.needs_review) counts.review += 1;
		}
		return counts;
	}

	/** Shelf rows after the filter, the search box and the chosen sort. */
	get filteredSeries(): Series[] {
		const filtered = filterShelf(this.liveSeries, this.filter);
		const query = this.shelfQuery.trim();
		const matched = query
			? filtered.filter((row) =>
					seriesMatches(
						row,
						query,
						this.sources
							.filter((source) => source.series_id === row.id && !source.deleted_at)
							.map((source) => source.site_title)
					)
				)
			: filtered;
		const tagged = this.tagFilter
			? matched.filter((row) => (row.tags ?? []).includes(this.tagFilter))
			: matched;
		const scores = new Map<string, number>();
		for (const row of tagged) {
			const stats = this.statsFor(row);
			const stamp = stats.lastReadAt ?? row.updated_at;
			scores.set(row.id, Date.parse(stamp) || 0);
		}
		return sortShelf(tagged, this.shelfSort, (row) => scores.get(row.id) ?? 0);
	}

	get sortLabel(): string {
		return SHELF_SORT_LABEL[this.shelfSort];
	}

	/** Every tag in use, most common first, for the shelf filter row. */
	get allTags(): { tag: string; count: number }[] {
		const counts = new Map<string, number>();
		for (const row of this.liveSeries) {
			for (const tag of row.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
		return [...counts.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
	}

	get readingStats(): ReadingStats {
		return buildStats(this.series, this.events, this.merges, new Date(this.now));
	}

	async setRating(series: Series, value: number | null): Promise<void> {
		const rating = normalizeRating(value);
		if ((series.rating ?? null) === rating) return;
		await this.setField(
			series.id,
			{ rating },
			rating === null ? 'Rating cleared' : `Rated ${rating}/10`
		);
	}

	async setTags(series: Series, value: string | string[]): Promise<void> {
		const tags = normalizeTags(value);
		if (JSON.stringify(tags) === JSON.stringify(series.tags ?? [])) return;
		await this.setField(series.id, { tags }, 'Tags saved');
	}

	/** Who the saved token belongs to, refreshed after connecting or on boot. */
	async refreshAccount(): Promise<void> {
		const token = String((await getMeta('token', '')) ?? '').trim();
		if (!token) {
			this.account = null;
			return;
		}
		const endpoint = String((await getMeta('endpoint', '')) ?? '');
		this.accountChecking = true;
		try {
			const info = await pingAccount(endpoint, token);
			if (info.ok && info.data) {
				this.account = info.data;
				await setMeta('account_id', info.data.id);
			}
		} finally {
			this.accountChecking = false;
		}
	}

	/** Merges an AniList or MyAnimeList export into the shelf. */
	async importReadingList(
		text: string
	): Promise<{ created: number; matched: number; skipped: number; chapters: number }> {
		const parsed = parseReadingList(text);
		if (parsed.entries.length === 0) {
			throw new Error('That file had no manga entries Yomi could read.');
		}
		const device = await this.currentDevice();
		const result = await repo.importReadingList(parsed.entries, device);
		await this.afterWrite();
		this.showToast(
			`Imported ${result.created} new ${result.created === 1 ? 'series' : 'series'}`,
			{
				detail: [
					result.matched > 0 ? `${result.matched} already on the shelf` : '',
					result.skipped > 0 ? `${result.skipped} skipped` : ''
				]
					.filter(Boolean)
					.join(' · '),
				action: { label: 'Shelf', run: () => this.navigate('library') }
			}
		);
		return result;
	}

	/** A public, read-only address for the shelf. Creates the link if needed. */
	async enableShare(): Promise<string | null> {
		if (this.shareBusy) return null;
		const token = String((await getMeta('token', '')) ?? '').trim();
		if (!token) {
			this.showToast('Connect a Worker account before sharing', {
				action: { label: 'Settings', run: () => this.navigate('settings') }
			});
			return null;
		}
		this.shareBusy = true;
		try {
			const endpoint = String((await getMeta('endpoint', '')) ?? '');
			const result = await createShareLink(endpoint, token);
			if (!result.ok || !result.data) {
				this.showToast(result.message);
				return null;
			}
			this.shareToken = result.data;
			await setMeta('share_token', result.data);
			return this.shareUrl(result.data, endpoint);
		} finally {
			this.shareBusy = false;
		}
	}

	async disableShare(): Promise<void> {
		const token = String((await getMeta('token', '')) ?? '').trim();
		const endpoint = String((await getMeta('endpoint', '')) ?? '');
		if (token) await revokeShareLink(endpoint, token);
		this.shareToken = null;
		await setMeta('share_token', null);
		this.showToast('Share link turned off', { detail: 'The old address no longer opens.' });
	}

	shareUrl(token: string, endpointRaw = ''): string {
		const endpoint = resolveEndpoint(endpointRaw);
		return `${window.location.origin}/#/share/${encodeURIComponent(token)}?api=${encodeURIComponent(
			endpoint
		)}`;
	}

	/** Opens the welcome tour from Settings, the empty shelf or a share page. */
	openOnboarding(): void {
		this.onboardingOpen = true;
	}

	async dismissOnboarding(): Promise<void> {
		this.onboardingOpen = false;
		try {
			await setMeta('onboarded', true);
		} catch (error) {
			console.warn('Could not remember the tour', error);
		}
	}

	/** First run is the one time the tour is unavoidable; share links stay clean. */
	private async maybeOnboard(): Promise<void> {
		if (this.onboardingOpen) return;
		try {
			const done = await getMeta<boolean>('onboarded', false);
			if (done) return;
			if (window.location.hash.startsWith('#/share/')) return;
			this.onboardingOpen = true;
		} catch (error) {
			console.warn('Could not check first run', error);
		}
	}

	/** The native share sheet where it exists, and a copied link everywhere else. */
	async shareShelf(): Promise<void> {
		const token = String((await getMeta('token', '')) ?? '').trim();
		if (!token) {
			this.showToast('Create an account to share your shelf', {
				detail: 'A read-only link is made from your synced account.',
				action: { label: 'Create account', run: () => this.openOnboarding() }
			});
			return;
		}
		const url = await this.enableShare();
		if (!url) return;
		if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
			try {
				await navigator.share({ title: 'My reading on Yomi', text: 'My shelf on Yomi', url });
				return;
			} catch (error) {
				// A cancelled share sheet is not a failure; fall through would duplicate it.
				if (error instanceof DOMException && error.name === 'AbortError') return;
			}
		}
		await this.copy(url, 'Share link copied');
	}

	/**
	 * Where to continue reading. The next chapter is a number away in the URL the
	 * reader saved; when that cannot be advanced, the last saved page is still a
	 * better destination than the shelf.
	 */
	readingLinkFor(series: Series): ReadingLink | null {
		const events = this.eventsFor(series.id).filter((event) => !event.deleted_at);
		const stats = this.statsFor(series);
		const atFurthest =
			stats.furthest === null
				? undefined
				: events.find(
						(event) => event.chapter === stats.furthest && Boolean(event.chapter_url)
					);
		const saved = atFurthest ?? events.find((event) => Boolean(event.chapter_url));
		if (saved) {
			const furthest = stats.furthest ?? saved.chapter;
			const next = Math.round((furthest + 1) * 100) / 100;
			const total = series.total_chapters;
			const pastEnd = total !== null && total > 0 && next > total;
			if (saved.chapter === furthest && !pastEnd) {
				const advanced = chapterUrlAfter(saved.chapter_url, saved.chapter, next);
				if (advanced) return { url: advanced, chapter: next, derived: true };
			}
			return { url: saved.chapter_url, chapter: saved.chapter, derived: false };
		}
		const source = this.sourcesFor(series.id).find((row) => Boolean(row.url));
		return source?.url ? { url: source.url, chapter: null, derived: false } : null;
	}

	readingLabel(link: ReadingLink | null): string {
		if (!link) return 'Open series';
		if (link.chapter === null) return 'Open the site';
		return link.derived ? `Read ch. ${chapterText(link.chapter)}` : `Open ch. ${chapterText(link.chapter)}`;
	}

	/** Copies a public shelf into this log: metadata only, never notes or scores. */
	async saveSharedShelf(rows: SharedShelfRow[]): Promise<{ saved: number; skipped: number }> {
		if (rows.length === 0) return { saved: 0, skipped: 0 };
		try {
			const result = await this.persistSharedRows(rows);
			if (result.saved === 0) {
				this.showToast('Every series is already on your shelf', {
					detail: `${rows.length} checked`
				});
				return result;
			}
			const connected = Boolean(String((await getMeta('token', '')) ?? '').trim());
			this.showToast(`Saved ${result.saved} ${result.saved === 1 ? 'series' : 'series'}`, {
				detail: connected
					? 'Cover, total and synopsis copied. Notes and scores stayed private.'
					: 'On this device for now — create an account to sync it.',
				action: connected
					? { label: 'Shelf', run: () => this.navigate('library') }
					: { label: 'Create account', run: () => this.openOnboarding() }
			});
			return result;
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not save that shelf.');
			return { saved: 0, skipped: 0 };
		}
	}

	async saveSharedSeries(row: SharedShelfRow): Promise<boolean> {
		try {
			const result = await this.persistSharedRows([row]);
			if (result.saved === 0) {
				this.showToast('Already on your shelf', { detail: row.title });
				return false;
			}
			this.showToast('Saved to your shelf', { detail: row.title });
			return true;
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not save that series.');
			return false;
		}
	}

	private async persistSharedRows(
		rows: SharedShelfRow[]
	): Promise<{ saved: number; skipped: number }> {
		const fresh = newSharedRows(rows, this.liveSeries.map((row) => row.title));
		if (fresh.length === 0) return { saved: 0, skipped: rows.length };
		const device = await this.currentDevice();
		for (const row of fresh) {
			const { series } = await repo.createManualSeries(device, row.title, {
				status: 'plan_to_read'
			});
			const patch: Record<string, unknown> = {};
			if (row.cover_url) patch.cover_url = row.cover_url;
			if (row.total_chapters && row.total_chapters > 0) patch.total_chapters = row.total_chapters;
			if (row.description) patch.description = row.description;
			if (Object.keys(patch).length > 0) await repo.updateSeries(series.id, patch, device);
		}
		await this.afterWrite();
		return { saved: fresh.length, skipped: rows.length - fresh.length };
	}

	/** Removes this browser's copy so another person can start clean. */
	async switchAccount(): Promise<void> {
		await wipeLocalDatabase();
		window.location.hash = '#/';
		window.location.reload();
	}

	get reviewing(): boolean {
		return this.filter === 'review';
	}

	/** The manual reading queue, in rank order. */
	get queue(): QueueEntry[] {
		return this.liveSeries
			.filter((row) => row.queue_rank !== null)
			.sort((a, b) => {
				const difference = (a.queue_rank ?? 0) - (b.queue_rank ?? 0);
				if (difference !== 0) return difference;
				return a.title.localeCompare(b.title);
			})
			.map((row) => ({ series: row, rank: row.queue_rank ?? 0 }));
	}

	isQueued(seriesId: string): boolean {
		return (this.seriesById(seriesId)?.queue_rank ?? null) !== null;
	}

	get continueEntry(): { series: Series; stats: SeriesStats } | null {
		const candidates = this.liveSeries.filter((row) => row.status === 'reading');
		if (candidates.length === 0) return null;
		let best: { series: Series; stats: SeriesStats } | null = null;
		let bestStamp = -1;
		for (const series of candidates) {
			const stats = this.statsFor(series);
			const stamp = Date.parse(stats.lastReadAt ?? series.updated_at) || 0;
			if (stamp > bestStamp) {
				best = { series, stats };
				bestStamp = stamp;
			}
		}
		return best;
	}

	/** Tombstoned rows, newest first — the safety net behind Undo. */
	get recentlyDeleted(): Series[] {
		const absorbed = absorbedSeriesIds(this.merges);
		return this.series
			.filter((row) => Boolean(row.deleted_at) && !absorbed.has(row.id))
			.sort((a, b) => Date.parse(b.deleted_at ?? '') - Date.parse(a.deleted_at ?? ''))
			.slice(0, 12);
	}

	async restoreDeleted(seriesId: string): Promise<void> {
		const device = await this.currentDevice();
		const title = this.titleById(seriesId);
		try {
			await repo.restoreSeries(seriesId, device);
			await this.afterWrite();
			this.showToast('Series restored', { detail: title });
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not restore that series.');
		}
	}

	get activeMerges(): MergeRecord[] {
		return this.merges
			.filter((row) => !row.undone_at)
			.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
	}

	get allMerges(): MergeRecord[] {
		return [...this.merges].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
	}

	absorbedInto(seriesId: string): MergeRecord | undefined {
		return this.activeMerges.find((row) => row.from_series_id === seriesId);
	}

	showToast(
		text: string,
		options: { detail?: string; action?: ToastAction; duration?: number } = {}
	): void {
		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.toastSeq += 1;
		const id = this.toastSeq;
		this.toast = { id, text, detail: options.detail, action: options.action };
		this.toastTimer = setTimeout(
			() => {
				if (this.toast?.id === id) this.toast = null;
			},
			options.duration ?? 7000
		);
	}

	dismissToast(): void {
		if (this.toastTimer) clearTimeout(this.toastTimer);
		this.toast = null;
	}

	async runToastAction(): Promise<void> {
		const action = this.toast?.action;
		this.dismissToast();
		if (!action) return;
		try {
			await action.run();
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'That action failed.');
		}
	}

	private async afterWrite(): Promise<void> {
		await this.reload();
		await refreshPending();
		scheduleSync();
	}

	private async currentDevice(): Promise<Device> {
		if (!this.device) {
			this.device = await getOrCreateDevice();
		}
		return this.device;
	}

	async addParsed(
		parsed: ParsedCapture,
		options: repo.AddCaptureOptions
	): Promise<repo.AddCaptureResult> {
		const device = await this.currentDevice();
		const result = await repo.addCapture(parsed, device, options);
		await this.afterWrite();
		const chapter = options.chapter ?? parsed.chapter;
		if (result.duplicate_event) {
			this.showToast(
				`Ch. ${chapterText(chapter ?? 0)} is already in the log`,
				{ detail: result.series.title }
			);
		} else if (result.event && chapter) {
			this.showToast(`Logged ch. ${chapterText(chapter)}`, {
				detail: result.series.title,
				action: {
					label: 'Undo',
					run: async () => {
						await repo.deleteEvent(result.event!.id, device);
						await this.afterWrite();
						this.showToast('Chapter removed');
					}
				}
			});
		} else {
			this.showToast('Added to the shelf', {
				detail: result.series.title,
				action: {
					label: 'Open',
					run: () => this.navigate('series', result.series.id)
				}
			});
		}
		return result;
	}

	async addByHand(
		title: string,
		options: { status?: Status; chapter?: number | null } = {}
	): Promise<Series> {
		const device = await this.currentDevice();
		const { series } = await repo.createManualSeries(device, title, {
			status: options.status ?? (options.chapter ? 'reading' : 'plan_to_read')
		});
		if (options.chapter && options.chapter > 0) {
			await repo.logChapter({ seriesId: series.id, chapter: options.chapter }, device);
		}
		await this.afterWrite();
		this.showToast('Added to the shelf', {
			detail: series.title,
			action: { label: 'Open', run: () => this.navigate('series', series.id) }
		});
		return series;
	}

	async plusOne(series: Series): Promise<void> {
		const device = await this.currentDevice();
		try {
			const result = await repo.plusOne(series.id, device);
			await this.afterWrite();
			if (result.duplicate) {
				this.showToast(`Ch. ${chapterText(result.chapter)} is already logged`, {
					detail: series.title
				});
				return;
			}
			this.showToast(`Logged ch. ${chapterText(result.chapter)}`, {
				detail: series.title,
				action: {
					label: 'Undo',
					run: async () => {
						await repo.deleteEvent(result.event.id, device);
						await this.afterWrite();
						this.showToast('Chapter removed');
					}
				}
			});
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not log that chapter.');
		}
	}

	async log(
		seriesId: string,
		chapter: number,
		options: { label?: string; sourceId?: string; chapterUrl?: string } = {}
	): Promise<void> {
		const device = await this.currentDevice();
		try {
			const result = await repo.logChapter(
				{ seriesId, chapter, ...options, method: 'manual' },
				device
			);
			await this.afterWrite();
			if (result.duplicate) {
				this.showToast(`Ch. ${chapterText(chapter)} is already logged`, {
					detail: this.titleById(seriesId)
				});
				return;
			}
			this.showToast(`Logged ch. ${chapterText(chapter)}`, {
				detail: this.titleById(seriesId),
				action: {
					label: 'Undo',
					run: async () => {
						await repo.deleteEvent(result.event.id, device);
						await this.afterWrite();
						this.showToast('Chapter removed');
					}
				}
			});
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not log that chapter.');
		}
	}

	async setField(
		seriesId: string,
		patch: Partial<Record<string, unknown>>,
		message?: string
	): Promise<void> {
		const device = await this.currentDevice();
		const before = this.seriesById(seriesId);
		// Undo restores only the fields this call touched, so a later edit to
		// another field is never rolled back with it.
		const previous: Record<string, unknown> = {};
		if (before) {
			for (const field of Object.keys(patch)) {
				previous[field] = (before as unknown as Record<string, unknown>)[field];
			}
		}
		try {
			await repo.updateSeries(seriesId, patch, device);
			await this.afterWrite();
			if (message) {
				this.showToast(message, {
					detail: this.titleById(seriesId),
					action:
						Object.keys(previous).length > 0
							? {
								label: 'Undo',
								run: async () => {
									await repo.updateSeries(seriesId, previous, device);
									await this.afterWrite();
									this.showToast('Change reverted');
								}
							}
							: undefined
				});
			}
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not save that change.');
		}
	}

	/** Existing rows whose title looks like the one being added. */
	similarSeries(title: string, excludeId?: string): Series[] {
		const candidates = this.liveSeries.filter((row) => row.id !== excludeId);
		return findSimilarSeries(title, candidates).slice(0, 3);
	}

	/** Attaches a capture URL to a row that is already on the shelf. */
	async addToExisting(
		parsed: ParsedCapture,
		seriesId: string,
		options: { chapter?: number | null; chapterLabel?: string; logChapter?: boolean; method?: repo.AddCaptureOptions['method'] } = {}
	): Promise<void> {
		const device = await this.currentDevice();
		const chapter = options.chapter ?? null;
		const log = (options.logChapter ?? true) && chapter !== null && chapter > 0;
		try {
			await repo.attachSourceToSeries(parsed, seriesId, device);
			const logged =
				log && chapter !== null
					? await repo.logChapter(
							{
								seriesId,
								chapter,
								label: options.chapterLabel,
								chapterUrl: parsed.url,
								method: options.method ?? 'manual'
							},
							device
						)
					: null;
			await this.afterWrite();
			this.showToast(
				logged && !logged.duplicate
					? `Logged ch. ${chapterText(chapter ?? 0)}`
					: 'URL attached',
				{
					detail: this.titleById(seriesId),
					action: { label: 'Open', run: () => this.navigate('series', seriesId) }
				}
			);
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not attach that URL.');
		}
	}

	/** Adds a row to the manual reading queue. */
	async queueAdd(series: Series): Promise<void> {
		if (series.queue_rank !== null) return;
		const ranks = this.queue.map((entry) => entry.rank);
		const rank = ranks.length > 0 ? Math.max(...ranks) + 1 : 1;
		await this.setField(series.id, { queue_rank: rank }, 'Added to Up next');
	}

	async queueRemove(series: Series): Promise<void> {
		if (series.queue_rank === null) return;
		await this.setField(series.id, { queue_rank: null }, 'Removed from Up next');
	}

	async toggleQueue(series: Series): Promise<void> {
		if (series.queue_rank === null) await this.queueAdd(series);
		else await this.queueRemove(series);
	}

	/** Swaps a queued row with its neighbour, rewriting both ranks in place. */
	async moveInQueue(seriesId: string, direction: -1 | 1): Promise<void> {
		const list = this.queue;
		const index = list.findIndex((entry) => entry.series.id === seriesId);
		const swap = index + direction;
		if (index < 0 || swap < 0 || swap >= list.length) return;
		const device = await this.currentDevice();
		try {
			await repo.updateSeries(list[index].series.id, { queue_rank: swap + 1 }, device);
			await repo.updateSeries(list[swap].series.id, { queue_rank: index + 1 }, device);
			await this.afterWrite();
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not reorder the queue.');
		}
	}

	/** Moves a queued row onto the Reading shelf and out of the queue. */
	async startQueued(series: Series): Promise<void> {
		await this.setField(
			series.id,
			{ status: 'reading', queue_rank: null },
			`Reading ${series.title}`
		);
		this.navigate('series', series.id);
	}

	/**
	 * Writes one change to many rows: the same stamped field update as a single
	 * edit, so a batch syncs like anything else — but one reload, one undo, and
	 * only rows that actually need the change are touched.
	 */
	private async applyMany(
		seriesIds: string[],
		plan: (row: Series) => Partial<Record<SeriesField, unknown>> | null,
		applied: (count: number) => string,
		undone: string
	): Promise<void> {
		const device = await this.currentDevice();
		const targets: {
			id: string;
			patch: Partial<Record<SeriesField, unknown>>;
			previous: Partial<Record<SeriesField, unknown>>;
		}[] = [];
		for (const id of seriesIds) {
			const row = this.seriesById(id);
			if (!row) continue;
			const patch = plan(row);
			if (!patch) continue;
			const previous: Partial<Record<SeriesField, unknown>> = {};
			for (const field of Object.keys(patch) as SeriesField[]) previous[field] = row[field];
			targets.push({ id, patch, previous });
		}
		if (targets.length === 0) {
			this.showToast('Nothing to change', {
				detail: `${seriesIds.length} selected`
			});
			return;
		}
		const names = targets.map((target) => this.titleById(target.id));
		const detail =
			names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ');
		try {
			for (const target of targets) await repo.updateSeries(target.id, target.patch, device);
			await this.afterWrite();
			this.showToast(applied(targets.length), {
				detail,
				action: {
					label: 'Undo',
					run: async () => {
						for (const target of targets) {
							await repo.updateSeries(target.id, target.previous, device);
						}
						await this.afterWrite();
						this.showToast(undone, { detail });
					}
				}
			});
		} catch (error) {
			// Keep whatever landed visible rather than leaving the shelf stale.
			await this.afterWrite().catch(() => {});
			this.showToast(
				error instanceof Error ? error.message : 'Could not save those changes.'
			);
		}
	}

	/** Moves a whole selection to one shelf, with a single undo for the batch. */
	async setStatusMany(seriesIds: string[], status: Status): Promise<void> {
		await this.applyMany(
			seriesIds,
			(row) => (row.status === status ? null : { status }),
			(count) => `Moved ${count} series to ${STATUS_LABEL[status]}`,
			'Shelves restored'
		);
	}

	/**
	 * Logs the next chapter on every selected series in one pass. Rows already at
	 * their known total are left alone: a batch is no place to push a series past
	 * its last chapter by accident, and the row's own +1 is still there for that.
	 */
	async plusOneMany(seriesIds: string[]): Promise<void> {
		const device = await this.currentDevice();
		const logged: { eventId: string; title: string; chapter: number }[] = [];
		let caughtUp = 0;
		let failed = 0;

		for (const id of seriesIds) {
			const row = this.seriesById(id);
			if (!row) continue;
			const furthest = this.statsFor(row).furthest ?? 0;
			if (row.total_chapters && furthest >= row.total_chapters) {
				caughtUp += 1;
				continue;
			}
			try {
				const result = await repo.plusOne(row.id, device);
				if (!result.duplicate) {
					logged.push({ eventId: result.event.id, title: row.title, chapter: result.chapter });
				}
			} catch {
				failed += 1;
			}
		}

		await this.afterWrite();

		if (logged.length === 0) {
			this.showToast(caughtUp > 0 ? 'Nothing to log' : 'Could not log those chapters', {
				detail:
					caughtUp > 0
						? `${caughtUp} ${caughtUp === 1 ? 'series is' : 'series are'} caught up`
						: undefined
			});
			return;
		}

		const names = logged.map((item) => item.title);
		const detail =
			names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ');
		const extras = [
			caughtUp > 0 ? `${caughtUp} caught up` : '',
			failed > 0 ? `${failed} failed` : ''
		]
			.filter(Boolean)
			.join(' · ');

		this.showToast(`Logged +1 on ${logged.length} ${logged.length === 1 ? 'series' : 'series'}`, {
			detail: extras ? `${detail} · ${extras}` : detail,
			action: {
				label: 'Undo',
				run: async () => {
					for (const item of logged) await repo.deleteEvent(item.eventId, device);
					await this.afterWrite();
					this.showToast(`Removed ${logged.length} chapters`, { detail });
				}
			}
		});
	}

	/** Clears the "check parsing" flag on a selection in one go. */
	async confirmParsingMany(seriesIds: string[]): Promise<void> {
		await this.applyMany(
			seriesIds,
			(row) => (row.needs_review ? { needs_review: false } : null),
			(count) => `Confirmed ${count} ${count === 1 ? 'row' : 'rows'}`,
			'Flags restored'
		);
	}

	/**
	 * Deletes a selection. The rows are tombstoned rather than dropped, so the
	 * single undo puts the series, its URLs and its chapter log back intact.
	 */
	async deleteMany(seriesIds: string[]): Promise<void> {
		const device = await this.currentDevice();
		const rows = seriesIds
			.map((id) => this.seriesById(id))
			.filter((row): row is Series => Boolean(row));
		if (rows.length === 0) return;

		const names = rows.map((row) => row.title);
		const detail =
			names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ');

		try {
			for (const row of rows) await repo.deleteSeries(row.id, device);
			await this.afterWrite();
			this.showToast(`Deleted ${rows.length} ${rows.length === 1 ? 'series' : 'series'}`, {
				detail,
				action: {
					label: 'Undo',
					run: async () => {
						for (const row of rows) await repo.restoreSeries(row.id, device);
						await this.afterWrite();
						this.showToast(
							`Restored ${rows.length} ${rows.length === 1 ? 'series' : 'series'}`,
							{ detail }
						);
					}
				}
			});
		} catch (error) {
			// Whatever was already deleted stays deleted, so refresh before talking.
			await this.afterWrite().catch(() => {});
			this.showToast(error instanceof Error ? error.message : 'Could not delete those series.');
		}
	}

	async removeSeries(seriesId: string): Promise<void> {
		const device = await this.currentDevice();
		const title = this.titleById(seriesId);
		try {
			await repo.deleteSeries(seriesId, device);
			await this.afterWrite();
			this.navigate('library');
			this.showToast('Series deleted', {
				detail: title,
				action: {
					label: 'Undo',
					run: async () => {
						await repo.restoreSeries(seriesId, device);
						await this.afterWrite();
						this.showToast('Series restored', { detail: title });
					}
				}
			});
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not delete that series.');
		}
	}

	async removeChapter(eventId: string): Promise<void> {
		const device = await this.currentDevice();
		const event = this.events.find((row) => row.id === eventId);
		const title = event ? this.titleById(event.series_id) : '';
		const label = event?.chapter_label ?? 'Chapter';
		await repo.deleteEvent(eventId, device);
		await this.afterWrite();
		this.showToast('Chapter removed', {
			detail: title ? `${label} · ${title}` : label,
			action: {
				label: 'Undo',
				run: async () => {
					await repo.restoreEvent(eventId, device);
					await this.afterWrite();
					this.showToast(`${label} restored`, { detail: title });
				}
			}
		});
	}

	async merge(fromId: string, toId: string): Promise<boolean> {
		const device = await this.currentDevice();
		const target = this.titleById(toId);
		try {
			const record = await repo.mergeInto(fromId, toId, device);
			await this.afterWrite();
			this.navigate('series', toId);
			this.showToast('Series merged', {
				detail: target,
				action: {
					label: 'Undo',
					run: async () => {
						await repo.undoMerge(record.id, device);
						await this.afterWrite();
						this.showToast('Merge undone');
					}
				}
			});
			return true;
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not merge those series.');
			return false;
		}
	}

	async undoMerge(mergeId: string): Promise<void> {
		const device = await this.currentDevice();
		try {
			await repo.undoMerge(mergeId, device);
			await this.afterWrite();
			this.showToast('Merge undone');
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not undo that merge.');
		}
	}

	async attachSource(parsed: ParsedCapture, seriesId: string): Promise<void> {
		const device = await this.currentDevice();
		try {
			const result = await repo.attachSourceToSeries(parsed, seriesId, device);
			await this.afterWrite();
			this.showToast(result.already ? 'That URL is already attached' : 'URL attached', {
				detail: parsed.site_label
			});
		} catch (error) {
			this.showToast(error instanceof Error ? error.message : 'Could not attach that URL.');
		}
	}

	async saveSyncSettings(
		endpoint: string,
		token: string,
		deviceLabel: string
	): Promise<{ ok: boolean; message: string }> {
		const previousEndpoint = resolveEndpoint(String(await getMeta('endpoint', '')));
		const nextEndpoint = resolveEndpoint(endpoint);
		await setMeta('endpoint', endpoint.trim());
		await setMeta('token', token.trim());
		const device = await this.currentDevice();
		if (deviceLabel.trim() && deviceLabel.trim() !== device.label) {
			this.device = await repo.setDeviceLabel(deviceLabel, device);
		}
		if (previousEndpoint !== nextEndpoint) {
			await setMeta('last_seq', 0);
			await setMeta('last_sync_at', null);
		}
		await refreshPending();
		if (!token.trim()) {
			syncState.phase = 'local';
			syncState.error = '';
			return { ok: true, message: 'Saved. Local only until you add a token.' };
		}
		const check = await testConnection(endpoint, token);
		if (!check.ok) return { ok: false, message: check.message };

		// A different token is a different log. Switching accounts on a device that
		// still holds unsynced rows would quietly detach those rows, so refuse that
		// until the queue is empty.
		const info = await pingAccount(endpoint, token);
		if (info.ok && info.data) {
			const previousId = await getMeta<string | null>('account_id', null);
			if (previousId && previousId !== info.data.id) {
				const waiting = await pendingCount();
				if (waiting > 0) {
					return {
						ok: false,
						message: `That token belongs to a different account, and ${waiting} local ${waiting === 1 ? 'change is' : 'changes are'} still waiting to sync. Export or reconnect the old account first.`
					};
				}
				const savedEndpoint = endpoint.trim();
				const savedToken = token.trim();
				await wipeLocalDatabase();
				await setMeta('endpoint', savedEndpoint);
				await setMeta('token', savedToken);
				await setMeta('last_seq', 0);
				await setMeta('last_sync_at', null);
				await setMeta('share_token', null);
				this.shareToken = null;
				this.device = null;
			}
			this.account = info.data;
			await setMeta('account_id', info.data.id);
		}

		const outcome = await syncNow();
		return {
			ok: outcome.ok,
			message: outcome.ok
				? info.data
					? `Connected as ${info.data.username} and synced.`
					: 'Connected and synced.'
				: outcome.message ?? 'Sync failed.'
		};
	}

	/**
	 * Creates an account on the configured Worker, saves its token and connects.
	 * The token is returned once by the server; it lives in this browser only.
	 */
	async createAccount(
		username: string,
		invite = ''
	): Promise<{ ok: boolean; message: string; token?: string }> {
		const endpoint = String((await getMeta('endpoint', '')) ?? '');
		const result = await createAccountRequest(endpoint, username, invite);
		if (!result.ok || !result.data) return { ok: false, message: result.message };
		const saved = await this.saveSyncSettings(
			endpoint,
			result.data.token,
			this.device?.label ?? ''
		);
		return {
			ok: saved.ok,
			message: saved.ok ? `${result.message} ${saved.message}`.trim() : saved.message,
			token: result.data.token
		};
	}

	async exportJson(): Promise<void> {
		const data = await repo.exportData();
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		const stamp = new Date().toISOString().slice(0, 10);
		anchor.href = url;
		anchor.download = `yomi-${stamp}.json`;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);
		this.showToast('Export downloaded', {
			detail: `${data.series.length} series · ${data.events.length} chapters`
		});
	}

	async importJson(payload: unknown): Promise<void> {
		const counts = await repo.importData(payload);
		await this.afterWrite();
		this.showToast('Import complete', {
			detail: `${counts.series} series · ${counts.events} chapters`
		});
	}

	async wipeLocal(): Promise<void> {
		await wipeLocalDatabase();
		window.location.reload();
	}

	async copy(text: string, label = 'Copied'): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			this.showToast(label);
		} catch {
			this.showToast('Could not copy. Select the text instead.');
		}
	}

	async promptInstall(): Promise<void> {
		if (!this.installEvent) return;
		await this.installEvent.prompt();
		await this.installEvent.userChoice;
		this.installEvent = null;
		this.canInstall = false;
	}

	lastSyncLabel(): string {
		return relativeTime(syncState.lastSyncAt, this.now);
	}

	async pendingNow(): Promise<void> {
		syncState.pending = await pendingCount();
	}
}

export const app = new AppStore();

/** Status labels are used in several screens; keep the vocabulary in one place. */
export function statusLabel(status: Status): string {
	return STATUS_LABEL[status];
}
