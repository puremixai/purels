-- The alias case folding is not reversible: the original casing is gone.
DROP INDEX IF EXISTS links_alias_lower_idx;
ALTER TABLE link_click_daily DROP COLUMN IF EXISTS bot_clicks;
ALTER TABLE click_events DROP COLUMN IF EXISTS is_bot;
