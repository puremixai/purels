-- Registration CAPTCHA settings. The provider is deliberately fixed in the
-- application to Cloudflare Turnstile: no operator-controlled verification URL
-- can turn this anti-abuse check into an SSRF primitive.
--
-- The secret is encrypted with SECRET_ENCRYPTION_KEY before it reaches this
-- table. The public site key is returned separately; the secret never is.
CREATE TABLE IF NOT EXISTS captcha_settings (
  id                smallint    PRIMARY KEY DEFAULT 1,
  provider          text        NOT NULL DEFAULT 'turnstile',
  enabled           boolean     NOT NULL DEFAULT false,
  site_key          text,
  secret            bytea,
  expected_hostname text,
  expected_action   text,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT captcha_settings_singleton CHECK (id = 1),
  CONSTRAINT captcha_settings_provider_check CHECK (provider = 'turnstile')
);

INSERT INTO captcha_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 000009 seeded roles with ON CONFLICT DO NOTHING, so it cannot add a new
-- capability to the existing admin row on a later migration.
UPDATE roles SET scopes = scopes || '["captcha:manage"]'::jsonb, updated_at = now()
 WHERE name = 'admin' AND NOT scopes @> '["captcha:manage"]'::jsonb;
