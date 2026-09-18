-- Link metadata: a human-readable title and many-to-many tags.

ALTER TABLE links ADD COLUMN IF NOT EXISTS title varchar(255) NOT NULL DEFAULT '';

-- Tag names are normalised to lower case by the application before they reach
-- the database, so a plain UNIQUE constraint is enough to keep "News" and
-- "news" from becoming two rows.
CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS link_tags (
  link_id uuid NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  tag_id  uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
);

-- Listing links by tag is the main read path for this table.
CREATE INDEX IF NOT EXISTS link_tags_tag_idx ON link_tags(tag_id);
