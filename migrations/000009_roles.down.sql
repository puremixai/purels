-- Back to the two-value role domain.
--
-- This is lossy and cannot be undone by a later `up`: the operator and readonly
-- distinction, and any per-role scope customisation, are gone. Accounts in the
-- new roles are narrowed to 'user' rather than failing the migration, because
-- narrowing removes access while leaving them unmatched would lock the accounts
-- out of every scope they hold.
UPDATE admin_users SET role = 'user' WHERE role IN ('operator','readonly');

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_fk;
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check CHECK (role IN ('admin','user'));

DROP INDEX IF EXISTS admin_users_role_idx;
DROP TABLE IF EXISTS roles;
