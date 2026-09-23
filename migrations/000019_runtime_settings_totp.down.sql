-- Dropping the column reverts the switch to TOTP_ENABLED, which is still read
-- as the seed value. An operator who turned the second factor on from the
-- console after this migration will find it off again unless the environment
-- variable says otherwise.
ALTER TABLE runtime_settings DROP COLUMN IF EXISTS totp_enabled;
