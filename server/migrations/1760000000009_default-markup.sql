-- Up Migration

-- Suggested selling price on receiving = unit cost x (1 + markup / 100).
ALTER TABLE system_settings
  ADD COLUMN default_markup_percent NUMERIC(6,2) NOT NULL DEFAULT 15
    CHECK (default_markup_percent >= 0 AND default_markup_percent <= 1000);

-- Down Migration

ALTER TABLE system_settings DROP COLUMN IF EXISTS default_markup_percent;
