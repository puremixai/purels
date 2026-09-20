UPDATE roles
SET scopes = scopes - 'settings:manage', updated_at = now()
WHERE name = 'admin';

DROP TABLE IF EXISTS runtime_settings;
