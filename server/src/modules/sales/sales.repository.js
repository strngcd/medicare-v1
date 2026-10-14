const { query } = require('../../database/db');
const { logoUrlSql } = require('../files/files');
const { whereBuilder } = require('../../utils/pagination');

const SALE_COLUMNS = `
  s.id, s.receipt_number, s.branch_id, br.name AS branch_name, br.code AS branch_code,
  s.sold_by, u.full_name AS sold_by_name, s.status, s.discount_type, s.discount_value,
  s.tax_name, s.tax_rate, s.tax_mode, s.subtotal, s.discount, s.tax, s.total,
  s.created_at, s.completed_at, s.voided_at, s.voided_by, vu.full_name AS voided_by_name, s.void_reason,
  (SELECT sp.payment_method FROM sale_payments sp WHERE sp.sale_id = s.id LIMIT 1) AS payment_method,
  COALESCE((SELECT sum(r.refund_total) FROM refunds r WHERE r.sale_id = s.id), 0)::numeric(14,2) AS refunded_total`;

const SALE_FROM = `
  sales s
  JOIN branches br ON br.id = s.branch_id
  JOIN users u ON u.id = s.sold_by
  LEFT JOIN users vu ON vu.id = s.voided_by`;

async function list(filters) {
  const w = whereBuilder();
  if (filters.branchIds) w.add('s.branch_id = ANY(?::uuid[])', filters.branchIds);
  if (filters.soldBy) w.add('s.sold_by = ?', filters.soldBy);
  if (filters.status) w.add('s.status = ?', filters.status);
  if (filters.receiptNumber) w.add('s.receipt_number ILIKE ?', `%${filters.receiptNumber}%`);
  if (filters.minAmount) w.add('s.total >= ?::numeric', filters.minAmount);
  if (filters.maxAmount) w.add('s.total <= ?::numeric', filters.maxAmount);
  if (filters.dateFrom) w.add('(s.completed_at AT TIME ZONE ?)::date >= ?::date', filters.timezone, filters.dateFrom);
  if (filters.dateTo) w.add('(s.completed_at AT TIME ZONE ?)::date <= ?::date', filters.timezone, filters.dateTo);
  if (filters.paymentMethod) {
    w.add('EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.payment_method = ?)', filters.paymentMethod);
  }
  if (filters.medicineId) {
    w.add('EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.medicine_id = ?)', filters.medicineId);
  }
  if (filters.categoryId) {
    w.add(
      `EXISTS (SELECT 1 FROM sale_items si JOIN medicines m ON m.id = si.medicine_id
                WHERE si.sale_id = s.id AND m.category_id = ?)`,
      filters.categoryId,
    );
  }

  const { rows } = await query(
    `SELECT ${SALE_COLUMNS},
            (SELECT COALESCE(sum(si.quantity), 0) FROM sale_items si WHERE si.sale_id = s.id)::int AS item_count,
            count(*) OVER() AS total_count
       FROM ${SALE_FROM}
       ${w.sql}
      ORDER BY ${filters.orderBy}
      LIMIT ${w.param(filters.limit)} OFFSET ${w.param(filters.offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

/**
 * Loads a sale. With forUpdate the sale row is locked first and re-read so
 * derived values (e.g. refunded total) include work committed meanwhile.
 */
async function findById(id, client, { forUpdate = false } = {}) {
  if (forUpdate) await query('SELECT id FROM sales WHERE id = $1 FOR UPDATE', [id], client);
  const { rows } = await query(`SELECT ${SALE_COLUMNS} FROM ${SALE_FROM} WHERE s.id = $1`, [id], client);
  return rows[0] || null;
}

async function listItems(saleId, client) {
  const { rows } = await query(
    `SELECT si.id, si.medicine_id, si.medicine_name, m.strength, m.dosage_form, m.package_size,
            m.prescription_required, si.quantity, si.unit_selling_price, si.discount, si.tax, si.line_total,
            COALESCE((SELECT sum(ri.quantity) FROM refund_items ri WHERE ri.sale_item_id = si.id), 0)::int AS refunded_quantity,
            COALESCE((SELECT sum(ri.refund_amount) FROM refund_items ri WHERE ri.sale_item_id = si.id), 0)::numeric(14,2) AS refunded_amount,
            COALESCE((SELECT json_agg(json_build_object(
                'batchId', a.batch_id, 'batchNumber', b.batch_number, 'expiryDate', b.expiry_date,
                'quantity', a.quantity, 'purchasePriceAtSale', a.purchase_price_at_sale::text,
                'refundedQuantity', COALESCE((SELECT sum(ra.quantity) FROM refund_item_batch_allocations ra
                                               JOIN refund_items ri2 ON ri2.id = ra.refund_item_id
                                              WHERE ri2.sale_item_id = si.id AND ra.batch_id = a.batch_id), 0))
                ORDER BY a.created_at, b.expiry_date)
               FROM sale_item_batch_allocations a JOIN batches b ON b.id = a.batch_id
              WHERE a.sale_item_id = si.id), '[]') AS allocations
       FROM sale_items si JOIN medicines m ON m.id = si.medicine_id
      WHERE si.sale_id = $1
      ORDER BY si.created_at, si.medicine_name, si.unit_selling_price`,
    [saleId],
    client,
  );
  return rows;
}

async function costOfSale(saleId) {
  const { rows } = await query(
    `SELECT COALESCE(sum(a.quantity * a.purchase_price_at_sale), 0)::numeric(14,2) AS cogs
       FROM sale_item_batch_allocations a JOIN sale_items si ON si.id = a.sale_item_id
      WHERE si.sale_id = $1`,
    [saleId],
  );
  return rows[0].cogs;
}

async function listRefunds(saleId) {
  const { rows } = await query(
    `SELECT r.id, r.refund_number, r.refund_total, r.payment_method, r.reason, r.notes,
            r.processed_by, u.full_name AS processed_by_name, r.created_at
       FROM refunds r JOIN users u ON u.id = r.processed_by
      WHERE r.sale_id = $1 ORDER BY r.created_at`,
    [saleId],
  );
  return rows;
}

async function findMedicines(client, ids) {
  const { rows } = await query(
    `SELECT id, name, strength, status, prescription_required FROM medicines WHERE id = ANY($1::uuid[])`,
    [ids],
    client,
  );
  return rows;
}

async function getTaxSettings(client) {
  const { rows } = await query(
    'SELECT tax_enabled, tax_name, tax_rate, tax_mode FROM system_settings WHERE id = 1',
    [],
    client,
  );
  return rows[0] || { tax_enabled: false, tax_name: 'Tax', tax_rate: '0', tax_mode: 'ADDED_ON_TOP' };
}

async function insertSale(client, data) {
  const { rows } = await query(
    `INSERT INTO sales (receipt_number, branch_id, sold_by, status, discount_type, discount_value,
       tax_name, tax_rate, tax_mode, subtotal, discount, tax, total)
     VALUES ($1, $2, $3, 'COMPLETED', $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, completed_at`,
    [
      data.receiptNumber, data.branchId, data.userId, data.discountType, data.discountValue,
      data.taxName, data.taxRate, data.taxMode, data.subtotal, data.discount, data.tax, data.total,
    ],
    client,
  );
  return rows[0];
}

async function insertSaleItem(client, saleId, item) {
  const { rows } = await query(
    `INSERT INTO sale_items (sale_id, medicine_id, medicine_name, quantity, unit_selling_price, discount, tax, line_total)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [saleId, item.medicineId, item.medicineName, item.quantity, item.unitPrice, item.discount, item.tax, item.lineTotal],
    client,
  );
  return rows[0].id;
}

async function insertAllocation(client, saleItemId, allocation) {
  await query(
    `INSERT INTO sale_item_batch_allocations (sale_item_id, batch_id, quantity, purchase_price_at_sale)
     VALUES ($1, $2, $3, $4)`,
    [saleItemId, allocation.batchId, allocation.quantity, allocation.purchasePrice],
    client,
  );
}

async function insertPayment(client, saleId, method, amount) {
  await query('INSERT INTO sale_payments (sale_id, payment_method, amount) VALUES ($1, $2, $3)', [saleId, method, amount], client);
}

async function insertFefoOverride(client, data) {
  await query(
    `INSERT INTO fefo_overrides (sale_id, sale_item_id, branch_id, medicine_id, user_id,
       recommended_allocation, actual_allocation, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.saleId, data.saleItemId, data.branchId, data.medicineId, data.userId,
      JSON.stringify(data.recommended), JSON.stringify(data.actual), data.reason,
    ],
    client,
  );
}

async function markVoided(client, saleId, userId, reason) {
  await query(
    `UPDATE sales SET status = 'VOIDED', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`,
    [saleId, userId, reason],
    client,
  );
}

async function listAllocationsForSale(client, saleId) {
  const { rows } = await query(
    `SELECT a.batch_id, a.quantity, si.id AS sale_item_id
       FROM sale_item_batch_allocations a JOIN sale_items si ON si.id = a.sale_item_id
      WHERE si.sale_id = $1
      ORDER BY a.batch_id`,
    [saleId],
    client,
  );
  return rows;
}

async function countRefunds(client, saleId) {
  const { rows } = await query('SELECT count(*) AS n FROM refunds WHERE sale_id = $1', [saleId], client);
  return rows[0].n;
}

async function receiptContext(branchId) {
  const { rows } = await query(
    `SELECT ss.pharmacy_name, ${logoUrlSql('ss')} AS logo_url, ss.phone AS pharmacy_phone, ss.email AS pharmacy_email,
            ss.address AS pharmacy_address, ss.city AS pharmacy_city, ss.country AS pharmacy_country,
            ss.website, ss.currency_code,
            br.name AS branch_name, br.code AS branch_code, br.address AS branch_address,
            br.city AS branch_city, br.phone AS branch_phone,
            COALESCE(bs.receipt_show_tax, true) AS show_tax,
            COALESCE(bs.receipt_show_discount, true) AS show_discount,
            COALESCE(bs.receipt_show_branch_address, true) AS show_branch_address,
            COALESCE(bs.receipt_show_branch_phone, true) AS show_branch_phone,
            COALESCE(bs.receipt_show_staff, true) AS show_staff,
            bs.receipt_footer
       FROM system_settings ss
       CROSS JOIN branches br
       LEFT JOIN branch_settings bs ON bs.branch_id = br.id
      WHERE ss.id = 1 AND br.id = $1`,
    [branchId],
  );
  return rows[0];
}

module.exports = {
  list,
  findById,
  listItems,
  costOfSale,
  listRefunds,
  findMedicines,
  getTaxSettings,
  insertSale,
  insertSaleItem,
  insertAllocation,
  insertPayment,
  insertFefoOverride,
  markVoided,
  listAllocationsForSale,
  countRefunds,
  receiptContext,
};
