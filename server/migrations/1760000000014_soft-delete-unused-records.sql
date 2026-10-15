-- Up Migration

-- Branches, staff and suppliers created by mistake can be deleted while no
-- business record refers to them. Deletion is soft: the row stays (audit and
-- login history keep pointing at it) but is hidden everywhere, inactive, and
-- frozen. The service decides when a record is still unused.
ALTER TABLE branches
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by UUID REFERENCES users(id),
  ADD CONSTRAINT ck_branches_deleted_inactive CHECK (deleted_at IS NULL OR status = 'INACTIVE');
ALTER TABLE users
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by UUID REFERENCES users(id),
  ADD CONSTRAINT ck_users_deleted_inactive CHECK (deleted_at IS NULL OR status = 'INACTIVE');
ALTER TABLE suppliers
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by UUID REFERENCES users(id),
  ADD CONSTRAINT ck_suppliers_deleted_archived CHECK (deleted_at IS NULL OR status = 'ARCHIVED');

-- A deleted record's code, email and employee ID can be used again.
DROP INDEX uq_branches_code;
CREATE UNIQUE INDEX uq_branches_code ON branches(code) WHERE deleted_at IS NULL;
DROP INDEX uq_users_email;
CREATE UNIQUE INDEX uq_users_email ON users(lower(email)) WHERE deleted_at IS NULL;
DROP INDEX uq_users_employee_id;
CREATE UNIQUE INDEX uq_users_employee_id ON users(lower(employee_id)) WHERE employee_id IS NOT NULL AND deleted_at IS NULL;

-- Deleting is final: a deleted row can never be changed or brought back.
CREATE OR REPLACE FUNCTION reject_change_after_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION '% row % was deleted and cannot be changed', TG_TABLE_NAME, OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_branches_frozen_after_delete BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION reject_change_after_delete();
CREATE TRIGGER trg_users_frozen_after_delete BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION reject_change_after_delete();
CREATE TRIGGER trg_suppliers_frozen_after_delete BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION reject_change_after_delete();

-- The "has this user done anything" check scans the ledger by author.
CREATE INDEX idx_stock_movements_created_by ON stock_movements(created_by);

-- Down Migration

DROP INDEX IF EXISTS idx_stock_movements_created_by;
DROP TRIGGER IF EXISTS trg_suppliers_frozen_after_delete ON suppliers;
DROP TRIGGER IF EXISTS trg_users_frozen_after_delete ON users;
DROP TRIGGER IF EXISTS trg_branches_frozen_after_delete ON branches;
DROP FUNCTION IF EXISTS reject_change_after_delete();
DROP INDEX IF EXISTS uq_users_employee_id;
CREATE UNIQUE INDEX uq_users_employee_id ON users(lower(employee_id)) WHERE employee_id IS NOT NULL;
DROP INDEX IF EXISTS uq_users_email;
CREATE UNIQUE INDEX uq_users_email ON users(lower(email));
DROP INDEX IF EXISTS uq_branches_code;
CREATE UNIQUE INDEX uq_branches_code ON branches(code);
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS ck_suppliers_deleted_archived, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE users DROP CONSTRAINT IF EXISTS ck_users_deleted_inactive, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE branches DROP CONSTRAINT IF EXISTS ck_branches_deleted_inactive, DROP COLUMN IF EXISTS deleted_by, DROP COLUMN IF EXISTS deleted_at;
