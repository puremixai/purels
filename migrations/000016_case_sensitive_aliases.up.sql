-- Link aliases are case-sensitive again. The old lower(alias) index would
-- reject distinct aliases such as "AbCdE" and "abcde" and is no longer the
-- invariant enforced by the application or Redis cache. The original links
-- table already has a case-sensitive UNIQUE constraint on alias.
DROP INDEX IF EXISTS links_alias_lower_idx;
