-- Redirect rules: send a visitor somewhere else when their user agent matches.
-- A rule belongs to one link and is replaced wholesale whenever the link is
-- edited, so there is no update path to design here.
CREATE TABLE IF NOT EXISTS link_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  position int NOT NULL DEFAULT 0,
  match_type varchar(16) NOT NULL CHECK (match_type IN ('ua_contains','device')),
  match_value varchar(255) NOT NULL,
  destination_url text NOT NULL CHECK (char_length(destination_url) <= 8192),
  redirect_code smallint CHECK (redirect_code IN (301,302)),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Rules are only ever read for one link at a time, in position order.
CREATE INDEX IF NOT EXISTS link_rules_link_idx ON link_rules(link_id, position);
