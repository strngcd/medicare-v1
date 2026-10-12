const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');

// Explicit column list: password_hash is never selected.
const USER_COLUMNS = `
  u.id, u.full_name, u.email, u.phone, u.status, u.employee_id, u.job_title, u.hire_date,
  u.last_login_at, u.last_selected_branch_id, u.deactivated_at, u.deactivated_by,
  u.created_at, u.updated_at, (u.password_hash IS NOT NULL) AS has_password,
  r.code AS role_code, r.name AS role_name, r.rank AS role_rank`;

const BRANCHES_JSON = `
  COALESCE((SELECT json_agg(json_build_object('id', b.id, 'name', b.name, 'code', b.code, 'status', b.status)
                            ORDER BY b.name)
              FROM user_branches ub JOIN branches b ON b.id = ub.branch_id
             WHERE ub.user_id = u.id), '[]') AS branches`;

/**
 * Lists staff. Non-Owners only see users who share at least one of their
 * branches (plus Owners, who are organization-wide).
 */
async function list({ visibleBranchIds, search, roleCode, branchId, status, limit, offset, orderBy }) {
  const w = whereBuilder();
  if (visibleBranchIds) {
    w.add(
      `(r.code = 'OWNER' OR EXISTS (SELECT 1 FROM user_branches vb WHERE vb.user_id = u.id AND vb.branch_id = ANY(?::uuid[])))`,
      visibleBranchIds,
    );
  }
  if (search) {
    w.add('(u.full_name ILIKE ? OR u.email ILIKE ? OR u.employee_id ILIKE ?)', `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (roleCode) w.add('r.code = ?', roleCode);
  if (status) w.add('u.status = ?', status);
  if (branchId) w.add('EXISTS (SELECT 1 FROM user_branches fb WHERE fb.user_id = u.id AND fb.branch_id = ?)', branchId);

  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, ${BRANCHES_JSON}, count(*) OVER() AS total_count
       FROM users u JOIN roles r ON r.id = u.role_id
       ${w.sql}
      ORDER BY ${orderBy}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

/**
 * With forUpdate, the user row is locked first and then re-read, so the
 * embedded branch list reflects changes committed while waiting for the lock.
 */
async function findById(id, client, { forUpdate = false } = {}) {
  if (forUpdate) await query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id], client);
  const { rows } = await query(
    `SELECT ${USER_COLUMNS}, ${BRANCHES_JSON}
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`,
    [id],
    client,
  );
  return rows[0] || null;
}

async function findRoleByCode(code, client) {
  const { rows } = await query('SELECT id, code, name, rank FROM roles WHERE code = $1', [code], client);
  return rows[0] || null;
}

async function findConflicts(client, { email, employeeId, excludeUserId }) {
  const { rows } = await query(
    `SELECT
       EXISTS (SELECT 1 FROM users WHERE lower(email) = lower($1) AND ($3::uuid IS NULL OR id <> $3)) AS email_taken,
       ($2::text IS NOT NULL AND EXISTS (
         SELECT 1 FROM users WHERE lower(employee_id) = lower($2) AND ($3::uuid IS NULL OR id <> $3)
       )) AS employee_id_taken`,
    [email || null, employeeId || null, excludeUserId || null],
    client,
  );
  return { emailTaken: rows[0].email_taken, employeeIdTaken: rows[0].employee_id_taken };
}

async function insert(client, data) {
  const { rows } = await query(
    `INSERT INTO users (full_name, email, phone, role_id, employee_id, job_title, hire_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [data.fullName, data.email, data.phone, data.roleId, data.employeeId, data.jobTitle, data.hireDate],
    client,
  );
  return rows[0].id;
}

const PROFILE_COLUMNS = {
  fullName: 'full_name',
  email: 'email',
  phone: 'phone',
  employeeId: 'employee_id',
  jobTitle: 'job_title',
  hireDate: 'hire_date',
};

async function updateProfile(client, id, changes) {
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(PROFILE_COLUMNS)) {
    if (changes[key] !== undefined) {
      params.push(changes[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length) await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params, client);
}

async function updateRole(client, id, roleId) {
  await query('UPDATE users SET role_id = $2 WHERE id = $1', [id, roleId], client);
}

async function setStatus(client, id, status, actorId) {
  await query(
    `UPDATE users
        SET status = $2,
            deactivated_at = CASE WHEN $2 = 'INACTIVE' THEN now() ELSE NULL END,
            deactivated_by = CASE WHEN $2 = 'INACTIVE' THEN $3::uuid ELSE NULL END
      WHERE id = $1`,
    [id, status, actorId],
    client,
  );
}

async function countActiveOwners(client) {
  const { rows } = await query(
    `SELECT count(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
      WHERE r.code = 'OWNER' AND u.status = 'ACTIVE'`,
    [],
    client,
  );
  return rows[0].n;
}

async function findBranchesByIds(client, ids) {
  const { rows } = await query('SELECT id, name, code, status FROM branches WHERE id = ANY($1::uuid[])', [ids], client);
  return rows;
}

async function replaceBranches(client, userId, { add, remove }, actorId) {
  if (remove.length) {
    await query('DELETE FROM user_branches WHERE user_id = $1 AND branch_id = ANY($2::uuid[])', [userId, remove], client);
  }
  if (add.length) {
    await query(
      `INSERT INTO user_branches (user_id, branch_id, assigned_by)
       SELECT $1, unnest($2::uuid[]), $3 ON CONFLICT DO NOTHING`,
      [userId, add, actorId],
      client,
    );
  }
}

async function countActiveBranches(client, userId) {
  const { rows } = await query(
    `SELECT count(*) AS n FROM user_branches ub JOIN branches b ON b.id = ub.branch_id
      WHERE ub.user_id = $1 AND b.status = 'ACTIVE'`,
    [userId],
    client,
  );
  return rows[0].n;
}

async function listOverrides(userId, client) {
  const { rows } = await query(
    `SELECT p.code, o.granted, o.updated_at, o.set_by
       FROM user_permission_overrides o JOIN permissions p ON p.id = o.permission_id
      WHERE o.user_id = $1`,
    [userId],
    client,
  );
  return rows;
}

async function listRolePermissionCodes(roleCode, client) {
  const { rows } = await query(
    `SELECT p.code FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
      WHERE r.code = $1`,
    [roleCode],
    client,
  );
  return rows.map((r) => r.code);
}

async function listPermissionCatalog(client) {
  const { rows } = await query('SELECT code, module, description FROM permissions ORDER BY module, code', [], client);
  return rows;
}

async function upsertOverride(client, userId, code, granted, actorId) {
  await query(
    `INSERT INTO user_permission_overrides (user_id, permission_id, granted, set_by)
     SELECT $1, id, $3, $4 FROM permissions WHERE code = $2
     ON CONFLICT (user_id, permission_id) DO UPDATE SET granted = EXCLUDED.granted, set_by = EXCLUDED.set_by`,
    [userId, code, granted, actorId],
    client,
  );
}

async function deleteOverride(client, userId, code) {
  await query(
    `DELETE FROM user_permission_overrides o USING permissions p
      WHERE o.permission_id = p.id AND o.user_id = $1 AND p.code = $2`,
    [userId, code],
    client,
  );
}

async function getPreferences(userId, client) {
  const { rows } = await query(
    `SELECT COALESCE(p.theme, 'SYSTEM') AS theme, COALESCE(p.page_size, 25) AS page_size,
            COALESCE(p.ui_density, 'COMFORTABLE') AS ui_density, u.last_selected_branch_id
       FROM users u LEFT JOIN user_preferences p ON p.user_id = u.id
      WHERE u.id = $1`,
    [userId],
    client,
  );
  return rows[0];
}

async function upsertPreferences(client, userId, { theme, pageSize, uiDensity }) {
  await query(
    `INSERT INTO user_preferences (user_id, theme, page_size, ui_density)
     VALUES ($1, COALESCE($2, 'SYSTEM'), COALESCE($3, 25), COALESCE($4, 'COMFORTABLE'))
     ON CONFLICT (user_id) DO UPDATE SET
       theme = COALESCE($2, user_preferences.theme),
       page_size = COALESCE($3, user_preferences.page_size),
       ui_density = COALESCE($4, user_preferences.ui_density)`,
    [userId, theme ?? null, pageSize ?? null, uiDensity ?? null],
    client,
  );
}

async function setLastSelectedBranch(client, userId, branchId) {
  await query('UPDATE users SET last_selected_branch_id = $2 WHERE id = $1', [userId, branchId], client);
}

async function listActivity(userId, { limit, offset }) {
  const { rows } = await query(
    `SELECT a.id, a."timestamp", a.action, a.entity_type, a.entity_id, a.description, a.branch_id,
            b.name AS branch_name, count(*) OVER() AS total_count
       FROM audit_logs a LEFT JOIN branches b ON b.id = a.branch_id
      WHERE a.user_id = $1
      ORDER BY a."timestamp" DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

module.exports = {
  list,
  findById,
  findRoleByCode,
  findConflicts,
  insert,
  updateProfile,
  updateRole,
  setStatus,
  countActiveOwners,
  findBranchesByIds,
  replaceBranches,
  countActiveBranches,
  listOverrides,
  listRolePermissionCodes,
  listPermissionCatalog,
  upsertOverride,
  deleteOverride,
  getPreferences,
  upsertPreferences,
  setLastSelectedBranch,
  listActivity,
};
