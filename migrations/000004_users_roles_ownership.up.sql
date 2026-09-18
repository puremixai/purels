-- Accounts, roles and link ownership.
--
-- The account table keeps its original name: renaming it would mean touching
-- the sessions, api_tokens and audit_logs foreign keys and every query that
-- joins them, for no behavioural gain.

-- The CHECK travels with the column, so a re-run is skipped by IF NOT EXISTS
-- rather than failing on a duplicate constraint name.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role varchar(16) NOT NULL DEFAULT 'user'
  CHECK (role IN ('admin','user'));

-- Every account that existed before this migration was an administrator: the
-- application only ever created the bootstrap one. On a fresh database
-- admin_users is empty at this point, so this affects no rows and the
-- administrator is inserted explicitly by CreateAdminIfMissing.
UPDATE admin_users SET role = 'admin';

-- Usernames are case-insensitive from now on: registration and login both
-- lower-case at the service boundary, and this makes the stored rows satisfy
-- the same invariant. Duplicates that differ only in case abort the migration,
-- which is the intended loud failure — the operator has to resolve them.
UPDATE admin_users SET username = lower(username) WHERE username <> lower(username);

-- Link ownership. Links created before this migration keep user_id NULL, which
-- makes them visible to administrators only.
ALTER TABLE links ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES admin_users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS links_user_idx ON links(user_id);
