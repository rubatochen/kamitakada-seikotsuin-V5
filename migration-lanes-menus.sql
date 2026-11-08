-- V17: lanes (枠) and treatment menus.
-- The Worker applies these steps automatically on first request
-- (functions/lib/schema.js). Run this by hand only if you prefer to migrate
-- before deploying:
--   npx wrangler d1 execute <DB名> --remote --file=migration-lanes-menus.sql
-- If a column already exists, that line reports "duplicate column"; that is fine.

ALTER TABLE appointments ADD COLUMN menu_id TEXT NOT NULL DEFAULT 'seikotsu';
ALTER TABLE appointments ADD COLUMN lane_id TEXT NOT NULL DEFAULT 'L1';
DROP INDEX IF EXISTS idx_active_slot;
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_slot_lane ON appointments(date, time, lane_id) WHERE status = 'confirmed';
ALTER TABLE breaks ADD COLUMN lane_id TEXT;
