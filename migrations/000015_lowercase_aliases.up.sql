-- Link aliases are case-insensitive at the HTTP boundary. Normalize rows that
-- predate the application-side canonicalization so the lower-cased resolver,
-- the unique lower(alias) index and the Redis cache all agree.
UPDATE links
SET alias = lower(alias)
WHERE alias <> lower(alias);
