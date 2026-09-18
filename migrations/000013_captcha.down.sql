-- Reverses 000013_captcha.
--
-- LOSSY: dropping this table loses the site key, encrypted secret, expected
-- hostname and action. Re-running the up migration creates a fresh disabled
-- row. No account depends on these settings, so no accounts are stranded.
DROP TABLE IF EXISTS captcha_settings;

-- Only the admin row was changed by the up migration. A grant made manually on
-- another role is intentionally preserved.
UPDATE roles SET scopes = scopes - 'captcha:manage', updated_at = now()
 WHERE name = 'admin' AND scopes @> '["captcha:manage"]'::jsonb;
