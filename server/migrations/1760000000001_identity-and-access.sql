-- Up Migration

-- Identity, access control, sessions, and login history.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fast ILIKE search on names

-- Shared helper: keep updated_at current on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Shared helper: reject UPDATE/DELETE on append-only tables.
CREATE OR REPLACE FUNCTION reject_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

-- Shared helper: reject DELETE on tables holding business history.
CREATE OR REPLACE FUNCTION reject_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DELETE on % is not allowed: historical records are retained', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Roles and permissions
-- ---------------------------------------------------------------------------

CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE CHECK (code IN ('OWNER', 'ADMIN', 'PHARMACIST', 'CASHIER')),
  name        TEXT NOT NULL,
  description TEXT,
  rank        SMALLINT NOT NULL,  -- lower rank = more authority (OWNER = 1)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  module      TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);

-- ---------------------------------------------------------------------------
-- Branches and users (mutually referencing; FKs added after both exist)
-- ---------------------------------------------------------------------------

CREATE TABLE branches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
  code            TEXT NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{0,19}$'),
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  city            TEXT,
  country         TEXT NOT NULL DEFAULT 'Ethiopia',
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  manager_user_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at  TIMESTAMPTZ,
  deactivated_by  UUID
);
CREATE UNIQUE INDEX uq_branches_code ON branches(code);
CREATE INDEX idx_branches_status ON branches(status);
CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_branches_no_delete BEFORE DELETE ON branches
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- Branch code is immutable once created.
CREATE OR REPLACE FUNCTION reject_branch_code_change() RETURNS trigger AS $$
BEGIN
  IF NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'Branch code is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_branches_code_immutable BEFORE UPDATE OF code ON branches
  FOR EACH ROW EXECUTE FUNCTION reject_branch_code_change();

CREATE TABLE users (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name               TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  email                   TEXT NOT NULL CHECK (email = lower(trim(email)) AND position('@' IN email) > 1),
  phone                   TEXT,
  password_hash           TEXT,  -- NULL until the account setup link is used
  role_id                 UUID NOT NULL REFERENCES roles(id),
  status                  TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  employee_id             TEXT,
  job_title               TEXT,
  hire_date               DATE,
  last_login_at           TIMESTAMPTZ,
  last_selected_branch_id UUID REFERENCES branches(id),
  deactivated_at          TIMESTAMPTZ,
  deactivated_by          UUID REFERENCES users(id),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_email ON users(lower(email));
CREATE UNIQUE INDEX uq_users_employee_id ON users(lower(employee_id)) WHERE employee_id IS NOT NULL;
CREATE INDEX idx_users_role_status ON users(role_id, status);
CREATE INDEX idx_users_full_name_trgm ON users USING gin (full_name gin_trgm_ops);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_users_no_delete BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

ALTER TABLE branches
  ADD CONSTRAINT fk_branches_manager FOREIGN KEY (manager_user_id) REFERENCES users(id),
  ADD CONSTRAINT fk_branches_deactivated_by FOREIGN KEY (deactivated_by) REFERENCES users(id);

CREATE TABLE user_branches (
  user_id     UUID NOT NULL REFERENCES users(id),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  assigned_by UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, branch_id)
);
CREATE INDEX idx_user_branches_branch ON user_branches(branch_id);

CREATE TABLE user_permission_overrides (
  user_id       UUID NOT NULL REFERENCES users(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  granted       BOOLEAN NOT NULL,
  set_by        UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_id)
);
CREATE INDEX idx_user_permission_overrides_permission ON user_permission_overrides(permission_id);
CREATE TRIGGER trg_user_permission_overrides_updated_at BEFORE UPDATE ON user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_preferences (
  user_id    UUID PRIMARY KEY REFERENCES users(id),
  theme      TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('LIGHT', 'DARK', 'SYSTEM')),
  page_size  SMALLINT NOT NULL DEFAULT 25 CHECK (page_size IN (10, 25, 50, 100)),
  ui_density TEXT NOT NULL DEFAULT 'COMFORTABLE' CHECK (ui_density IN ('COMFORTABLE', 'COMPACT')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_user_preferences_updated_at BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Sessions and credential tokens (only hashes are stored)
-- ---------------------------------------------------------------------------

CREATE TABLE user_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  token_hash      TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT CHECK (revoked_reason IN (
    'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'ACCOUNT_DEACTIVATED'
  ))
);
CREATE INDEX idx_user_sessions_user_active ON user_sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE password_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  purpose    TEXT NOT NULL CHECK (purpose IN ('PASSWORD_RESET', 'ACCOUNT_SETUP')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_password_tokens_user ON password_tokens(user_id, purpose) WHERE used_at IS NULL;

-- Raw login attempts used for brute-force throttling (email + IP windows).
CREATE TABLE login_attempts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  ip_address TEXT,
  success    BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_login_attempts_email_time ON login_attempts(email, created_at DESC);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip_address, created_at DESC);

CREATE TABLE login_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES users(id),
  event_type       TEXT NOT NULL CHECK (event_type IN ('LOGIN', 'LOGOUT')),
  success          BOOLEAN NOT NULL,
  ip_address       TEXT,
  user_agent       TEXT,
  branch_id        UUID REFERENCES branches(id),
  failure_category TEXT CHECK (failure_category IN (
    'INVALID_CREDENTIALS', 'ACCOUNT_INACTIVE', 'RATE_LIMITED', 'INVALID_RESET_FLOW', 'OTHER'
  )),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (success OR failure_category IS NOT NULL)
);
CREATE INDEX idx_login_history_created ON login_history(created_at DESC);
CREATE INDEX idx_login_history_user ON login_history(user_id, created_at DESC);
CREATE INDEX idx_login_history_branch ON login_history(branch_id, created_at DESC);
CREATE TRIGGER trg_login_history_append_only BEFORE UPDATE OR DELETE ON login_history
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Down Migration

DROP TABLE IF EXISTS login_history;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS password_tokens;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS user_permission_overrides;
DROP TABLE IF EXISTS user_branches;
ALTER TABLE IF EXISTS branches DROP CONSTRAINT IF EXISTS fk_branches_manager;
ALTER TABLE IF EXISTS branches DROP CONSTRAINT IF EXISTS fk_branches_deactivated_by;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS branches;
DROP FUNCTION IF EXISTS reject_branch_code_change();
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
DROP FUNCTION IF EXISTS reject_delete();
DROP FUNCTION IF EXISTS reject_modification();
DROP FUNCTION IF EXISTS set_updated_at();
