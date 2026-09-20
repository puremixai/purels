-- Runtime business and operations settings. The row is intentionally not
-- inserted here: the first API/worker boot seeds it from the existing env
-- values, so migrating an installation preserves its current behaviour.
CREATE TABLE IF NOT EXISTS runtime_settings (
  id                              smallint PRIMARY KEY DEFAULT 1,
  alias_mode                      varchar(16) NOT NULL,
  unique_urls                     boolean NOT NULL,
  registration_enabled            boolean NOT NULL,
  count_bots                      boolean NOT NULL,
  forward_query                   boolean NOT NULL,
  fallback_url                    text NOT NULL DEFAULT '',
  auto_prune_expired              boolean NOT NULL,
  prune_grace_seconds             bigint NOT NULL,
  max_links_per_user              integer NOT NULL,
  destination_denylist            text[] NOT NULL DEFAULT '{}',
  short_domains                   text[] NOT NULL DEFAULT '{}',
  health_check_enabled            boolean NOT NULL,
  health_check_interval_seconds   bigint NOT NULL,
  rate_limit_enabled              boolean NOT NULL,
  rate_limit_login                integer NOT NULL,
  rate_limit_api                  integer NOT NULL,
  rate_limit_redirect             integer NOT NULL,
  rate_limit_register             integer NOT NULL,
  rate_limit_2fa                  integer NOT NULL,
  rate_limit_oidc                 integer NOT NULL,
  revision                        bigint NOT NULL DEFAULT 1,
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runtime_settings_singleton CHECK (id = 1)
);

-- The existing administrator role must be able to recover and edit the new
-- settings after the migration. Other roles remain unchanged until an
-- operator grants the capability explicitly.
UPDATE roles
SET scopes = CASE
  WHEN scopes @> '["settings:manage"]'::jsonb THEN scopes
  ELSE scopes || '["settings:manage"]'::jsonb
END,
updated_at = now()
WHERE name = 'admin';
