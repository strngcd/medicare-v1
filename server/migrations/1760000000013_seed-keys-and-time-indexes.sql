-- Up Migration

-- Seeded reference rows carry a permanent key, so re-running the seed
-- recognises them even after staff rename or edit them (no duplicates).
ALTER TABLE medicines ADD COLUMN catalog_key TEXT;
CREATE UNIQUE INDEX uq_medicines_catalog_key ON medicines(catalog_key) WHERE catalog_key IS NOT NULL;
ALTER TABLE medicine_categories ADD COLUMN seed_key TEXT;
CREATE UNIQUE INDEX uq_medicine_categories_seed_key ON medicine_categories(seed_key) WHERE seed_key IS NOT NULL;

-- Time-range filters across all branches.
CREATE INDEX idx_refunds_created ON refunds(created_at);
CREATE INDEX idx_supplier_payments_paid ON supplier_payments(paid_at);
CREATE INDEX idx_stock_movements_created ON stock_movements(created_at);

-- Down Migration

DROP INDEX IF EXISTS idx_stock_movements_created;
DROP INDEX IF EXISTS idx_supplier_payments_paid;
DROP INDEX IF EXISTS idx_refunds_created;
DROP INDEX IF EXISTS uq_medicine_categories_seed_key;
ALTER TABLE medicine_categories DROP COLUMN IF EXISTS seed_key;
DROP INDEX IF EXISTS uq_medicines_catalog_key;
ALTER TABLE medicines DROP COLUMN IF EXISTS catalog_key;
