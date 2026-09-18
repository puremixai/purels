-- Reverses 000011_oidc.
--
-- LOSSY, in a way worth spelling out before running it:
--
--   * Every provider and every identity binding is dropped. The providers are
--     re-enterable from the console, but their client secrets are encrypted with
--     a key that is not stored in the database, so the ciphertext cannot be
--     recovered — each one has to be pasted in again.
--   * Accounts created by auto-provisioning are NOT deleted. They stay in
--     admin_users with password_hash = '!oidc' and no identity row, and the
--     application has no password-change screen, so they are unreachable. This
--     is the reason disabling a provider is the normal operation and deleting
--     one is the deliberate exception. Re-running the up migration does not
--     bring them back either; the accounts have to be removed by hand.
--
-- Order matters only for readability here: the foreign keys cascade, so dropping
-- the providers would take the other two tables with it.
DROP INDEX IF EXISTS oidc_auth_requests_expires_idx;
DROP TABLE IF EXISTS oidc_auth_requests;
DROP INDEX IF EXISTS oidc_identities_user_idx;
DROP TABLE IF EXISTS oidc_identities;
DROP INDEX IF EXISTS oidc_providers_enabled_idx;
DROP TABLE IF EXISTS oidc_providers;

-- Reverse the grant, but only for admin: that is the one row the up migration
-- touched. A grant an operator made to some other role is left alone, because
-- this migration cannot tell it apart from one that was already there.
UPDATE roles SET scopes = scopes - 'oidc:manage', updated_at = now()
 WHERE name = 'admin' AND scopes @> '["oidc:manage"]'::jsonb;
