-- Sequential alias mode draws short codes from this sequence. It starts at 1 so
-- the earliest codes are as short as possible; the service skips a value that
-- collides with an alias someone already claimed.
CREATE SEQUENCE IF NOT EXISTS link_alias_seq START WITH 1 INCREMENT BY 1;
