-- Roles as data: a role is a named bundle of scopes plus a visibility flag.
--
-- Until now the mapping lived in Go (domain.ScopesForRole) and the role names
-- were pinned by a CHECK. Making the mapping a table is what lets the console
-- adjust what each preset role may do without a redeploy.

-- scopes mirrors api_tokens.scopes (a jsonb string array) so the existing
-- parseScopes helper decodes it, and so a corrupt row yields no scopes rather
-- than widening access. The typeof CHECK documents that contract.
CREATE TABLE IF NOT EXISTS roles (
  name         varchar(16) PRIMARY KEY,
  scopes       jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(scopes) = 'array'),
  -- unrestricted means "sees and manages every link", which is not the same as
  -- "may do anything": capability (scopes) and visibility are orthogonal, and a
  -- single flag cannot express both.
  unrestricted boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The four presets. admin is the only role that may administer accounts and
-- edit roles; operator and readonly are staff roles that see every link but
-- cannot reach the account or role screens. Re-running is a no-op, so an
-- operator who has customised a role does not lose the change to a re-run.
INSERT INTO roles (name, scopes, unrestricted) VALUES
  ('admin',    '["links:read","links:write","stats:read","tokens:manage","audit:read","users:manage","roles:manage"]'::jsonb, true),
  ('operator', '["links:read","links:write","stats:read","audit:read"]'::jsonb, true),
  ('readonly', '["links:read","stats:read","audit:read"]'::jsonb, true),
  ('user',     '["links:read","links:write","stats:read","tokens:manage"]'::jsonb, false)
ON CONFLICT (name) DO NOTHING;

-- The old constraint was written inline as
--   role varchar(16) NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user'))
-- so PostgreSQL named it itself. Find it by what it constrains rather than by
-- the name we happen to expect, then replace it with the four-value domain.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'admin_users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE admin_users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_check CHECK (role IN ('admin','operator','readonly','user'));

-- Referential integrity for the role name. GetSession joins roles on every
-- request; without this, a role name with no row would make that inner join
-- return nothing, which the middleware reads as "no session" and the account is
-- silently signed out. ON DELETE RESTRICT keeps a role from vanishing while
-- accounts still reference it.
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_fk;
ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_role_fk FOREIGN KEY (role) REFERENCES roles(name)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS admin_users_role_idx ON admin_users(role);
