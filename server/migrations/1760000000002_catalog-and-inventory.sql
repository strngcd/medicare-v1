-- Up Migration

-- Medicines, categories, suppliers, batches, branch inventory and the
-- immutable stock movement ledger.

CREATE TABLE medicine_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  updated_by  UUID REFERENCES users(id),
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX uq_medicine_categories_name ON medicine_categories(lower(name));
CREATE INDEX idx_medicine_categories_status ON medicine_categories(status);
CREATE TRIGGER trg_medicine_categories_updated_at BEFORE UPDATE ON medicine_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_medicine_categories_no_delete BEFORE DELETE ON medicine_categories
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

CREATE TABLE medicines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL CHECK (length(trim(name)) > 0),
  generic_name          TEXT,
  brand_name            TEXT,
  category_id           UUID REFERENCES medicine_categories(id),
  manufacturer          TEXT,
  country_of_origin     TEXT,
  strength              TEXT,
  dosage_form           TEXT,
  package_size          TEXT NOT NULL CHECK (length(trim(package_size)) > 0),
  prescription_required BOOLEAN NOT NULL,
  description           TEXT,
  storage_instructions  TEXT,
  barcode               TEXT CHECK (barcode IS NULL OR length(trim(barcode)) > 0),
  status                TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  created_by            UUID REFERENCES users(id),
  updated_by            UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at           TIMESTAMPTZ,
  archived_by           UUID REFERENCES users(id)
);
CREATE UNIQUE INDEX uq_medicines_barcode ON medicines(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX idx_medicines_category_status ON medicines(category_id, status);
CREATE INDEX idx_medicines_status ON medicines(status);
CREATE INDEX idx_medicines_name_trgm ON medicines USING gin (name gin_trgm_ops);
CREATE INDEX idx_medicines_generic_trgm ON medicines USING gin (generic_name gin_trgm_ops);
CREATE INDEX idx_medicines_duplicate_key ON medicines (lower(name), lower(coalesce(strength, '')),
  lower(coalesce(dosage_form, '')), lower(package_size));
CREATE TRIGGER trg_medicines_updated_at BEFORE UPDATE ON medicines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_medicines_no_delete BEFORE DELETE ON medicines
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

CREATE TABLE suppliers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name   TEXT NOT NULL CHECK (length(trim(company_name)) > 0),
  phone          TEXT NOT NULL CHECK (length(trim(phone)) > 0),
  contact_person TEXT,
  email          TEXT,
  address        TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_by     UUID REFERENCES users(id),
  updated_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at    TIMESTAMPTZ,
  archived_by    UUID REFERENCES users(id)
);
-- Not unique: normalized-name duplicates are a warning only.
CREATE INDEX idx_suppliers_normalized_name ON suppliers(lower(regexp_replace(company_name, '\s+', ' ', 'g')));
CREATE INDEX idx_suppliers_name_trgm ON suppliers USING gin (company_name gin_trgm_ops);
CREATE INDEX idx_suppliers_status ON suppliers(status);
CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_suppliers_no_delete BEFORE DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- A batch is identified by (medicine, batch number) and may be stocked in
-- several branches. Its purchase price is the historical acquisition cost.
CREATE TABLE batches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id        UUID NOT NULL REFERENCES medicines(id),
  batch_number       TEXT NOT NULL CHECK (length(trim(batch_number)) > 0),
  manufacturing_date DATE,
  expiry_date        DATE NOT NULL,
  purchase_price     NUMERIC(14,2) NOT NULL CHECK (purchase_price >= 0),
  supplier_id        UUID REFERENCES suppliers(id),
  created_by         UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (manufacturing_date IS NULL OR manufacturing_date <= expiry_date)
);
CREATE UNIQUE INDEX uq_batches_medicine_number ON batches(medicine_id, batch_number);
CREATE INDEX idx_batches_medicine_expiry ON batches(medicine_id, expiry_date);
CREATE INDEX idx_batches_expiry ON batches(expiry_date);
CREATE INDEX idx_batches_supplier ON batches(supplier_id);
CREATE TRIGGER trg_batches_updated_at BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_batches_no_delete BEFORE DELETE ON batches
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- Historical cost and identity of a batch can never be rewritten.
CREATE OR REPLACE FUNCTION protect_batch_history() RETURNS trigger AS $$
BEGIN
  IF NEW.purchase_price <> OLD.purchase_price
     OR NEW.medicine_id <> OLD.medicine_id
     OR NEW.batch_number <> OLD.batch_number THEN
    RAISE EXCEPTION 'Batch identity and purchase price are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_batches_protect_history BEFORE UPDATE ON batches
  FOR EACH ROW EXECUTE FUNCTION protect_batch_history();

CREATE TABLE branch_inventory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id     UUID NOT NULL REFERENCES branches(id),
  batch_id      UUID NOT NULL REFERENCES batches(id),
  quantity      INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  minimum_stock INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  selling_price NUMERIC(14,2) NOT NULL CHECK (selling_price >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id, batch_id)
);
CREATE INDEX idx_branch_inventory_batch ON branch_inventory(batch_id);
CREATE INDEX idx_branch_inventory_branch_quantity ON branch_inventory(branch_id, quantity);
CREATE TRIGGER trg_branch_inventory_updated_at BEFORE UPDATE ON branch_inventory
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_branch_inventory_no_delete BEFORE DELETE ON branch_inventory
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

CREATE TABLE stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  batch_id        UUID NOT NULL REFERENCES batches(id),
  movement_type   TEXT NOT NULL CHECK (movement_type IN (
    'PURCHASE_RECEIVED', 'SALE', 'REFUND', 'ADJUSTMENT', 'TRANSFER_OUT',
    'TRANSFER_IN', 'EXPIRED', 'DAMAGED', 'LOST', 'CORRECTION'
  )),
  quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
  quantity_before INTEGER NOT NULL CHECK (quantity_before >= 0),
  quantity_after  INTEGER NOT NULL CHECK (quantity_after >= 0),
  reference_type  TEXT NOT NULL CHECK (reference_type IN (
    'PURCHASE_RECEIVING', 'SALE', 'SALE_VOID', 'REFUND', 'INVENTORY_ADJUSTMENT',
    'STOCK_ADDITION', 'TRANSFER'
  )),
  reference_id    UUID NOT NULL,
  reason          TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (quantity_after = quantity_before + quantity_change)
);
CREATE INDEX idx_stock_movements_branch_time ON stock_movements(branch_id, created_at DESC);
CREATE INDEX idx_stock_movements_batch_time ON stock_movements(batch_id, created_at DESC);
CREATE INDEX idx_stock_movements_type_time ON stock_movements(movement_type, created_at DESC);
CREATE INDEX idx_stock_movements_reference ON stock_movements(reference_type, reference_id);
CREATE TRIGGER trg_stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE inventory_adjustments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_number   TEXT NOT NULL UNIQUE,
  branch_id           UUID NOT NULL REFERENCES branches(id),
  batch_id            UUID NOT NULL REFERENCES batches(id),
  branch_inventory_id UUID NOT NULL REFERENCES branch_inventory(id),
  reason              TEXT NOT NULL CHECK (reason IN ('DAMAGED', 'EXPIRED', 'LOST', 'FOUND', 'CORRECTION', 'OTHER')),
  quantity_before     INTEGER NOT NULL CHECK (quantity_before >= 0),
  quantity_change     INTEGER NOT NULL CHECK (quantity_change <> 0),
  quantity_after      INTEGER NOT NULL CHECK (quantity_after >= 0),
  notes               TEXT,
  created_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (quantity_after = quantity_before + quantity_change),
  CHECK (reason <> 'OTHER' OR length(trim(coalesce(notes, ''))) > 0),
  CHECK (reason NOT IN ('DAMAGED', 'EXPIRED', 'LOST') OR quantity_change < 0),
  CHECK (reason <> 'FOUND' OR quantity_change > 0)
);
CREATE INDEX idx_inventory_adjustments_branch_time ON inventory_adjustments(branch_id, created_at DESC);
CREATE INDEX idx_inventory_adjustments_batch ON inventory_adjustments(batch_id);
CREATE TRIGGER trg_inventory_adjustments_append_only BEFORE UPDATE OR DELETE ON inventory_adjustments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Down Migration

DROP TABLE IF EXISTS inventory_adjustments;
DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS branch_inventory;
DROP TABLE IF EXISTS batches;
DROP FUNCTION IF EXISTS protect_batch_history();
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS medicines;
DROP TABLE IF EXISTS medicine_categories;
