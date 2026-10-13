const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');

const COLUMNS = `
  r.id, r.refund_number, r.sale_id, s.receipt_number, r.branch_id, br.name AS branch_name,
  r.refund_total, r.payment_method, r.reason, r.notes, r.processed_by,
  u.full_name AS processed_by_name, r.created_at, s.sold_by`;

const FROM = `
  refunds r
  JOIN sales s ON s.id = r.sale_id
  JOIN branches br ON br.id = r.branch_id
  JOIN users u ON u.id = r.processed_by`;

function buildWhere({ branchIds, saleId, processedBy, reason, dateFrom, dateTo, timezone, search, minAmount, maxAmount }) {
  const w = whereBuilder();
  if (branchIds) w.add('r.branch_id = ANY(?::uuid[])', branchIds);
  if (saleId) w.add('r.sale_id = ?', saleId);
  if (processedBy) w.add('r.processed_by = ?', processedBy);
  if (reason) w.add('r.reason = ?', reason);
  if (search) w.add('(r.refund_number ILIKE ? OR s.receipt_number ILIKE ?)', `%${search}%`, `%${search}%`);
  if (dateFrom) w.add('(r.created_at AT TIME ZONE ?)::date >= ?::date', timezone, dateFrom);
  if (dateTo) w.add('(r.created_at AT TIME ZONE ?)::date <= ?::date', timezone, dateTo);
  if (minAmount) w.add('r.refund_total >= ?::numeric', minAmount);
  if (maxAmount) w.add('r.refund_total <= ?::numeric', maxAmount);
  return w;
}

async function list({ limit, offset, orderBy, ...filters }) {
  const w = buildWhere(filters);
  const { rows } = await query(
    `SELECT ${COLUMNS}, count(*) OVER() AS total_count FROM ${FROM} ${w.sql}
      ORDER BY ${orderBy} LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function summary(filters) {
  const w = buildWhere(filters);
  const { rows } = await query(
    `SELECT count(*)::int AS refund_count, COALESCE(sum(r.refund_total), 0)::numeric(14,2) AS total_refunded,
            COALESCE(sum(r.refund_total) FILTER (WHERE r.payment_method = 'CASH'), 0)::numeric(14,2) AS cash_refunded,
            COALESCE(sum(r.refund_total) FILTER (WHERE r.payment_method = 'BANK_TRANSFER'), 0)::numeric(14,2) AS bank_transfer_refunded
       FROM ${FROM} ${w.sql}`,
    w.params,
  );
  return rows[0];
}

async function findById(id) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM ${FROM} WHERE r.id = $1`, [id]);
  if (!rows[0]) return null;
  const items = await query(
    `SELECT ri.id, ri.sale_item_id, si.medicine_id, si.medicine_name, ri.quantity, ri.refund_unit_price, ri.refund_amount,
            COALESCE((SELECT json_agg(json_build_object('batchId', ra.batch_id, 'batchNumber', b.batch_number, 'quantity', ra.quantity))
                        FROM refund_item_batch_allocations ra JOIN batches b ON b.id = ra.batch_id
                       WHERE ra.refund_item_id = ri.id), '[]') AS allocations
       FROM refund_items ri JOIN sale_items si ON si.id = ri.sale_item_id
      WHERE ri.refund_id = $1
      ORDER BY si.medicine_name`,
    [id],
  );
  return { ...rows[0], items: items.rows };
}

/** Sale items with what remains refundable, per item and per batch. Call after locking the sale. */
async function loadRefundableItems(client, saleId) {
  const { rows } = await query(
    `SELECT si.id, si.medicine_id, si.medicine_name, si.quantity, si.line_total,
            COALESCE((SELECT sum(ri.quantity) FROM refund_items ri WHERE ri.sale_item_id = si.id), 0)::int AS refunded_quantity,
            (SELECT json_agg(json_build_object(
                      'batchId', a.batch_id,
                      'quantity', a.quantity,
                      'refunded', COALESCE((SELECT sum(ra.quantity) FROM refund_item_batch_allocations ra
                                             JOIN refund_items ri2 ON ri2.id = ra.refund_item_id
                                            WHERE ri2.sale_item_id = si.id AND ra.batch_id = a.batch_id), 0))
                    ORDER BY b.expiry_date, a.batch_id)
               FROM sale_item_batch_allocations a JOIN batches b ON b.id = a.batch_id
              WHERE a.sale_item_id = si.id) AS allocations
       FROM sale_items si
      WHERE si.sale_id = $1`,
    [saleId],
    client,
  );
  return rows;
}

async function insertRefund(client, data) {
  const { rows } = await query(
    `INSERT INTO refunds (refund_number, sale_id, branch_id, refund_total, payment_method, reason, notes, processed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, created_at`,
    [data.refundNumber, data.saleId, data.branchId, data.refundTotal, data.paymentMethod, data.reason, data.notes ?? null, data.userId],
    client,
  );
  return rows[0];
}

async function insertRefundItem(client, refundId, item) {
  const { rows } = await query(
    `INSERT INTO refund_items (refund_id, sale_item_id, quantity, refund_unit_price, refund_amount)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [refundId, item.saleItemId, item.quantity, item.refundUnitPrice, item.refundAmount],
    client,
  );
  return rows[0].id;
}

async function insertRefundAllocation(client, refundItemId, batchId, quantity) {
  await query(
    'INSERT INTO refund_item_batch_allocations (refund_item_id, batch_id, quantity) VALUES ($1, $2, $3)',
    [refundItemId, batchId, quantity],
    client,
  );
}

module.exports = { list, summary, findById, loadRefundableItems, insertRefund, insertRefundItem, insertRefundAllocation };
