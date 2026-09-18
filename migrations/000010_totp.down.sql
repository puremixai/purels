-- Reverses 000010_totp.
--
-- LOSSY: dropping totp_secret discards every enrolment, and the secrets cannot
-- be recovered by re-running the up migration because the encryption key is not
-- stored in the database. Re-enrolling is the only path back.
DROP INDEX IF EXISTS mfa_recovery_codes_user_idx;
DROP TABLE IF EXISTS mfa_recovery_codes;
DROP INDEX IF EXISTS mfa_challenges_expires_idx;
DROP TABLE IF EXISTS mfa_challenges;
ALTER TABLE admin_users DROP COLUMN IF EXISTS totp_confirmed_at;
ALTER TABLE admin_users DROP COLUMN IF EXISTS totp_secret;
