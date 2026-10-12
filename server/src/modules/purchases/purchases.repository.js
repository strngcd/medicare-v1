const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');

// Paid amount and derived payment status for a purchase row aliased "p".
const PAYMENT_COLUMNS = `
  COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0)::numeric(14,2) AS amount_paid,
  CASE
    WHEN p.status IN ('DRAFT', 'CANCELLED') THEN NULL
    WHEN COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0) = 0 THEN 'UNPAID'
    WHEN COALESCE((SELECT sum(sp.amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0) >= p.total THEN 'PAID'
    ELSE 'PARTIALLY_PAID'
  END AS payment_status`;

const PURCHASE_COLUMNS = `
  p.id, p.purchase_number, p.supplier_id, s.company_name AS supplier_name, p.branch_id,
  br.name AS branch_name, br.code AS branch_code, p.status, p.purchase_date, p.expected_date,
  p.subtotal, p.discount, p.tax, p.total, p.notes, p.created_by, cu.full_name AS created_by_name,
  p.updated_by, p.created_at, p.updated_at, p.cancelled_at, p.cancelled_by, p.cancel_reason,
  ${PAYMENT_COLUMNS}`;

const PURCHASE_FROM = `
  purchases p
  JOIN suppliers s ON s.id = p.supplier_id
  JOIN branches br ON br.id = p.branch_id
  JOIN users cu ON cu.id = p.created_by`;

async function list({ branchIds, supplierId, status, paymentStatus, dateFrom, dateTo, search, limit, offset, orderBy }) {
  const w = whereBuilder();
  if (branchIds) w.add('p.branch_id = ANY(?::uuid[])', branchIds);
  if (supplierId) w.add('p.supplier_id = ?', supplierId);
  if (status) w.add('p.status = ?', status);
  if (dateFrom) w.add('p.purchase_date >= ?::date', dateFrom);
  if (dateTo) w.add('p.purchase_date <= ?::date', dateTo);
  if (search) w.add('(p.purchase_number ILIKE ? OR s.company_name ILIKE ?)', `%${search}%`, `%${search}%`);

  const paymentFilter = paymentStatus ? `WHERE payment_status = ${w.param(paymentStatus)}` : '';
  const { rows } = await query(
    `SELECT *, count(*) OVER() AS total_count FROM (
       SELECT ${PURCHASE_COLUMNS},
              (SELECT count(*) FROM purchase_items pi WHERE pi.purchase_id = p.id)::int AS item_count
         FROM ${PURCHASE_FROM}
         ${w.sql}
     ) listed
     ${paymentFilter}
     ORDER BY ${orderBy}
     LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

/**
 * With forUpdate, the purchase row is locked first and the derived columns
 * (e.g. amount paid) are read by a second statement. Under READ COMMITTED a
 * new statement sees everything committed while we waited for the lock;
 * a subquery inside the locking statement would not.
 */
async function findById(id, client, { forUpdate = false } = {}) {
  if (forUpdate) await query('SELECT id FROM purchases WHERE id = $1 FOR UPDATE', [id], client);
  const { rows } = await query(`SELECT ${PURCHASE_COLUMNS} FROM ${PURCHASE_FROM} WHERE p.id = $1`, [id], client);
  return rows[0] || null;
}

async function listItems(purchaseId, client, { forUpdate = false } = {}) {
  const { rows } = await query(
    `SELECT pi.id, pi.purchase_id, pi.medicine_id, m.name AS medicine_name, m.strength, m.dosage_form,
            m.package_size, m.status AS medicine_status, pi.ordered_quantity, pi.received_quantity,
            (pi.ordered_quantity - pi.received_quantity) AS remaining_quantity,
            pi.unit_purchase_price, pi.discount, pi.tax, pi.line_total, pi.notes, pi.created_at
       FROM purchase_items pi JOIN medicines m ON m.id = pi.medicine_id
      WHERE pi.purchase_id = $1
      ORDER BY m.name, pi.id
      ${forUpdate ? 'FOR UPDATE OF pi' : ''}`,
    [purchaseId],
    client,
  );
  return rows;
}

async function insertPurchase(client, data) {
  const { rows } = await query(
    `INSERT INTO purchases (purchase_number, supplier_id, branch_id, status, purchase_date, expected_date,
       subtotal, discount, tax, total, notes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING id`,
    [
      data.purchaseNumber, data.supplierId, data.branchId, data.status, data.purchaseDate, data.expectedDate ?? null,
      data.totals.subtotal, data.totals.discount, data.totals.tax, data.totals.total, data.notes ?? null, data.userId,
    ],
    client,
  );
  return rows[0].id;
}

async function insertItems(client, purchaseId, items) {
  for (const item of items) {
    await query(
      `INSERT INTO purchase_items (purchase_id, medicine_id, ordered_quantity, unit_purchase_price, discount, tax, line_total, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [purchaseId, item.medicineId, item.orderedQuantity, item.unitPurchasePrice, item.discount, item.tax, item.lineTotal, item.notes ?? null],
      client,
    );
  }
}

async function deleteItems(client, purchaseId) {
  await query('DELETE FROM purchase_items WHERE purchase_id = $1', [purchaseId], client);
}

async function updatePurchase(client, id, changes, userId) {
  const columns = {
    supplierId: 'supplier_id',
    status: 'status',
    purchaseDate: 'purchase_date',
    expectedDate: 'expected_date',
    notes: 'notes',
  };
  const sets = ['updated_by = $2'];
  const params = [id, userId];
  for (const [key, column] of Object.entries(columns)) {
    if (changes[key] !== undefined) {
      params.push(changes[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (changes.totals) {
    for (const key of ['subtotal', 'discount', 'tax', 'total']) {
      params.push(changes.totals[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  await query(`UPDATE purchases SET ${sets.join(', ')} WHERE id = $1`, params, client);
}

async function setStatus(client, id, status, userId) {
  await query('UPDATE purchases SET status = $2, updated_by = $3 WHERE id = $1', [id, status, userId], client);
}

async function cancel(client, id, reason, userId) {
  await query(
    `UPDATE purchases SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $3, cancel_reason = $2, updated_by = $3
      WHERE id = $1`,
    [id, reason, userId],
    client,
  );
}

async function findMedicines(client, ids) {
  const { rows } = await query('SELECT id, name, status FROM medicines WHERE id = ANY($1::uuid[])', [ids], client);
  return rows;
}

async function findSupplier(client, id) {
  const { rows } = await query('SELECT id, company_name, status FROM suppliers WHERE id = $1', [id], client);
  return rows[0] || null;
}

async function insertReceiving(client, { purchaseId, branchId, userId, notes }) {
  const { rows } = await query(
    `INSERT INTO purchase_receivings (purchase_id, branch_id, received_by, notes)
     VALUES ($1, $2, $3, $4) RETURNING id, received_at`,
    [purchaseId, branchId, userId, notes ?? null],
    client,
  );
  return rows[0];
}

async function insertReceivingItem(client, data) {
  await query(
    `INSERT INTO purchase_receiving_items (receiving_id, purchase_item_id, batch_id, quantity, purchase_price, selling_price, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [data.receivingId, data.purchaseItemId, data.batchId, data.quantity, data.purchasePrice, data.sellingPrice, data.notes ?? null],
    client,
  );
}

async function incrementReceived(client, purchaseItemId, quantity) {
  await query(
    'UPDATE purchase_items SET received_quantity = received_quantity + $2 WHERE id = $1',
    [purchaseItemId, quantity],
    client,
  );
}

async function listReceivings(purchaseId) {
  const { rows } = await query(
    `SELECT r.id, r.purchase_id, r.branch_id, r.received_by, u.full_name AS received_by_name, r.notes, r.received_at,
            COALESCE(sum(ri.quantity), 0)::int AS total_quantity,
            COALESCE(sum(ri.quantity * ri.purchase_price), 0)::numeric(14,2) AS total_cost,
            count(ri.id)::int AS line_count
       FROM purchase_receivings r
       JOIN users u ON u.id = r.received_by
       LEFT JOIN purchase_receiving_items ri ON ri.receiving_id = r.id
      WHERE r.purchase_id = $1
      GROUP BY r.id, u.full_name
      ORDER BY r.received_at`,
    [purchaseId],
  );
  return rows;
}

async function findReceiving(id) {
  const { rows } = await query(
    `SELECT r.id, r.purchase_id, p.purchase_number, r.branch_id, br.name AS branch_name, r.received_by,
            u.full_name AS received_by_name, r.notes, r.received_at
       FROM purchase_receivings r
       JOIN purchases p ON p.id = r.purchase_id
       JOIN branches br ON br.id = r.branch_id
       JOIN users u ON u.id = r.received_by
      WHERE r.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const items = await query(
    `SELECT ri.id, ri.purchase_item_id, pi.medicine_id, m.name AS medicine_name, ri.batch_id, b.batch_number,
            b.manufacturing_date, b.expiry_date, ri.quantity, ri.purchase_price, ri.selling_price, ri.notes
       FROM purchase_receiving_items ri
       JOIN purchase_items pi ON pi.id = ri.purchase_item_id
       JOIN medicines m ON m.id = pi.medicine_id
       JOIN batches b ON b.id = ri.batch_id
      WHERE ri.receiving_id = $1
      ORDER BY ri.created_at, ri.id`,
    [id],
  );
  return { ...rows[0], items: items.rows };
}

async function listPayments(purchaseId) {
  const { rows } = await query(
    `SELECT sp.id, sp.amount, sp.payment_method, sp.reference_number, sp.notes, sp.paid_at,
            sp.recorded_by, u.full_name AS recorded_by_name, sp.created_at
       FROM supplier_payments sp JOIN users u ON u.id = sp.recorded_by
      WHERE sp.purchase_id = $1
      ORDER BY sp.paid_at`,
    [purchaseId],
  );
  return rows;
}

module.exports = {
  list,
  findById,
  listItems,
  insertPurchase,
  insertItems,
  deleteItems,
  updatePurchase,
  setStatus,
  cancel,
  findMedicines,
  findSupplier,
  insertReceiving,
  insertReceivingItem,
  incrementReceived,
  listReceivings,
  findReceiving,
  listPayments,
};
