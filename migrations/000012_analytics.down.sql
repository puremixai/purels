-- Reverses 000012_analytics.
--
-- LOSSY, though in a narrower way than 000011: the four ids are pure
-- configuration, so dropping the table loses them, and re-running the up
-- migration brings back an empty row rather than the values. Nothing else is
-- affected — no account depends on an analytics id, so there is no
-- stranded-account warning to give here.
DROP TABLE IF EXISTS analytics_settings;

-- Reverse the grant, but only for admin: that is the one row the up migration
-- touched. A grant an operator made to some other role is left alone, because
-- this migration cannot tell it apart from one that was already there.
UPDATE roles SET scopes = scopes - 'analytics:manage', updated_at = now()
 WHERE name = 'admin' AND scopes @> '["analytics:manage"]'::jsonb;
