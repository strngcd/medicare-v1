const { query, withTransaction } = require('../../database/db');
const AppError = require('../../errors/AppError');
const { hashPayload } = require('../../utils/crypto');

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,200}$/;

/**
 * Reads and validates the Idempotency-Key header. Returns null when absent.
 */
function readIdempotencyKey(req) {
  const key = req.get('idempotency-key');
  if (key === undefined || key === '') return null;
  if (!KEY_PATTERN.test(key)) {
    throw AppError.badRequest('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8-200 URL-safe characters.');
  }
  return key;
}

/**
 * Runs `work(client)` in a transaction, made idempotent by `key`.
 *
 * The key row is inserted first, inside the same transaction. A concurrent
 * request with the same key blocks on the unique index until the first one
 * commits (then it replays the stored result) or rolls back (then it
 * proceeds as a fresh attempt). A failed operation therefore never "uses up"
 * a key.
 *
 * Returns { status, body, replayed }.
 */
async function runIdempotent({ userId, scope, key, payload, successStatus = 201 }, work) {
  if (!key) {
    const body = await withTransaction(work);
    return { status: successStatus, body, replayed: false };
  }

  const requestHash = hashPayload(payload);

  return withTransaction(async (client) => {
    const inserted = await query(
      `INSERT INTO idempotency_keys (user_id, scope, idempotency_key, request_hash, response_status, response_body)
       VALUES ($1, $2, $3, $4, 0, 'null'::jsonb)
       ON CONFLICT (user_id, scope, idempotency_key) DO NOTHING
       RETURNING id`,
      [userId, scope, key, requestHash],
      client,
    );

    if (inserted.rows.length === 0) {
      const { rows } = await query(
        `SELECT request_hash, response_status, response_body FROM idempotency_keys
          WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3`,
        [userId, scope, key],
        client,
      );
      const existing = rows[0];
      if (existing.request_hash !== requestHash) {
        throw AppError.conflict(
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used for a different request.',
        );
      }
      return { status: existing.response_status, body: existing.response_body, replayed: true };
    }

    const body = await work(client);
    await query(
      `UPDATE idempotency_keys SET response_status = $1, response_body = $2 WHERE id = $3`,
      [successStatus, JSON.stringify(body), inserted.rows[0].id],
      client,
    );
    return { status: successStatus, body, replayed: false };
  });
}

module.exports = { readIdempotencyKey, runIdempotent };
