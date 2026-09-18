-- Bot marking, a bot subset counter, and case-insensitive aliases.

-- Bots are tagged at ingestion rather than dropped: keeping the event means
-- COUNT_BOTS is a read-time switch instead of a decision that has to be made
-- before the data exists.
ALTER TABLE click_events ADD COLUMN IF NOT EXISTS is_bot boolean NOT NULL DEFAULT false;

-- The subset of `clicks` that came from bots. It is maintained on every rollup
-- so "exclude bots" never has to recompute history.
ALTER TABLE link_click_daily ADD COLUMN IF NOT EXISTS bot_clicks bigint NOT NULL DEFAULT 0;

-- Backfill. The marker list mirrors security.IsBotUA and the CASE that used to
-- live in the device breakdown; this statement runs once.
UPDATE click_events SET is_bot = true
WHERE user_agent ILIKE '%bot%' OR user_agent ILIKE '%crawler%' OR user_agent ILIKE '%spider%'
   OR user_agent ILIKE '%curl/%' OR user_agent ILIKE '%wget%';

UPDATE link_click_daily d SET bot_clicks = COALESCE((
  SELECT COUNT(*) FROM click_events e
  WHERE e.link_id = d.link_id AND e.occurred_at::date = d.day AND e.is_bot), 0);

-- Aliases become case-insensitive. The index is created first on purpose: if two
-- existing rows differ only in case it fails here, before anything has been
-- rewritten, so the operator resolves the clash and re-runs with no partial
-- state to unpick.
CREATE UNIQUE INDEX IF NOT EXISTS links_alias_lower_idx ON links (lower(alias));
UPDATE links SET alias = lower(alias) WHERE alias <> lower(alias);
