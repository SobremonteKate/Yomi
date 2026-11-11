-- Adds the synopsis column to a database created from an older schema.sql.
-- Fresh databases already get it from schema.sql, so run this once per
-- existing database and then deploy:
--
--   npx wrangler d1 execute yomi --local  --file ./worker/migrations/0001-series-description.sql
--   npx wrangler d1 execute yomi --remote --file ./worker/migrations/0001-series-description.sql
--
-- Older clients keep syncing safely: a row without a description decodes as ''.

ALTER TABLE series ADD COLUMN description TEXT NOT NULL DEFAULT '';
