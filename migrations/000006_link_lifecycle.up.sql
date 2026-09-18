-- Link lifecycle: destination health-check results, plus the indexes the two
-- background sweeps need.

-- Outcome of the last probe. NULL last_checked_at means the link has never
-- been checked; a last_status_code of 0 records a probe that could not reach
-- the destination at all. These are metadata about a probe, not an edit, so
-- they deliberately do not touch updated_at.
ALTER TABLE links ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE links ADD COLUMN IF NOT EXISTS last_status_code int;

-- Both sweeps run over the whole table on a timer, so each gets an index
-- instead of a sequential scan. The predicates match the sweep queries exactly
-- (partial indexes are only used when the query repeats the predicate).
CREATE INDEX IF NOT EXISTS links_expires_idx ON links(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS links_health_idx ON links(last_checked_at) WHERE deleted_at IS NULL AND status = 'active';
