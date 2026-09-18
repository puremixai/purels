-- OIDC as an additional sign-in method.
--
-- Password login stays the primary path; OIDC is an extra door, configured in
-- the console rather than in environment variables. That is why providers are
-- rows and not config: an operator adds one by signing in with the bootstrap
-- password and filling in a form.

-- A provider is one external identity provider.
CREATE TABLE IF NOT EXISTS oidc_providers (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The slug appears in the callback path the operator registers at the IdP
  -- (/api/v1/auth/oidc/{slug}/callback), so it is chosen by a human and must
  -- never change afterwards: editing it silently invalidates that registration.
  slug           varchar(32) NOT NULL,
  display_name   varchar(128) NOT NULL,
  issuer         text        NOT NULL,
  client_id      text        NOT NULL,
  -- SecretBox ciphertext. NULL means a public client that authenticates with
  -- PKCE alone, which is a legitimate configuration and not an error.
  client_secret  bytea,
  scopes         jsonb       NOT NULL DEFAULT '["openid","profile","email"]'::jsonb,
  -- Whether a first-time sign-in may create an account. Default on, because
  -- otherwise every new colleague needs a local account made for them first.
  auto_provision boolean     NOT NULL DEFAULT true,
  enabled        boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- These constraints are a backstop, not the validation layer: PostgreSQL
  -- reports a CHECK violation as SQLSTATE 23514, which normalizeDBError does
  -- not map, so the raw constraint text would reach the client. The service
  -- validates first and these only catch a bug that got past it.
  CONSTRAINT oidc_providers_slug_check   CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  CONSTRAINT oidc_providers_issuer_check CHECK (issuer ~ '^https?://'),
  CONSTRAINT oidc_providers_scopes_check CHECK (jsonb_typeof(scopes) = 'array'),
  CONSTRAINT oidc_providers_slug_key     UNIQUE (slug)
);

-- The login page asks for the enabled ones on every visit, and the table is
-- tiny, so a partial index is enough and keeps the disabled rows out of it.
CREATE INDEX IF NOT EXISTS oidc_providers_enabled_idx ON oidc_providers(enabled) WHERE enabled;

-- An external identity: the account is what it is bound to, the identity is
-- (provider, subject). Deliberately no unique index on email — claiming an
-- existing account by matching an email address is an account-takeover vector,
-- because email ownership is asserted by the IdP and not by us.
CREATE TABLE IF NOT EXISTS oidc_identities (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid        NOT NULL,
  user_id       uuid        NOT NULL,
  subject       text        NOT NULL,
  email         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  CONSTRAINT oidc_identities_provider_fk FOREIGN KEY (provider_id) REFERENCES oidc_providers(id) ON DELETE CASCADE,
  CONSTRAINT oidc_identities_user_fk     FOREIGN KEY (user_id)     REFERENCES admin_users(id)   ON DELETE CASCADE,
  -- The lookup that runs on every callback, and the constraint that makes
  -- auto-provisioning safe under concurrent callbacks: the loser of the race
  -- gets 23505 and re-reads the winner's row instead of creating a second
  -- account.
  CONSTRAINT oidc_identities_provider_subject_key UNIQUE (provider_id, subject)
);
CREATE INDEX IF NOT EXISTS oidc_identities_user_idx ON oidc_identities(user_id);

-- An authorization request in flight: the server-side half of the state cookie.
-- It lives in Postgres rather than Redis for the same reason mfa_challenges
-- does — Redis is a fail-open cache here, and a cache outage must not be able to
-- turn into "skip the state check" or "nobody can sign in". Claimed exactly
-- once, before the code is exchanged, so a replayed callback cannot retry.
CREATE TABLE IF NOT EXISTS oidc_auth_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid        NOT NULL,
  -- The state value itself is only ever in the cookie; this is its hash, so a
  -- leaked database dump is not a set of usable states.
  state_hash    bytea       NOT NULL,
  nonce         text        NOT NULL,
  code_verifier bytea       NOT NULL,   -- SecretBox ciphertext
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oidc_auth_requests_provider_fk FOREIGN KEY (provider_id) REFERENCES oidc_providers(id) ON DELETE CASCADE,
  CONSTRAINT oidc_auth_requests_state_key   UNIQUE (state_hash)
);

-- Expired rows are swept when a new request is inserted, so this index is what
-- keeps that sweep cheap.
CREATE INDEX IF NOT EXISTS oidc_auth_requests_expires_idx ON oidc_auth_requests(expires_at);

-- Grant the new capability to the existing admin row.
--
-- 000009 inserted the preset roles with ON CONFLICT DO NOTHING, so re-running it
-- does not update a row that already exists. Without this statement the console
-- has no way to reach the new screen and OIDC cannot be configured at all.
UPDATE roles SET scopes = scopes || '["oidc:manage"]'::jsonb, updated_at = now()
 WHERE name = 'admin' AND NOT scopes @> '["oidc:manage"]'::jsonb;
