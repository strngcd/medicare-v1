-- Up Migration

-- Document numbers are now random codes (e.g. SAL-7K3QX9) checked for
-- uniqueness against their own table, so the per-year counters are unused.
-- Numbers already issued keep their original value.

DROP TABLE IF EXISTS document_sequences;

-- Down Migration

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
