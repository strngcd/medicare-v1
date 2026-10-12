-- Up Migration

-- POS sales, FEFO batch allocations, payments, FEFO overrides, and refunds.

CREATE TABLE sales (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT NOT NULL UNIQUE,
  branch_id      UUID NOT NULL REFERENCES branches(id),
  sold_by        UUID NOT NULL REFERENCES users(id),
  status         TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED')),
  -- Discount as entered at the till (kept for history; amounts below are authoritative).
  discount_type  TEXT CHECK (discount_type IN ('PERCENTAGE', 'FIXED')),
  discount_value NUMERIC(14,2) CHECK (discount_value >= 0),
  -- Tax configuration snapshot at the time of sale.
  tax_name       TEXT,
  tax_rate       NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  tax_mode       TEXT NOT NULL CHECK (tax_mode IN ('INCLUDED', 'ADDED_ON_TOP')),
  subtotal       NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  discount       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax            NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total          NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at      TIMESTAMPTZ,
  voided_by      UUID REFERENCES users(id),
  void_reason    TEXT,
  CHECK (discount <= subtotal),
  CHECK ((status = 'VOIDED') = (voided_at IS NOT NULL)),
  CHECK (status <> 'VOIDED' OR (voided_by IS NOT NULL AND length(trim(coalesce(void_reason, ''))) > 0))
);
CREATE INDEX idx_sales_branch_time ON sales(branch_id, completed_at DESC);
CREATE INDEX idx_sales_status_time ON sales(status, completed_at DESC);
CREATE INDEX idx_sales_sold_by_time ON sales(sold_by, completed_at DESC);
CREATE TRIGGER trg_sales_no_delete BEFORE DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- Only the void transition may change a sale after it is written.
CREATE OR REPLACE FUNCTION protect_sale_history() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'VOIDED' THEN
    RAISE EXCEPTION 'A voided sale cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.receipt_number <> OLD.receipt_number OR NEW.branch_id <> OLD.branch_id
     OR NEW.sold_by <> OLD.sold_by OR NEW.subtotal <> OLD.subtotal
     OR NEW.discount <> OLD.discount OR NEW.tax <> OLD.tax OR NEW.total <> OLD.total
     OR NEW.completed_at <> OLD.completed_at THEN
    RAISE EXCEPTION 'Completed sale values are immutable' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_sales_protect_history BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION protect_sale_history();

CREATE TABLE sale_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id            UUID NOT NULL REFERENCES sales(id),
  medicine_id        UUID NOT NULL REFERENCES medicines(id),
  medicine_name      TEXT NOT NULL,  -- snapshot for receipts/history
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  unit_selling_price NUMERIC(14,2) NOT NULL CHECK (unit_selling_price >= 0),
  discount           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax                NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  line_total         NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_medicine ON sale_items(medicine_id);
CREATE TRIGGER trg_sale_items_append_only BEFORE UPDATE OR DELETE ON sale_items
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE sale_item_batch_allocations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_item_id           UUID NOT NULL REFERENCES sale_items(id),
  batch_id               UUID NOT NULL REFERENCES batches(id),
  quantity               INTEGER NOT NULL CHECK (quantity > 0),
  purchase_price_at_sale NUMERIC(14,2) NOT NULL CHECK (purchase_price_at_sale >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sale_item_id, batch_id)
);
CREATE INDEX idx_sale_allocations_batch ON sale_item_batch_allocations(batch_id);
CREATE TRIGGER trg_sale_allocations_append_only BEFORE UPDATE OR DELETE ON sale_item_batch_allocations
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE sale_payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id        UUID NOT NULL REFERENCES sales(id),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK_TRANSFER')),
  amount         NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- V1: exactly one payment per sale.
CREATE UNIQUE INDEX uq_sale_payments_sale ON sale_payments(sale_id);
CREATE INDEX idx_sale_payments_method ON sale_payments(payment_method);
CREATE TRIGGER trg_sale_payments_append_only BEFORE UPDATE OR DELETE ON sale_payments
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE fefo_overrides (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id                UUID NOT NULL REFERENCES sales(id),
  sale_item_id           UUID NOT NULL REFERENCES sale_items(id),
  branch_id              UUID NOT NULL REFERENCES branches(id),
  medicine_id            UUID NOT NULL REFERENCES medicines(id),
  user_id                UUID NOT NULL REFERENCES users(id),
  recommended_allocation JSONB NOT NULL,
  actual_allocation      JSONB NOT NULL,
  reason                 TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fefo_overrides_sale ON fefo_overrides(sale_id);
CREATE INDEX idx_fefo_overrides_branch_time ON fefo_overrides(branch_id, created_at DESC);
CREATE TRIGGER trg_fefo_overrides_append_only BEFORE UPDATE OR DELETE ON fefo_overrides
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE refunds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_number  TEXT NOT NULL UNIQUE,
  sale_id        UUID NOT NULL REFERENCES sales(id),
  branch_id      UUID NOT NULL REFERENCES branches(id),
  refund_total   NUMERIC(14,2) NOT NULL CHECK (refund_total >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH', 'BANK_TRANSFER')),
  reason         TEXT NOT NULL CHECK (reason IN (
    'CUSTOMER_RETURN', 'DAMAGED_PRODUCT', 'WRONG_ITEM', 'WRONG_QUANTITY', 'DUPLICATE_SALE', 'OTHER'
  )),
  notes          TEXT,
  processed_by   UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reason <> 'OTHER' OR length(trim(coalesce(notes, ''))) > 0)
);
CREATE INDEX idx_refunds_sale ON refunds(sale_id);
CREATE INDEX idx_refunds_branch_time ON refunds(branch_id, created_at DESC);
CREATE TRIGGER trg_refunds_append_only BEFORE UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE refund_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id         UUID NOT NULL REFERENCES refunds(id),
  sale_item_id      UUID NOT NULL REFERENCES sale_items(id),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  refund_unit_price NUMERIC(14,2) NOT NULL CHECK (refund_unit_price >= 0),
  refund_amount     NUMERIC(14,2) NOT NULL CHECK (refund_amount >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refund_items_refund ON refund_items(refund_id);
CREATE INDEX idx_refund_items_sale_item ON refund_items(sale_item_id);
CREATE TRIGGER trg_refund_items_append_only BEFORE UPDATE OR DELETE ON refund_items
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

CREATE TABLE refund_item_batch_allocations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_item_id UUID NOT NULL REFERENCES refund_items(id),
  batch_id       UUID NOT NULL REFERENCES batches(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (refund_item_id, batch_id)
);
CREATE INDEX idx_refund_allocations_batch ON refund_item_batch_allocations(batch_id);
CREATE TRIGGER trg_refund_allocations_append_only BEFORE UPDATE OR DELETE ON refund_item_batch_allocations
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

-- Down Migration

DROP TABLE IF EXISTS refund_item_batch_allocations;
DROP TABLE IF EXISTS refund_items;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS fefo_overrides;
DROP TABLE IF EXISTS sale_payments;
DROP TABLE IF EXISTS sale_item_batch_allocations;
DROP TABLE IF EXISTS sale_items;
DROP TABLE IF EXISTS sales;
DROP FUNCTION IF EXISTS protect_sale_history();
