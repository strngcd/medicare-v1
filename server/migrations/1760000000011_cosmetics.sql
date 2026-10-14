-- Up Migration

-- Cosmetics are sold alongside medicines and share the same product engine
-- (purchasing, batches, inventory ledger, sales, refunds, transfers, reports).
-- A product's type, and a category's type, are fixed once created.
ALTER TABLE medicines
  ADD COLUMN product_type TEXT NOT NULL DEFAULT 'MEDICINE' CHECK (product_type IN ('MEDICINE', 'COSMETIC')),
  ADD CONSTRAINT chk_medicines_cosmetic_no_prescription CHECK (product_type = 'MEDICINE' OR prescription_required = false);
CREATE INDEX idx_medicines_type_status ON medicines(product_type, status);

ALTER TABLE medicine_categories
  ADD COLUMN product_type TEXT NOT NULL DEFAULT 'MEDICINE' CHECK (product_type IN ('MEDICINE', 'COSMETIC'));

CREATE OR REPLACE FUNCTION reject_product_type_change() RETURNS trigger AS $$
BEGIN
  IF NEW.product_type <> OLD.product_type THEN
    RAISE EXCEPTION 'product_type is immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_medicines_product_type BEFORE UPDATE ON medicines
  FOR EACH ROW EXECUTE FUNCTION reject_product_type_change();
CREATE TRIGGER trg_medicine_categories_product_type BEFORE UPDATE ON medicine_categories
  FOR EACH ROW EXECUTE FUNCTION reject_product_type_change();

-- Products without an expiry date (some cosmetics) store the far-future
-- sentinel 9999-12-31, so every "sellable", FEFO and expiry-alert rule keeps
-- working unchanged: such batches always sell after dated stock and never
-- expire. Medicines must always carry a real expiry date.
CREATE OR REPLACE FUNCTION require_medicine_expiry() RETURNS trigger AS $$
BEGIN
  IF NEW.expiry_date = DATE '9999-12-31'
     AND (SELECT product_type FROM medicines WHERE id = NEW.medicine_id) = 'MEDICINE' THEN
    RAISE EXCEPTION 'Medicines must have an expiry date' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_batches_require_medicine_expiry BEFORE INSERT ON batches
  FOR EACH ROW EXECUTE FUNCTION require_medicine_expiry();

-- Down Migration

DROP TRIGGER IF EXISTS trg_batches_require_medicine_expiry ON batches;
DROP FUNCTION IF EXISTS require_medicine_expiry();
DROP TRIGGER IF EXISTS trg_medicine_categories_product_type ON medicine_categories;
DROP TRIGGER IF EXISTS trg_medicines_product_type ON medicines;
DROP FUNCTION IF EXISTS reject_product_type_change();
ALTER TABLE medicine_categories DROP COLUMN IF EXISTS product_type;
DROP INDEX IF EXISTS idx_medicines_type_status;
ALTER TABLE medicines DROP CONSTRAINT IF EXISTS chk_medicines_cosmetic_no_prescription;
ALTER TABLE medicines DROP COLUMN IF EXISTS product_type;
