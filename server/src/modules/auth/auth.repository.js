const { query } = require('../../database/db');

async function findUserForLogin(email, client) {
  const { rows } = await query(
    'SELECT id, password_hash, status, last_selected_branch_id FROM users WHERE lower(email) = lower($1)',
    [email],
    client,
  );
  return rows[0] || null;
}

async function findUserPasswordHash(userId, client) {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId], client);
  return rows[0] ? rows[0].password_hash : null;
}

async function countRecentFailures(email, ipAddress, windowMinutes) {
  const { rows } = await query(
    `SELECT
       count(*) FILTER (WHERE email = $1) AS by_email,
       count(*) FILTER (WHERE ip_address = $2) AS by_ip
       FROM login_attempts
      WHERE success = false
        AND created_at > now() - make_interval(mins => $3)
        AND (email = $1 OR ip_address = $2)`,
    [email, ipAddress, windowMinutes],
  );
  return { byEmail: rows[0].by_email, byIp: rows[0].by_ip };
}

async function recordLoginAttempt(email, ipAddress, success, client) {
  await query(
    'INSERT INTO login_attempts (email, ip_address, success) VALUES ($1, $2, $3)',
    [email, ipAddress, success],
    client,
  );
}

/** A successful login clears the failure window for that email. */
async function clearLoginFailures(email, client) {
  await query('DELETE FROM login_attempts WHERE email = $1 AND success = false', [email], client);
}

async function recordLoginHistory(client, entry) {
  await query(
    `INSERT INTO login_history (user_id, event_type, success, ip_address, user_agent, branch_id, failure_category)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.userId || null,
      entry.eventType,
      entry.success,
      entry.ipAddress || null,
      entry.userAgent || null,
      entry.branchId || null,
      entry.failureCategory || null,
    ],
    client,
  );
}

async function markLoggedIn(client, userId, branchId) {
  await query(
    'UPDATE users SET last_login_at = now(), last_selected_branch_id = COALESCE($2, last_selected_branch_id) WHERE id = $1',
    [userId, branchId],
    client,
  );
}

async function listActiveBranchesForUser(userId, isOwner, client) {
  const { rows } = isOwner
    ? await query(
        `SELECT id, name, code, status FROM branches ORDER BY status, name`,
        [],
        client,
      )
    : await query(
        `SELECT b.id, b.name, b.code, b.status
           FROM user_branches ub JOIN branches b ON b.id = ub.branch_id
          WHERE ub.user_id = $1
          ORDER BY b.status, b.name`,
        [userId],
        client,
      );
  return rows;
}

async function findProfile(userId, client) {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.employee_id, u.job_title, u.hire_date,
            u.last_login_at, u.last_selected_branch_id,
            COALESCE(p.theme, 'SYSTEM') AS theme,
            COALESCE(p.page_size, 25) AS page_size,
            COALESCE(p.ui_density, 'COMFORTABLE') AS ui_density
       FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id
      WHERE u.id = $1`,
    [userId],
    client,
  );
  return rows[0] || null;
}

async function createPasswordToken(client, { userId, purpose, tokenHash, expiresAt, createdBy }) {
  // Any earlier unused link of the same purpose stops working.
  await query(
    `UPDATE password_tokens SET used_at = now()
      WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose],
    client,
  );
  await query(
    `INSERT INTO password_tokens (user_id, purpose, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, purpose, tokenHash, expiresAt, createdBy || null],
    client,
  );
}

async function countRecentResetRequests(userId) {
  const { rows } = await query(
    `SELECT count(*) AS n FROM password_tokens
      WHERE user_id = $1 AND purpose = 'PASSWORD_RESET' AND created_at > now() - interval '15 minutes'`,
    [userId],
  );
  return rows[0].n;
}

/** Locks and returns a usable token row, or null if missing/used/expired. */
async function claimPasswordToken(client, tokenHash) {
  const { rows } = await query(
    `SELECT t.id, t.user_id, t.purpose, u.status
       FROM password_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now()
      FOR UPDATE OF t`,
    [tokenHash],
    client,
  );
  return rows[0] || null;
}

async function markPasswordTokenUsed(client, tokenId) {
  await query('UPDATE password_tokens SET used_at = now() WHERE id = $1', [tokenId], client);
}

async function updatePasswordHash(client, userId, passwordHash) {
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash], client);
}

module.exports = {
  findUserForLogin,
  findUserPasswordHash,
  countRecentFailures,
  recordLoginAttempt,
  clearLoginFailures,
  recordLoginHistory,
  markLoggedIn,
  listActiveBranchesForUser,
  findProfile,
  createPasswordToken,
  countRecentResetRequests,
  claimPasswordToken,
  markPasswordTokenUsed,
  updatePasswordHash,
};
