-- TOTP two-factor authentication.
--
-- The secret is stored encrypted (AES-256-GCM, key from TOTP_ENCRYPTION_KEY)
-- rather than hashed, because verifying a code needs the original value. The
-- consequence is worth stating plainly: losing the key makes every enrolled
-- account unable to sign in, and the only way back is an administrator reset.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_secret bytea;

-- NULL means "not enrolled". Enrolment writes the secret immediately but leaves
-- this unset until the operator has proved they can produce a code from it, so
-- an abandoned enrolment is inert: an unconfirmed secret never takes part in a
-- login decision.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS totp_confirmed_at timestamptz;

-- A half-session: what a correct password earns when a second factor is due.
-- It lives in Postgres rather than Redis for the same reason sessions do —
-- Redis is a fail-open cache here, and a cache outage must not be able to either
-- skip the second factor or lock everybody out.
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash  bytea       NOT NULL UNIQUE,
  -- The attempt counter is the real brute-force bound. The rate limiter is
  -- fail-open, so a counter inside the row is the only limit that holds when
  -- Redis is unavailable; it is incremented in the same statement that reads the
  -- row, so concurrent guesses cannot each see a fresh counter.
  attempts    int         NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Expired rows are swept when a new challenge is inserted, so this index is what
-- keeps that sweep cheap.
CREATE INDEX IF NOT EXISTS mfa_challenges_expires_idx ON mfa_challenges(expires_at);

-- Recovery codes are credentials, so they are hashed like passwords and spent
-- exactly once. ON DELETE CASCADE takes them with the account.
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  code_hash  bytea       NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Listing and clearing one account's codes is the only query that runs.
CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx ON mfa_recovery_codes(user_id);
