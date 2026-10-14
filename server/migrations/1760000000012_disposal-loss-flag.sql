-- Up Migration

-- A disposal can be recorded without counting as a stock loss (e.g. stock
-- returned or replaced at no cost). Such movements still leave inventory and
-- stay in the ledger, but loss and profit reports skip them.
ALTER TABLE stock_movements ADD COLUMN counts_as_loss BOOLEAN NOT NULL DEFAULT true;

-- Down Migration

ALTER TABLE stock_movements DROP COLUMN IF EXISTS counts_as_loss;
