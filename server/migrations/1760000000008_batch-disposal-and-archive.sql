-- Up Migration

-- Disposal: expired or near-expiry stock written off as a loss.
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN (
  'PURCHASE_RECEIVED', 'SALE', 'REFUND', 'ADJUSTMENT', 'TRANSFER_OUT',
  'TRANSFER_IN', 'EXPIRED', 'DAMAGED', 'LOST', 'CORRECTION', 'DISPOSED'
));

ALTER TABLE inventory_adjustments DROP CONSTRAINT inventory_adjustments_reason_check;
ALTER TABLE inventory_adjustments ADD CONSTRAINT inventory_adjustments_reason_check
  CHECK (reason IN ('DAMAGED', 'EXPIRED', 'LOST', 'FOUND', 'CORRECTION', 'OTHER', 'DISPOSED'));
ALTER TABLE inventory_adjustments DROP CONSTRAINT inventory_adjustments_check2;
ALTER TABLE inventory_adjustments ADD CONSTRAINT inventory_adjustments_check2
  CHECK (reason NOT IN ('DAMAGED', 'EXPIRED', 'LOST', 'DISPOSED') OR quantity_change < 0);

-- Archiving hides an empty batch row from inventory lists. New stock for the
-- same batch un-archives it, so an archived row never holds stock.
ALTER TABLE branch_inventory
  ADD COLUMN archived_at TIMESTAMPTZ,
  ADD COLUMN archived_by UUID REFERENCES users(id),
  ADD CONSTRAINT branch_inventory_archived_empty CHECK (archived_at IS NULL OR quantity = 0);
CREATE INDEX idx_branch_inventory_active ON branch_inventory(branch_id) WHERE archived_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS idx_branch_inventory_active;
ALTER TABLE branch_inventory
  DROP CONSTRAINT IF EXISTS branch_inventory_archived_empty,
  DROP COLUMN IF EXISTS archived_by,
  DROP COLUMN IF EXISTS archived_at;

ALTER TABLE inventory_adjustments DROP CONSTRAINT inventory_adjustments_check2;
ALTER TABLE inventory_adjustments ADD CONSTRAINT inventory_adjustments_check2
  CHECK (reason NOT IN ('DAMAGED', 'EXPIRED', 'LOST') OR quantity_change < 0);
ALTER TABLE inventory_adjustments DROP CONSTRAINT inventory_adjustments_reason_check;
ALTER TABLE inventory_adjustments ADD CONSTRAINT inventory_adjustments_reason_check
  CHECK (reason IN ('DAMAGED', 'EXPIRED', 'LOST', 'FOUND', 'CORRECTION', 'OTHER'));

ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_movement_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_movement_type_check CHECK (movement_type IN (
  'PURCHASE_RECEIVED', 'SALE', 'REFUND', 'ADJUSTMENT', 'TRANSFER_OUT',
  'TRANSFER_IN', 'EXPIRED', 'DAMAGED', 'LOST', 'CORRECTION'
));
