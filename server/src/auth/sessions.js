const { query } = require('../database/db');
const { generateToken, hashToken } = require('../utils/crypto');

/**
 * Creates a server-side session. Only hashes of the session and CSRF tokens
 * are stored; the raw tokens are returned once to be set as cookies.
 */
async function createSession(client, { userId, ipAddress, userAgent }) {
  const sessionToken = generateToken(32);
  const csrfToken = generateToken(24);
  const { rows } = await query(
    `INSERT INTO user_sessions (user_id, token_hash, csrf_token_hash, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, hashToken(sessionToken), hashToken(csrfToken), ipAddress, userAgent],
    client,
  );
  return { sessionId: rows[0].id, sessionToken, csrfToken };
}

async function findActiveSession(sessionToken) {
  const { rows } = await query(
    `SELECT s.id, s.user_id, s.csrf_token_hash
       FROM user_sessions s
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
    [hashToken(sessionToken)],
  );
  return rows[0] || null;
}

async function touchSession(sessionId) {
  // Informational only; there is deliberately no inactivity timeout.
  await query(
    `UPDATE user_sessions SET last_seen_at = now()
      WHERE id = $1 AND last_seen_at < now() - interval '5 minutes'`,
    [sessionId],
  );
}

async function revokeSession(client, sessionId, reason) {
  await query(
    `UPDATE user_sessions SET revoked_at = now(), revoked_reason = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId, reason],
    client,
  );
}

/** Revokes all of a user's sessions, optionally keeping the current one. */
async function revokeUserSessions(client, userId, reason, exceptSessionId = null) {
  await query(
    `UPDATE user_sessions SET revoked_at = now(), revoked_reason = $2
      WHERE user_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id <> $3)`,
    [userId, reason, exceptSessionId],
    client,
  );
}

module.exports = { createSession, findActiveSession, touchSession, revokeSession, revokeUserSessions };
