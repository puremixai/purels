-- Dropping the columns discards the two ids. That is the point of a down
-- migration here: the values are configuration, not data, and an operator who
-- rolls back to a binary that cannot read them has no use for them.
ALTER TABLE analytics_settings DROP COLUMN IF EXISTS clarity_project_id;
ALTER TABLE analytics_settings DROP COLUMN IF EXISTS google_tag_id;
