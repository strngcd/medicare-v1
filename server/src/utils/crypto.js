const crypto = require('crypto');

/** A URL-safe random token suitable for sessions, CSRF and password links. */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes. */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Stable hash of a request payload, used to detect idempotency-key reuse. */
function hashPayload(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
}

/** Constant-time comparison of two hex digests. */
function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

module.exports = { generateToken, hashToken, hashPayload, safeEqualHex };
