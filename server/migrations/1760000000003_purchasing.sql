-- Up Migration

-- Purchases, receiving, and supplier payments (simple accounts payable).

CREATE TABLE purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_number TEXT NOT NULL UNIQUE,
  supplier_id     UUID NOT NULL REFERENCES suppliers(id),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'
  )),
  purchase_date   DATE NOT NULL,
  expected_date   DATE,
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount        NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax             NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes           TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  updated_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    UUID REFERENCES users(id),
  cancel_reason   TEXT,
  CHECK (expected_date IS NULL OR expected_date >= purchase_date),
  CHECK (total = subtotal - discount + tax)
);
CREATE INDEX idx_purchases_branch_date ON purchases(branch_id, purchase_date DESC);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id, purchase_date DESC);
CREATE INDEX idx_purchases_status ON purchases(status);
CREATE TRIGGER trg_purchases_updated_at BEFORE UPDATE ON purchases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_purchases_no_delete BEFORE DELETE ON purchases
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

CREATE TABLE purchase_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id         UUID NOT NULL REFERENCES purchases(id),
  medicine_id         UUID NOT NULL REFERENCES medicines(id),
  ordered_quantity    INTEGER NOT NULL CHECK (ordered_quantity > 0),
  received_quantity   INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  unit_purchase_price NUMERIC(14,2) NOT NULL CHECK (unit_purchase_price >= 0),
  discount            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax                 NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  line_total          NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Over-receiving is impossible at the database level.
  CHECK (received_quantity <= ordered_quantity),
  CHECK (line_total = ordered_quantity * unit_purchase_price - discount + tax)
);
CREATE INDEX idx_purchase_items_purchase ON purchase_items(purchase_id);
CREATE INDEX idx_purchase_items_medicine ON purchase_items(medicine_id);

CREATE TABLE purchase_receivings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchases(id),
  branch_id   UUID NOT NULL REFERENCES branches(id),
  received_by UUID NOT NULL REFERENCES users(id),
  notes       TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchase_receivings_purchase ON purchase_receivings(purchase_id);
CREATE INDEX idx_purchase_receivings_branch_time ON purchase_receivings(branch_id, received_at DESC);
CREATE TRIGGER trg_purchase_receivings_append_only BEFORE UPDATE OR DELETE ON purchase_receivings
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE purchase_receiving_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_id     UUID NOT NULL REFERENCES purchase_receivings(id),
  purchase_item_id UUID NOT NULL REFERENCES purchase_items(id),
  batch_id         UUID NOT NULL REFERENCES batches(id),
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  purchase_price   NUMERIC(14,2) NOT NULL CHECK (purchase_price >= 0),
  selling_price    NUMERIC(14,2) NOT NULL CHECK (selling_price >= 0),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchase_receiving_items_receiving ON purchase_receiving_items(receiving_id);
CREATE INDEX idx_purchase_receiving_items_item ON purchase_receiving_items(purchase_item_id);
CREATE INDEX idx_purchase_receiving_items_batch ON purchase_receiving_items(batch_id);
CREATE TRIGGER trg_purchase_receiving_items_append_only BEFORE UPDATE OR DELETE ON purchase_receiving_items
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE supplier_payments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id      UUID NOT NULL REFERENCES purchases(id),
  supplier_id      UUID NOT NULL REFERENCES suppliers(id),
  branch_id        UUID NOT NULL REFERENCES branches(id),
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method   TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'OTHER')),
  reference_number TEXT,
  notes            TEXT,
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by      UUID NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_supplier_payments_purchase ON supplier_payments(purchase_id);
CREATE INDEX idx_supplier_payments_supplier_time ON supplier_payments(supplier_id, paid_at DESC);
CREATE INDEX idx_supplier_payments_branch_time ON supplier_payments(branch_id, paid_at DESC);
CREATE TRIGGER trg_supplier_payments_append_only BEFORE UPDATE OR DELETE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Down Migration

DROP TABLE IF EXISTS supplier_payments;
DROP TABLE IF EXISTS purchase_receiving_items;
DROP TABLE IF EXISTS purchase_receivings;
DROP TABLE IF EXISTS purchase_items;
DROP TABLE IF EXISTS purchases;
