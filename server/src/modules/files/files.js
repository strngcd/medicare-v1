const crypto = require('crypto');
const express = require('express');
const AppError = require('../../errors/AppError');
const { query } = require('../../database/db');

/**
 * Uploaded files (pharmacy logo, staff CVs), stored in the database.
 *
 * Uploads are sent as the raw request body with the file's own content type
 * (image/png, application/pdf, ...) and its name in the X-File-Name header.
 * The authenticate middleware still requires the CSRF header, and the real
 * type is checked from the file's leading bytes, never trusted from headers.
 */

const MB = 1024 * 1024;

const UPLOAD_TYPES = {
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  'application/pdf': (b) => b.length > 5 && b.toString('latin1', 0, 5) === '%PDF-',
};

const PURPOSES = {
  PHARMACY_LOGO: { types: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 2 * MB, label: 'Logo', typeHint: 'a PNG, JPG or WebP image' },
  STAFF_CV: { types: ['application/pdf'], maxBytes: 5 * MB, label: 'CV', typeHint: 'a PDF file' },
};

/** Content types requireJson lets through (only routes with rawUpload read them). */
const BINARY_UPLOAD_TYPES = Object.keys(UPLOAD_TYPES);

/** Body parser for an upload route; oversize bodies become FILE_TOO_LARGE. */
function rawUpload(purpose) {
  const { types, maxBytes, label } = PURPOSES[purpose];
  const parser = express.raw({ type: types, limit: maxBytes });
  return (req, res, next) => parser(req, res, (err) => {
    if (err && err.type === 'entity.too.large') {
      return next(AppError.badRequest('FILE_TOO_LARGE', `${label} must be ${maxBytes / MB} MB or smaller.`));
    }
    return next(err);
  });
}

function cleanFileName(raw, fallback) {
  let name = '';
  try {
    name = decodeURIComponent(raw || '');
  } catch {
    name = '';
  }
  // Keep the base name only, without path or control characters.
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 255);
  return name || fallback;
}

/** Validates the uploaded body for a purpose and returns the file to store. */
function readUpload(req, purpose) {
  const { types, maxBytes, label, typeHint } = PURPOSES[purpose];
  const data = req.body;
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw AppError.badRequest('FILE_REQUIRED', `Choose ${typeHint} to upload.`);
  }
  if (data.length > maxBytes) {
    throw AppError.badRequest('FILE_TOO_LARGE', `${label} must be ${maxBytes / MB} MB or smaller.`);
  }
  const contentType = types.find((type) => UPLOAD_TYPES[type](data));
  if (!contentType) {
    throw AppError.badRequest('FILE_TYPE_NOT_ALLOWED', `${label} must be ${typeHint}.`);
  }
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' }[contentType];
  return {
    purpose,
    fileName: cleanFileName(req.get('x-file-name'), `${label.toLowerCase()}.${extension}`),
    contentType,
    data,
  };
}

async function insertFile(client, file, userId) {
  const sha256 = crypto.createHash('sha256').update(file.data).digest('hex');
  const { rows } = await query(
    `INSERT INTO stored_files (purpose, file_name, content_type, size_bytes, sha256, data, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, purpose, file_name, content_type, size_bytes, created_at`,
    [file.purpose, file.fileName, file.contentType, file.data.length, sha256, file.data, userId],
    client,
  );
  return rows[0];
}

async function findFile(id, client) {
  const { rows } = await query(
    'SELECT id, purpose, file_name, content_type, size_bytes, sha256, data, created_at FROM stored_files WHERE id = $1',
    [id],
    client,
  );
  return rows[0] || null;
}

/** Streams a stored file. Inline by default so PDFs open in the browser. */
function sendFile(res, file, { download = false, cacheSeconds = 0 } = {}) {
  const disposition = download ? 'attachment' : 'inline';
  const ascii = file.file_name.replace(/[^\x20-\x7e]/g, '_');
  res.set({
    'Content-Type': file.content_type,
    'Content-Length': String(file.size_bytes),
    'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
    'Cache-Control': cacheSeconds ? `private, max-age=${cacheSeconds}, immutable` : 'private, no-store',
    ETag: `"${file.sha256}"`,
  });
  res.status(200).end(file.data);
}

/** Public metadata for an owner's file reference (never the bytes). */
function fileMeta(row) {
  if (!row) return null;
  return {
    id: row.id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    uploadedAt: row.created_at,
  };
}

/** SQL expression for the logo URL; the file id busts browser caches on change. */
function logoUrlSql(alias) {
  return `CASE WHEN ${alias}.logo_file_id IS NULL THEN NULL ELSE '/api/v1/branding/logo?v=' || ${alias}.logo_file_id END`;
}

module.exports = {
  BINARY_UPLOAD_TYPES,
  PURPOSES,
  rawUpload,
  readUpload,
  insertFile,
  findFile,
  sendFile,
  fileMeta,
  logoUrlSql,
};
