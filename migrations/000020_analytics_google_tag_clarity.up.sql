-- Two more tracking providers, beside the three 000012 created.
--
-- They are separate columns rather than a reuse of an existing one because the
-- ids are not interchangeable: a GTM container id (GTM-…) is loaded through
-- gtm.js, while a Google tag id (GT-…) is loaded through gtag.js. A single
-- column holding both would have to guess which snippet to emit from the
-- prefix, and a mis-prefixed value would inject a request that never loads.
--
-- clarity_project_id holds the Microsoft Clarity project id, the short
-- lower-case token in the tag snippet's URL.
--
-- Both follow 000012's contract: nullable, "empty means off", and deliberately
-- no format CHECK. A constraint duplicating a validation regex is a second
-- definition of the same rule and the two drift; worse, a 23514 is not mapped
-- by normalizeDBError, so a violation would leak the constraint text to the
-- client. The authoritative check is in the service, and both render
-- boundaries validate again before they interpolate anything into a script.
ALTER TABLE analytics_settings ADD COLUMN IF NOT EXISTS google_tag_id      text;
ALTER TABLE analytics_settings ADD COLUMN IF NOT EXISTS clarity_project_id text;
