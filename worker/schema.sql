-- Yomi D1 schema. Run once per fresh database:
--   npx wrangler d1 execute yomi --remote --file ./worker/schema.sql
-- Existing databases use the numbered files in ./worker/migrations instead.

CREATE TABLE IF NOT EXISTS counter (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	seq INTEGER NOT NULL
);
INSERT OR IGNORE INTO counter (id, seq) VALUES (1, 0);

-- One row per person. The bearer token itself is never stored, only its digest.
CREATE TABLE IF NOT EXISTS account (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL,
	username_key TEXT NOT NULL UNIQUE,
	token_hash TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL,
	last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS share_link (
	token TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	created_at TEXT NOT NULL,
	revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_share_user ON share_link (user_id);

CREATE TABLE IF NOT EXISTS series (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL DEFAULT 'legacy',
	title TEXT NOT NULL,
	alt_titles TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL DEFAULT 'plan_to_read',
	total_chapters REAL,
	cover_url TEXT,
	description TEXT NOT NULL DEFAULT '',
	rating REAL,
	tags TEXT NOT NULL DEFAULT '[]',
	notes TEXT NOT NULL DEFAULT '',
	queue_rank REAL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	device_id TEXT NOT NULL,
	deleted_at TEXT,
	needs_review INTEGER NOT NULL DEFAULT 0,
	field_ts TEXT NOT NULL DEFAULT '{}',
	seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_series_seq ON series (seq);
CREATE INDEX IF NOT EXISTS idx_series_user_seq ON series (user_id, seq);

CREATE TABLE IF NOT EXISTS source (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL DEFAULT 'legacy',
	series_id TEXT NOT NULL,
	site TEXT NOT NULL,
	url TEXT NOT NULL DEFAULT '',
	normalized_path TEXT NOT NULL,
	site_title TEXT NOT NULL DEFAULT '',
	adapter_version TEXT NOT NULL DEFAULT 'generic-1',
	first_seen_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	device_id TEXT NOT NULL,
	deleted_at TEXT,
	field_ts TEXT NOT NULL DEFAULT '{}',
	seq INTEGER NOT NULL,
	UNIQUE (user_id, site, normalized_path)
);
CREATE INDEX IF NOT EXISTS idx_source_seq ON source (seq);
CREATE INDEX IF NOT EXISTS idx_source_series ON source (series_id);
CREATE INDEX IF NOT EXISTS idx_source_user_seq ON source (user_id, seq);

CREATE TABLE IF NOT EXISTS progress_event (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL DEFAULT 'legacy',
	series_id TEXT NOT NULL,
	source_id TEXT NOT NULL,
	chapter REAL NOT NULL,
	chapter_label TEXT NOT NULL DEFAULT '',
	volume REAL,
	chapter_url TEXT NOT NULL DEFAULT '',
	read_at TEXT NOT NULL,
	device_id TEXT NOT NULL,
	method TEXT NOT NULL DEFAULT 'manual',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	deleted_at TEXT,
	field_ts TEXT NOT NULL DEFAULT '{}',
	seq INTEGER NOT NULL,
	UNIQUE (series_id, chapter, source_id)
);
CREATE INDEX IF NOT EXISTS idx_event_seq ON progress_event (seq);
CREATE INDEX IF NOT EXISTS idx_event_series ON progress_event (series_id);
CREATE INDEX IF NOT EXISTS idx_event_user_seq ON progress_event (user_id, seq);

CREATE TABLE IF NOT EXISTS merge_record (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL DEFAULT 'legacy',
	from_series_id TEXT NOT NULL,
	to_series_id TEXT NOT NULL,
	moved_source_ids TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL,
	device_id TEXT NOT NULL,
	undone_at TEXT,
	updated_at TEXT NOT NULL,
	seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_merge_seq ON merge_record (seq);
CREATE INDEX IF NOT EXISTS idx_merge_user_seq ON merge_record (user_id, seq);

CREATE TABLE IF NOT EXISTS device (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL DEFAULT 'legacy',
	label TEXT NOT NULL DEFAULT '',
	platform TEXT NOT NULL DEFAULT '',
	last_sync_at TEXT
);
