DROP INDEX IF EXISTS links_user_idx;
ALTER TABLE links DROP COLUMN IF EXISTS user_id;
-- Dropping the column takes its CHECK constraint with it.
ALTER TABLE admin_users DROP COLUMN IF EXISTS role;
