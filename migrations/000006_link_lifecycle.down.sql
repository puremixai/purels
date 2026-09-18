DROP INDEX IF EXISTS links_health_idx;
DROP INDEX IF EXISTS links_expires_idx;
ALTER TABLE links DROP COLUMN IF EXISTS last_status_code;
ALTER TABLE links DROP COLUMN IF EXISTS last_checked_at;
