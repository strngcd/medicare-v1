-- Up Migration

-- Uploaded files (pharmacy logo, staff CVs) live in the database so backups
-- include them. Rows are immutable: replacing a file inserts a new row and
-- repoints the owner, so earlier versions stay available for the audit trail.
CREATE TABLE stored_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose      TEXT NOT NULL CHECK (purpose IN ('PHARMACY_LOGO', 'STAFF_CV')),
  file_name    TEXT NOT NULL CHECK (length(trim(file_name)) > 0 AND length(file_name) <= 255),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  size_bytes   INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256       TEXT NOT NULL,
  data         BYTEA NOT NULL,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_stored_files_immutable BEFORE UPDATE ON stored_files
  FOR EACH ROW EXECUTE FUNCTION reject_modification();

ALTER TABLE system_settings ADD COLUMN logo_file_id UUID REFERENCES stored_files(id);
ALTER TABLE users ADD COLUMN cv_file_id UUID REFERENCES stored_files(id);

-- Logos are uploaded now; the old free-text URL is no longer used.
UPDATE system_settings SET logo_url = NULL;

-- Down Migration

ALTER TABLE users DROP COLUMN IF EXISTS cv_file_id;
ALTER TABLE system_settings DROP COLUMN IF EXISTS logo_file_id;
DROP TABLE IF EXISTS stored_files;
