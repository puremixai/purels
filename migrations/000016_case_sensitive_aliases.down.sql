-- This rollback is intentionally strict: it fails if rows that differ only by
-- case were created after the forward migration, rather than silently deleting
-- one of those links.
DROP INDEX IF EXISTS links_alias_idx;
CREATE UNIQUE INDEX IF NOT EXISTS links_alias_lower_idx ON links (lower(alias));
