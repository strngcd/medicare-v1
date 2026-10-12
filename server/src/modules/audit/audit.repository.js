const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');

const AUDIT_COLUMNS = `
  a.id, a."timestamp", a.user_id, u.full_name AS user_name, a.role_at_time, a.branch_id, b.name AS branch_name,
  a.action, a.entity_type, a.entity_id, a.description, a.previous_values, a.new_values,
  a.ip_address, a.user_agent, a.created_at`;

function scopeClause(w, branchIds) {
  // Non-owners see entries of their branches plus organization-level entries.
  if (branchIds) w.add('(a.branch_id IS NULL OR a.branch_id = ANY(?::uuid[]))', branchIds);
}

async function listAudit(f) {
  const w = whereBuilder();
  scopeClause(w, f.branchIds);
  if (f.branchId) w.add('a.branch_id = ?', f.branchId);
  if (f.userId) w.add('a.user_id = ?', f.userId);
  if (f.action) w.add('a.action = ?', f.action);
  if (f.entityType) w.add('a.entity_type = ?', f.entityType);
  if (f.entityId) w.add('a.entity_id = ?', f.entityId);
  if (f.search) w.add('a.description ILIKE ?', `%${f.search}%`);
  if (f.dateFrom) w.add('(a."timestamp" AT TIME ZONE ?)::date >= ?::date', f.timezone, f.dateFrom);
  if (f.dateTo) w.add('(a."timestamp" AT TIME ZONE ?)::date <= ?::date', f.timezone, f.dateTo);
  const { rows } = await query(
    `SELECT ${AUDIT_COLUMNS}, count(*) OVER() AS total_count
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN branches b ON b.id = a.branch_id
       ${w.sql}
      ORDER BY a."timestamp" DESC, a.id
      LIMIT ${w.param(f.limit)} OFFSET ${w.param(f.offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function findAudit(id) {
  const { rows } = await query(
    `SELECT ${AUDIT_COLUMNS} FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN branches b ON b.id = a.branch_id
      WHERE a.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function listActions() {
  const { rows } = await query('SELECT DISTINCT action FROM audit_logs ORDER BY action');
  return rows.map((r) => r.action);
}

async function listLoginHistory(f) {
  const w = whereBuilder();
  if (f.branchIds) {
    // Events in the viewer's branches, or by staff who share a branch with the viewer.
    w.add(
      `(h.branch_id = ANY(?::uuid[]) OR EXISTS (
          SELECT 1 FROM user_branches ub WHERE ub.user_id = h.user_id AND ub.branch_id = ANY(?::uuid[])))`,
      f.branchIds,
      f.branchIds,
    );
  }
  if (f.userId) w.add('h.user_id = ?', f.userId);
  if (f.eventType) w.add('h.event_type = ?', f.eventType);
  if (f.success !== undefined) w.add('h.success = ?', f.success);
  if (f.failureCategory) w.add('h.failure_category = ?', f.failureCategory);
  if (f.dateFrom) w.add('(h.created_at AT TIME ZONE ?)::date >= ?::date', f.timezone, f.dateFrom);
  if (f.dateTo) w.add('(h.created_at AT TIME ZONE ?)::date <= ?::date', f.timezone, f.dateTo);
  const { rows } = await query(
    `SELECT h.id, h.user_id, u.full_name AS user_name, u.email AS user_email, h.event_type, h.success,
            h.ip_address, h.user_agent, h.branch_id, b.name AS branch_name, h.failure_category, h.created_at,
            count(*) OVER() AS total_count
       FROM login_history h LEFT JOIN users u ON u.id = h.user_id LEFT JOIN branches b ON b.id = h.branch_id
       ${w.sql}
      ORDER BY h.created_at DESC, h.id
      LIMIT ${w.param(f.limit)} OFFSET ${w.param(f.offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

module.exports = { listAudit, findAudit, listActions, listLoginHistory };
