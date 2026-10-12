-- Up Migration

-- Branch-to-branch stock transfers.

CREATE TABLE transfers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number         TEXT NOT NULL UNIQUE,
  source_branch_id        UUID NOT NULL REFERENCES branches(id),
  destination_branch_id   UUID NOT NULL REFERENCES branches(id),
  status                  TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT', 'REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'
  )),
  created_by              UUID NOT NULL REFERENCES users(id),
  requested_by            UUID REFERENCES users(id),
  requested_at            TIMESTAMPTZ,
  approved_by             UUID REFERENCES users(id),
  approved_at             TIMESTAMPTZ,
  shipped_by              UUID REFERENCES users(id),
  shipped_at              TIMESTAMPTZ,
  received_by             UUID REFERENCES users(id),
  received_at             TIMESTAMPTZ,
  cancelled_by            UUID REFERENCES users(id),
  cancelled_at            TIMESTAMPTZ,
  cancel_reason           TEXT,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  discrepancy_quantity    INTEGER CHECK (discrepancy_quantity IS NULL OR discrepancy_quantity > 0),
  discrepancy_reason      TEXT,
  discrepancy_recorded_by UUID REFERENCES users(id),
  discrepancy_recorded_at TIMESTAMPTZ,
  CHECK (source_branch_id <> destination_branch_id),
  CHECK (discrepancy_quantity IS NULL OR length(trim(coalesce(discrepancy_reason, ''))) > 0)
);
CREATE INDEX idx_transfers_source_status ON transfers(source_branch_id, status);
CREATE INDEX idx_transfers_destination_status ON transfers(destination_branch_id, status);
CREATE INDEX idx_transfers_created ON transfers(created_at DESC);
CREATE TRIGGER trg_transfers_updated_at BEFORE UPDATE ON transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transfers_no_delete BEFORE DELETE ON transfers
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

CREATE TABLE transfer_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id        UUID NOT NULL REFERENCES transfers(id),
  medicine_id        UUID NOT NULL REFERENCES medicines(id),
  batch_id           UUID NOT NULL REFERENCES batches(id),
  requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
  approved_quantity  INTEGER CHECK (approved_quantity >= 0),
  shipped_quantity   INTEGER CHECK (shipped_quantity >= 0),
  received_quantity  INTEGER CHECK (received_quantity >= 0),
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, batch_id),
  -- received <= shipped <= approved <= requested
  CHECK (approved_quantity IS NULL OR approved_quantity <= requested_quantity),
  CHECK (shipped_quantity IS NULL OR (approved_quantity IS NOT NULL AND shipped_quantity <= approved_quantity)),
  CHECK (received_quantity IS NULL OR (shipped_quantity IS NOT NULL AND received_quantity <= shipped_quantity))
);
CREATE INDEX idx_transfer_items_transfer ON transfer_items(transfer_id);
CREATE INDEX idx_transfer_items_batch ON transfer_items(batch_id);
CREATE TRIGGER trg_transfer_items_no_delete BEFORE DELETE ON transfer_items
  FOR EACH ROW EXECUTE FUNCTION reject_delete();

-- Down Migration

DROP TABLE IF EXISTS transfer_items;
DROP TABLE IF EXISTS transfers;
