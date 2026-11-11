import type { Device, MergeRecord, ProgressEvent, Series, Source } from './model.ts';
import type { ParsedCapture } from './parse.ts';

export type ChangeKind = 'series' | 'source' | 'event' | 'merge';

export interface ChangeRow {
	seq: number;
	kind: ChangeKind;
	row: Series | Source | ProgressEvent | MergeRecord;
}

export interface SyncPush {
	series: Series[];
	sources: Source[];
	events: ProgressEvent[];
	merges: MergeRecord[];
}

export interface SyncRequest {
	since: number;
	device: Device;
	push: SyncPush;
}

export interface SyncResponse {
	ok: true;
	cursor: number;
	hasMore: boolean;
	changes: ChangeRow[];
	conflicts: {
		sources: Source[];
		events: ProgressEvent[];
	};
	accepted: {
		series: string[];
		sources: string[];
		events: string[];
		merges: string[];
	};
	/** Rows intentionally left alone; the client keeps them queued. */
	deferred: {
		sources: string[];
		events: string[];
	};
	server_time: string;
}

export interface SyncError {
	ok: false;
	error: string;
	detail?: string;
}

export interface IngestRequest {
	url: string;
	title?: string | null;
	heading?: string | null;
	breadcrumb?: string | null;
	label?: string | null;
	chapter?: number | string | null;
	volume?: number | string | null;
	cover_url?: string | null;
	method?: string;
}

export interface IngestResponse {
	ok: true;
	series: {
		id: string;
		title: string;
		status: string;
		total_chapters: number | null;
		cover_url: string | null;
		needs_review: boolean;
	};
	event: {
		id: string;
		chapter: number;
		chapter_label: string;
		read_at: string;
	} | null;
	created_series: boolean;
	duplicate: boolean;
	captured: {
		chapter: number | null;
		chapter_label: string;
		title: string | null;
		site: string;
		confidence: ParsedCapture['confidence'];
	};
	cursor: number;
}

export interface AccountInfo {
	id: string;
	username: string;
	legacy: boolean;
}

export interface PingResponse {
	ok: true;
	time: string;
	cursor: number;
	schema: number;
	account: AccountInfo;
}

export interface SignupResponse {
	ok: true;
	token: string;
	account: { id: string; username: string };
}

export interface ShareCreateResponse {
	ok: true;
	token: string;
	created_at: string;
}

/** What a read-only share link exposes. Notes are stripped by the Worker. */
export interface ShareViewResponse {
	ok: true;
	username: string;
	shared_at: string;
	series: Series[];
	sources: Source[];
	events: ProgressEvent[];
	merges: MergeRecord[];
}

export interface ExportResponse {
	ok: true;
	exported_at: string;
	series: Series[];
	sources: Source[];
	events: ProgressEvent[];
	merges: MergeRecord[];
}
