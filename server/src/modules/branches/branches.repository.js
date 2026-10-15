const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');

const BRANCH_COLUMNS = `
  b.id, b.name, b.code, b.phone, b.email, b.address, b.city, b.country, b.status,
  b.manager_user_id, m.full_name AS manager_name,
  b.created_at, b.updated_at, b.deactivated_at, b.deactivated_by`;

async function list({ branchIds, status, search, limit, offset, orderBy }) {
  const w = whereBuilder();
  w.add('b.deleted_at IS NULL');
  if (branchIds) w.add('b.id = ANY(?::uuid[])', branchIds);
  if (status) w.add('b.status = ?', status);
  if (search) w.add('(b.name ILIKE ? OR b.code ILIKE ? OR b.city ILIKE ?)', `%${search}%`, `%${search}%`, `%${search}%`);

  const { rows } = await query(
    `SELECT ${BRANCH_COLUMNS},
            (SELECT count(*) FROM user_branches ub JOIN users u ON u.id = ub.user_id
              WHERE ub.branch_id = b.id AND u.status = 'ACTIVE') AS active_staff_count,
            count(*) OVER() AS total_count
       FROM branches b LEFT JOIN users m ON m.id = b.manager_user_id
       ${w.sql}
      ORDER BY ${orderBy}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function findById(id, client, { forUpdate = false } = {}) {
  const { rows } = await query(
    `SELECT ${BRANCH_COLUMNS}
       FROM branches b LEFT JOIN users m ON m.id = b.manager_user_id
      WHERE b.id = $1 AND b.deleted_at IS NULL ${forUpdate ? 'FOR UPDATE OF b' : ''}`,
    [id],
    client,
  );
  return rows[0] || null;
}

async function findByCode(code, client) {
  const { rows } = await query('SELECT id FROM branches WHERE code = $1 AND deleted_at IS NULL', [code], client);
  return rows[0] || null;
}

async function insert(client, data) {
  const { rows } = await query(
    `INSERT INTO branches (name, code, phone, email, address, city, country, manager_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [data.name, data.code, data.phone, data.email, data.address, data.city, data.country, data.managerUserId],
    client,
  );
  await query('INSERT INTO branch_settings (branch_id) VALUES ($1)', [rows[0].id], client);
  return rows[0].id;
}

const UPDATABLE = {
  name: 'name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  city: 'city',
  country: 'country',
  managerUserId: 'manager_user_id',
};

async function update(client, id, changes) {
  const sets = [];
  const params = [id];
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (changes[key] !== undefined) {
      params.push(changes[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (sets.length === 0) return;
  await query(`UPDATE branches SET ${sets.join(', ')} WHERE id = $1`, params, client);
}

async function setStatus(client, id, status, actorId) {
  await query(
    `UPDATE branches
        SET status = $2,
            deactivated_at = CASE WHEN $2 = 'INACTIVE' THEN now() ELSE NULL END,
            deactivated_by = CASE WHEN $2 = 'INACTIVE' THEN $3::uuid ELSE NULL END
      WHERE id = $1`,
    [id, status, actorId],
    client,
  );
}

/** Active non-Owner staff for whom this is their only active branch. */
async function findStaffDependingOnBranch(client, branchId) {
  const { rows } = await query(
    `SELECT u.id, u.full_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       JOIN user_branches ub ON ub.user_id = u.id AND ub.branch_id = $1
      WHERE u.status = 'ACTIVE' AND r.code <> 'OWNER'
        AND NOT EXISTS (
          SELECT 1 FROM user_branches other
            JOIN branches ob ON ob.id = other.branch_id
           WHERE other.user_id = u.id AND other.branch_id <> $1 AND ob.status = 'ACTIVE'
        )`,
    [branchId],
    client,
  );
  return rows;
}

async function countOpenTransfers(client, branchId) {
  const { rows } = await query(
    `SELECT count(*) AS n FROM transfers
      WHERE status = 'IN_TRANSIT' AND (source_branch_id = $1 OR destination_branch_id = $1)`,
    [branchId],
    client,
  );
  return rows[0].n;
}

async function listUsers(branchId) {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, u.employee_id, u.job_title, u.status,
            r.code AS role_code, r.name AS role_name, ub.assigned_at
       FROM user_branches ub
       JOIN users u ON u.id = ub.user_id
       JOIN roles r ON r.id = u.role_id
      WHERE ub.branch_id = $1
      ORDER BY u.status, u.full_name`,
    [branchId],
  );
  return rows;
}

async function isUserAssigned(client, userId, branchId) {
  const { rows } = await query(
    `SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1 AND u.status = 'ACTIVE'
        AND (r.code = 'OWNER' OR EXISTS (SELECT 1 FROM user_branches WHERE user_id = u.id AND branch_id = $2))`,
    [userId, branchId],
    client,
  );
  return rows.length > 0;
}

async function findSettings(branchId, client) {
  const { rows } = await query(
    `SELECT branch_id, default_minimum_stock, receipt_show_tax, receipt_show_discount,
            receipt_show_branch_address, receipt_show_branch_phone, receipt_show_staff,
            receipt_footer, updated_by, updated_at
       FROM branch_settings WHERE branch_id = $1`,
    [branchId],
    client,
  );
  return rows[0] || null;
}

const SETTINGS_COLUMNS = {
  defaultMinimumStock: 'default_minimum_stock',
  receiptShowTax: 'receipt_show_tax',
  receiptShowDiscount: 'receipt_show_discount',
  receiptShowBranchAddress: 'receipt_show_branch_address',
  receiptShowBranchPhone: 'receipt_show_branch_phone',
  receiptShowStaff: 'receipt_show_staff',
  receiptFooter: 'receipt_footer',
};

async function updateSettings(client, branchId, changes, actorId) {
  const sets = ['updated_by = $2'];
  const params = [branchId, actorId];
  for (const [key, column] of Object.entries(SETTINGS_COLUMNS)) {
    if (changes[key] !== undefined) {
      params.push(changes[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  await query(
    `INSERT INTO branch_settings (branch_id) VALUES ($1) ON CONFLICT (branch_id) DO NOTHING`,
    [branchId],
    client,
  );
  await query(`UPDATE branch_settings SET ${sets.join(', ')} WHERE branch_id = $1`, params, client);
}

/** True once any business record (stock, sales, purchases, transfers, money) refers to the branch. */
async function hasActivity(id, client) {
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM branch_inventory WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM stock_movements WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM sales WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM refunds WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM purchases WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM supplier_payments WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM inventory_adjustments WHERE branch_id = $1)
         OR EXISTS (SELECT 1 FROM transfers WHERE source_branch_id = $1 OR destination_branch_id = $1) AS used`,
    [id],
    client,
  );
  return rows[0].used;
}

/** Soft delete: hidden everywhere from now on; staff lose the assignment. */
async function markDeleted(client, id, actorId) {
  await query('DELETE FROM user_branches WHERE branch_id = $1', [id], client);
  await query(
    'UPDATE users SET last_selected_branch_id = NULL WHERE last_selected_branch_id = $1 AND deleted_at IS NULL',
    [id],
    client,
  );
  await query(
    `UPDATE branches
        SET status = 'INACTIVE', manager_user_id = NULL,
            deactivated_at = COALESCE(deactivated_at, now()), deactivated_by = COALESCE(deactivated_by, $2),
            deleted_at = now(), deleted_by = $2
      WHERE id = $1`,
    [id, actorId],
    client,
  );
}

module.exports = {
  hasActivity,
  markDeleted,
  list,
  findById,
  findByCode,
  insert,
  update,
  setStatus,
  findStaffDependingOnBranch,
  countOpenTransfers,
  listUsers,
  isUserAssigned,
  findSettings,
  updateSettings,
};
