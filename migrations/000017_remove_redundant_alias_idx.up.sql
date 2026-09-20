-- links_alias_key from the initial schema is already the case-sensitive
-- uniqueness constraint. Remove the duplicate index created by the first
-- version of migration 000016.
DROP INDEX IF EXISTS links_alias_idx;
