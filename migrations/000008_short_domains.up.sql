-- Short domains: let a link be shown on one of several configured hostnames.
--
-- The column is a display choice, not a routing one. A short code resolves
-- globally, so nothing in the redirect path reads this; it only decides which
-- host the admin UI and the QR code put in front of the code. NULL means the
-- default domain from PUBLIC_URL.
--
-- The value is a bare hostname. It is validated against SHORT_DOMAINS on the
-- way in, so a row here is always a host the operator configured.
ALTER TABLE links ADD COLUMN IF NOT EXISTS domain varchar(255);

-- Only set for links that picked a non-default domain, and the only query that
-- cares is "show me the links on this domain", which is always non-NULL.
CREATE INDEX IF NOT EXISTS links_domain_idx ON links(domain) WHERE domain IS NOT NULL;
