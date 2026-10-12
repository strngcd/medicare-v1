-- Up Migration

-- Notifications, audit log, settings, document numbering, idempotency, help.

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL CHECK (type IN (
    'PURCHASE_RECEIVED', 'PURCHASE_PARTIALLY_RECEIVED', 'PURCHASE_CANCELLED',
    'TRANSFER_REQUESTED', 'TRANSFER_APPROVED', 'TRANSFER_SHIPPED', 'TRANSFER_RECEIVED',
    'TRANSFER_DISCREPANCY', 'PASSWORD_CHANGED', 'PASSWORD_RESET',
    'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED', 'IMPORTANT_CONFIGURATION_CHANGE'
  )),
  title        TEXT NOT NULL,
  message      TEXT NOT NULL,
  branch_id    UUID REFERENCES branches(id),
  entity_type  TEXT,
  entity_id    UUID,
  read_at      TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_time ON notifications(user_id, created_at DESC) WHERE dismissed_at IS NULL;
CREATE INDEX idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL AND dismissed_at IS NULL;
CREATE TRIGGER trg_notifications_no_delete BEFORE DELETE ON notifications
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id         UUID REFERENCES users(id),
  role_at_time    TEXT,
  branch_id       UUID REFERENCES branches(id),
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       UUID,
  description     TEXT NOT NULL,
  previous_values JSONB,
  new_values      JSONB,
  ip_address      TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs("timestamp" DESC);
CREATE INDEX idx_audit_logs_user_time ON audit_logs(user_id, "timestamp" DESC);
CREATE INDEX idx_audit_logs_branch_time ON audit_logs(branch_id, "timestamp" DESC);
CREATE INDEX idx_audit_logs_action_time ON audit_logs(action, "timestamp" DESC);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Global pharmacy settings: exactly one row.
CREATE TABLE system_settings (
  id                  SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pharmacy_name       TEXT NOT NULL DEFAULT 'Medicar Pharmacy',
  logo_url            TEXT,
  phone               TEXT,
  email               TEXT,
  address             TEXT,
  city                TEXT,
  country             TEXT NOT NULL DEFAULT 'Ethiopia',
  website             TEXT,
  currency_code       TEXT NOT NULL DEFAULT 'ETB' CHECK (currency_code ~ '^[A-Z]{3}$'),
  expiry_warning_days INTEGER NOT NULL DEFAULT 30 CHECK (expiry_warning_days BETWEEN 1 AND 365),
  tax_enabled         BOOLEAN NOT NULL DEFAULT false,
  tax_name            TEXT NOT NULL DEFAULT 'Tax',
  tax_rate            NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_mode            TEXT NOT NULL DEFAULT 'ADDED_ON_TOP' CHECK (tax_mode IN ('INCLUDED', 'ADDED_ON_TOP')),
  updated_by          UUID REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_system_settings_updated_at BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE branch_settings (
  branch_id                   UUID PRIMARY KEY REFERENCES branches(id),
  default_minimum_stock       INTEGER NOT NULL DEFAULT 10 CHECK (default_minimum_stock >= 0),
  receipt_show_tax            BOOLEAN NOT NULL DEFAULT true,
  receipt_show_discount       BOOLEAN NOT NULL DEFAULT true,
  receipt_show_branch_address BOOLEAN NOT NULL DEFAULT true,
  receipt_show_branch_phone   BOOLEAN NOT NULL DEFAULT true,
  receipt_show_staff          BOOLEAN NOT NULL DEFAULT true,
  receipt_footer              TEXT,
  updated_by                  UUID REFERENCES users(id),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_branch_settings_updated_at BEFORE UPDATE ON branch_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Organization-wide, year-aware document counters. A counter row is locked by
-- the transaction that increments it, so numbers are gapless and never reused.
CREATE TABLE document_sequences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_type TEXT NOT NULL CHECK (sequence_type IN (
    'SALE', 'PURCHASE', 'REFUND', 'TRANSFER', 'STOCK_ADJUSTMENT'
  )),
  year          INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 9999),
  last_value    INTEGER NOT NULL CHECK (last_value >= 0),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sequence_type, year)
);

-- Idempotency keys for critical POST requests. The key row is inserted inside
-- the same transaction as the business operation, so a failed operation never
-- leaves a key behind and a concurrent retry waits for the first attempt.
CREATE TABLE idempotency_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  scope           TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body   JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope, idempotency_key)
);

CREATE TABLE help_articles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category   TEXT NOT NULL CHECK (category IN (
    'GETTING_STARTED', 'MEDICINES', 'INVENTORY', 'PURCHASING', 'POS_SALES',
    'REFUNDS', 'REPORTS', 'STAFF_PERMISSIONS', 'BRANCHES', 'SETTINGS'
  )),
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'C')
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_help_articles_category ON help_articles(category, sort_order) WHERE status = 'PUBLISHED';
CREATE INDEX idx_help_articles_search ON help_articles USING gin (search_vector);
CREATE TRIGGER trg_help_articles_updated_at BEFORE UPDATE ON help_articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TABLE IF EXISTS help_articles;
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS document_sequences;
DROP TABLE IF EXISTS branch_settings;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS notifications;
