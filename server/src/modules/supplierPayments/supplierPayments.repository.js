const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');

const COLUMNS = `
  sp.id, sp.purchase_id, p.purchase_number, sp.supplier_id, s.company_name AS supplier_name,
  sp.branch_id, br.name AS branch_name, sp.amount, sp.payment_method, sp.reference_number,
  sp.notes, sp.paid_at, sp.recorded_by, u.full_name AS recorded_by_name, sp.created_at`;

const FROM = `
  supplier_payments sp
  JOIN purchases p ON p.id = sp.purchase_id
  JOIN suppliers s ON s.id = sp.supplier_id
  JOIN branches br ON br.id = sp.branch_id
  JOIN users u ON u.id = sp.recorded_by`;

async function list({ branchIds, supplierId, purchaseId, paymentMethod, dateFrom, dateTo, timezone, limit, offset, orderBy }) {
  const w = whereBuilder();
  if (branchIds) w.add('sp.branch_id = ANY(?::uuid[])', branchIds);
  if (supplierId) w.add('sp.supplier_id = ?', supplierId);
  if (purchaseId) w.add('sp.purchase_id = ?', purchaseId);
  if (paymentMethod) w.add('sp.payment_method = ?', paymentMethod);
  if (dateFrom) w.add('sp.paid_at >= (?::date AT TIME ZONE ?)', dateFrom, timezone);
  if (dateTo) w.add('sp.paid_at < ((?::date + 1) AT TIME ZONE ?)', dateTo, timezone);
  const { rows } = await query(
    `SELECT ${COLUMNS}, count(*) OVER() AS total_count FROM ${FROM} ${w.sql}
      ORDER BY ${orderBy} LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function findById(id) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM ${FROM} WHERE sp.id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Locks the purchase row so concurrent payments are serialized, then reads
 * the amount already paid in a separate statement so it includes payments
 * committed while this transaction waited for the lock.
 */
async function lockPurchaseForPayment(client, purchaseId) {
  const locked = await query('SELECT id FROM purchases WHERE id = $1 FOR UPDATE', [purchaseId], client);
  if (!locked.rows[0]) return null;
  const { rows } = await query(
    `SELECT p.id, p.purchase_number, p.supplier_id, p.branch_id, p.status, p.total,
            COALESCE((SELECT sum(amount) FROM supplier_payments WHERE purchase_id = p.id), 0)::numeric(14,2) AS amount_paid
       FROM purchases p WHERE p.id = $1`,
    [purchaseId],
    client,
  );
  return rows[0];
}

async function insert(client, data) {
  const { rows } = await query(
    `INSERT INTO supplier_payments (purchase_id, supplier_id, branch_id, amount, payment_method, reference_number, notes, paid_at, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()), $9) RETURNING id`,
    [
      data.purchaseId, data.supplierId, data.branchId, data.amount, data.paymentMethod,
      data.referenceNumber ?? null, data.notes ?? null, data.paidAt ?? null, data.userId,
    ],
    client,
  );
  return rows[0].id;
}

/** Derived accounts-payable position of a supplier within a branch scope. */
async function supplierBalance(supplierId, branchIds) {
  const { rows } = await query(
    `WITH open_purchases AS (
       SELECT p.id, p.branch_id, p.total,
              COALESCE((SELECT sum(amount) FROM supplier_payments WHERE purchase_id = p.id), 0) AS paid
         FROM purchases p
        WHERE p.supplier_id = $1 AND p.status NOT IN ('DRAFT', 'CANCELLED')
          AND ($2::uuid[] IS NULL OR p.branch_id = ANY($2::uuid[]))
     )
     SELECT COALESCE(sum(total), 0)::numeric(14,2) AS total_purchased,
            COALESCE(sum(paid), 0)::numeric(14,2) AS total_paid,
            COALESCE(sum(total - paid), 0)::numeric(14,2) AS balance,
            count(*) FILTER (WHERE paid = 0)::int AS unpaid_count,
            count(*) FILTER (WHERE paid > 0 AND paid < total)::int AS partially_paid_count,
            count(*) FILTER (WHERE paid >= total)::int AS paid_count
       FROM open_purchases`,
    [supplierId, branchIds],
  );
  const byBranch = await query(
    `SELECT p.branch_id, br.name AS branch_name,
            sum(p.total)::numeric(14,2) AS total_purchased,
            sum(COALESCE((SELECT sum(amount) FROM supplier_payments WHERE purchase_id = p.id), 0))::numeric(14,2) AS total_paid
       FROM purchases p JOIN branches br ON br.id = p.branch_id
      WHERE p.supplier_id = $1 AND p.status NOT IN ('DRAFT', 'CANCELLED')
        AND ($2::uuid[] IS NULL OR p.branch_id = ANY($2::uuid[]))
      GROUP BY p.branch_id, br.name
      ORDER BY br.name`,
    [supplierId, branchIds],
  );
  return { ...rows[0], branches: byBranch.rows };
}

module.exports = { list, findById, lockPurchaseForPayment, insert, supplierBalance };
