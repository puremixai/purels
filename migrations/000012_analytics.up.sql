-- Analytics provider settings, as data rather than environment variables.
--
-- These are deployment-wide values an operator changes without a redeploy, and
-- they are not secrets: a GA4 measurement id or a Matomo site id is visible in
-- any page's source. So they live in a row the console edits, the same way the
-- sign-in providers do.
--
-- One row with four columns rather than a generic provider table, because
-- exactly three providers are supported and each has a fixed shape. "Empty
-- means off" already expresses enablement, so there is no enabled column: a
-- second source of truth for the same fact would eventually disagree with the
-- first.
--
-- There are deliberately no format CHECKs on the value columns. A constraint
-- duplicating a validation regex is a second definition of the same rule and
-- the two drift; worse, a 23514 is not mapped by normalizeDBError, so a
-- violation would leak the constraint text to the client. The authoritative
-- check is in the service, and the render side validates again before it
-- interpolates anything into a script.
CREATE TABLE IF NOT EXISTS analytics_settings (
  id                 smallint    PRIMARY KEY DEFAULT 1,
  ga4_measurement_id text,
  gtm_container_id   text,
  matomo_url         text,
  matomo_site_id     text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- The singleton guard. No caller can reach this column, so unlike the value
  -- columns it is safe as a constraint: it cannot produce a 23514 that the
  -- service failed to predict.
  CONSTRAINT analytics_settings_singleton CHECK (id = 1)
);

-- The row is created here rather than by the application, so a read never has
-- to handle "no row yet" and the console's first save is an UPDATE.
INSERT INTO analytics_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Grant the new capability to the existing admin row. 000009 seeded the presets
-- with ON CONFLICT DO NOTHING, so re-running it never updates a row that
-- already exists — without this the console cannot reach the new screen at all.
UPDATE roles SET scopes = scopes || '["analytics:manage"]'::jsonb, updated_at = now()
 WHERE name = 'admin' AND NOT scopes @> '["analytics:manage"]'::jsonb;
