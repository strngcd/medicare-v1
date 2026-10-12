const { pool } = require('../../src/database/db');
const { hashPassword } = require('../../src/auth/password');

const DEFAULT_PASSWORD = 'Password123';
let counter = 0;

async function createBranch(overrides = {}) {
  counter += 1;
  const { rows } = await pool.query(
    `INSERT INTO branches (name, code, status) VALUES ($1, $2, $3) RETURNING *`,
    [overrides.name || `Branch ${counter}`, overrides.code || `BR${counter}`, overrides.status || 'ACTIVE'],
  );
  await pool.query('INSERT INTO branch_settings (branch_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0].id]);
  return rows[0];
}

async function createUser({ role = 'CASHIER', branches = [], status = 'ACTIVE', password = DEFAULT_PASSWORD, ...rest } = {}) {
  counter += 1;
  const email = rest.email || `user${counter}@example.com`;
  const passwordHash = password ? await hashPassword(password) : null;
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role_id, status, employee_id)
     SELECT $1, $2, $3, r.id, $4, $5 FROM roles r WHERE r.code = $6
     RETURNING id, full_name, email`,
    [rest.fullName || `User ${counter}`, email, passwordHash, status, rest.employeeId || `EMP${counter}`, role],
  );
  const user = rows[0];
  for (const branch of branches) {
    await pool.query('INSERT INTO user_branches (user_id, branch_id) VALUES ($1, $2)', [user.id, branch.id || branch]);
  }
  return { ...user, password };
}

async function setOverride(userId, permissionCode, granted) {
  await pool.query(
    `INSERT INTO user_permission_overrides (user_id, permission_id, granted)
     SELECT $1, id, $3 FROM permissions WHERE code = $2
     ON CONFLICT (user_id, permission_id) DO UPDATE SET granted = EXCLUDED.granted`,
    [userId, permissionCode, granted],
  );
}

module.exports = { createBranch, createUser, setOverride, DEFAULT_PASSWORD };
