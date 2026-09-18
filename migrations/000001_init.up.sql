CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username varchar(128) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  csrf_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  user_agent varchar(512),
  ip_hash bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_active_idx ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  name varchar(128) NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  token_prefix varchar(16) NOT NULL,
  scopes jsonb NOT NULL DEFAULT '["links:read","links:write","stats:read"]'::jsonb,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id);

CREATE TABLE IF NOT EXISTS links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias varchar(64) COLLATE "C" NOT NULL UNIQUE,
  destination_url text NOT NULL,
  redirect_code smallint NOT NULL DEFAULT 302 CHECK (redirect_code IN (301,302)),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleted')),
  version bigint NOT NULL DEFAULT 1,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT links_destination_length CHECK (char_length(destination_url) <= 8192)
);
CREATE INDEX IF NOT EXISTS links_created_at_idx ON links(created_at DESC);
CREATE INDEX IF NOT EXISTS links_active_idx ON links(status, created_at DESC);

CREATE TABLE IF NOT EXISTS click_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ip_hash bytea,
  user_agent varchar(512),
  referrer varchar(2048),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS click_events_link_time_idx ON click_events(link_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS click_events_pending_idx ON click_events(occurred_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS click_events_time_brin ON click_events USING BRIN(occurred_at);

CREATE TABLE IF NOT EXISTS link_click_daily (
  link_id uuid NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  day date NOT NULL,
  clicks bigint NOT NULL DEFAULT 0,
  PRIMARY KEY(link_id, day)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  action varchar(64) NOT NULL,
  resource_type varchar(64),
  resource_id uuid,
  metadata jsonb,
  ip_hash bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at DESC);
