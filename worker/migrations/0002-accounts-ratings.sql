-- 0002: real accounts (one log per person) plus ratings and tags.
--
-- Every row gains an owner. Rows written before accounts existed belong to the
-- single legacy owner, so an existing deployment keeps its shelf and its
-- SYNC_TOKEN keeps working. The source table is rebuilt because its old
-- UNIQUE(site, normalized_path) would stop two people sharing a chapter URL.

ALTER TABLE series ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE series ADD COLUMN rating REAL;
ALTER TABLE series ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';

ALTER TABLE progress_event ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE merge_record ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE device ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE source ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy';

CREATE TABLE source_accounted (
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
INSERT INTO source_accounted
	(id, user_id, series_id, site, url, normalized_path, site_title, adapter_version,
	 first_seen_at, last_seen_at, updated_at, device_id, deleted_at, field_ts, seq)
SELECT
	id, user_id, series_id, site, url, normalized_path, site_title, adapter_version,
	first_seen_at, last_seen_at, updated_at, device_id, deleted_at, field_ts, seq
FROM source;
DROP TABLE source;
ALTER TABLE source_accounted RENAME TO source;

CREATE INDEX IF NOT EXISTS idx_source_seq ON source (seq);
CREATE INDEX IF NOT EXISTS idx_source_series ON source (series_id);
CREATE INDEX IF NOT EXISTS idx_source_user_seq ON source (user_id, seq);

CREATE INDEX IF NOT EXISTS idx_series_user_seq ON series (user_id, seq);
CREATE INDEX IF NOT EXISTS idx_event_user_seq ON progress_event (user_id, seq);
CREATE INDEX IF NOT EXISTS idx_merge_user_seq ON merge_record (user_id, seq);

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
