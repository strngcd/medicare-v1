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

async function createMedicine(overrides = {}) {
  counter += 1;
  const { rows } = await pool.query(
    `INSERT INTO medicines (name, package_size, prescription_required, status, barcode, category_id, strength)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      overrides.name || `Medicine ${counter}`,
      overrides.packageSize || '10 tablets',
      overrides.prescriptionRequired || false,
      overrides.status || 'ACTIVE',
      overrides.barcode || null,
      overrides.categoryId || null,
      overrides.strength || null,
    ],
  );
  return rows[0];
}

/**
 * Inserts a batch + branch inventory directly (bypassing the API), e.g. to
 * create already-expired stock that the API would refuse. Records an opening
 * movement so the ledger stays consistent.
 */
async function createStock({ branch, medicine, user, batchNumber, expiryDate = '2030-01-01', quantity = 10, purchasePrice = '5.00', sellingPrice = '8.00', minimumStock = 0 }) {
  counter += 1;
  const batch = await pool.query(
    `INSERT INTO batches (medicine_id, batch_number, expiry_date, purchase_price)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (medicine_id, batch_number) DO UPDATE SET expiry_date = batches.expiry_date
     RETURNING *`,
    [medicine.id, batchNumber || `B${counter}`, expiryDate, purchasePrice],
  );
  const inventory = await pool.query(
    `INSERT INTO branch_inventory (branch_id, batch_id, quantity, minimum_stock, selling_price)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [branch.id, batch.rows[0].id, quantity, minimumStock, sellingPrice],
  );
  if (quantity > 0) {
    await pool.query(
      `INSERT INTO stock_movements (branch_id, batch_id, movement_type, quantity_change, quantity_before,
         quantity_after, reference_type, reference_id, reason, created_by)
       VALUES ($1, $2, 'ADJUSTMENT', $3, 0, $3, 'STOCK_ADDITION', $4, 'Test opening stock', $5)`,
      [branch.id, batch.rows[0].id, quantity, inventory.rows[0].id, user.id],
    );
  }
  return { batch: batch.rows[0], inventory: inventory.rows[0] };
}

module.exports.createMedicine = createMedicine;
module.exports.createStock = createStock;
