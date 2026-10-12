const { query } = require('../../database/db');

// Any key that looks like a credential is stripped before an audit write.
const SECRET_KEY_PATTERN = /(password|token|secret|hash|api_?key|credential)/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const clean = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!SECRET_KEY_PATTERN.test(key)) clean[key] = sanitize(inner);
    }
    return clean;
  }
  return value;
}

/**
 * Builds the "who/where" part of an audit record from an authenticated request.
 */
function actorFromRequest(req) {
  return {
    userId: req.auth ? req.auth.userId : null,
    roleCode: req.auth ? req.auth.roleCode : null,
    ipAddress: req.context ? req.context.ipAddress : null,
    userAgent: req.context ? req.context.userAgent : null,
  };
}

/**
 * Appends an audit record. Pass the transaction client so the audit entry
 * commits or rolls back together with the business operation.
 */
async function recordAudit(client, actor, entry) {
  await query(
    `INSERT INTO audit_logs (user_id, role_at_time, branch_id, action, entity_type, entity_id,
       description, previous_values, new_values, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      actor.userId || null,
      actor.roleCode || null,
      entry.branchId || null,
      entry.action,
      entry.entityType,
      entry.entityId || null,
      entry.description,
      entry.previousValues ? JSON.stringify(sanitize(entry.previousValues)) : null,
      entry.newValues ? JSON.stringify(sanitize(entry.newValues)) : null,
      actor.ipAddress || null,
      actor.userAgent || null,
    ],
    client,
  );
}

/** Returns only the keys whose values differ, as { previous, next }. */
function diff(previous, next, keys) {
  const before = {};
  const after = {};
  for (const key of keys) {
    if (next[key] !== undefined && String(previous[key] ?? '') !== String(next[key] ?? '')) {
      before[key] = previous[key] ?? null;
      after[key] = next[key] ?? null;
    }
  }
  return { previous: before, next: after, changed: Object.keys(after).length > 0 };
}

module.exports = { recordAudit, actorFromRequest, sanitize, diff };
