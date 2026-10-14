const { query } = require('../../database/db');
const { medicineStockCte } = require('../inventory/inventoryStatus');

/**
 * Operational alerts are derived from current inventory every time they are
 * read; nothing is stored, so they disappear as soon as the condition does.
 *
 * $1 business date, $2 expiry warning days, $3 branch scope (uuid[] or null)
 */
const ALERTS_SQL = `
  WITH ${medicineStockCte('$1', '$3')},
  alerts AS (
    SELECT 'EXPIRED:' || bi.id AS id, 'EXPIRED' AS type, 'CRITICAL' AS severity, 1 AS severity_rank,
           bi.branch_id, b.medicine_id, b.id AS batch_id, b.batch_number, b.expiry_date,
           bi.quantity, NULL::int AS minimum_stock, bi.id AS inventory_id
      FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
     WHERE bi.quantity > 0 AND b.expiry_date < $1::date
    UNION ALL
    SELECT 'EXPIRING_SOON:' || bi.id, 'EXPIRING_SOON', 'WARNING', 3,
           bi.branch_id, b.medicine_id, b.id, b.batch_number, b.expiry_date, bi.quantity, NULL, bi.id
      FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
      JOIN medicines m ON m.id = b.medicine_id
     WHERE bi.quantity > 0 AND m.status <> 'ARCHIVED'
       AND b.expiry_date >= $1::date AND b.expiry_date <= $1::date + $2::int
    UNION ALL
    SELECT 'OUT_OF_STOCK:' || ms.branch_id || ':' || ms.medicine_id, 'OUT_OF_STOCK', 'HIGH', 2,
           ms.branch_id, ms.medicine_id, NULL, NULL, NULL, ms.sellable_quantity, ms.minimum_stock, NULL
      FROM medicine_stock ms JOIN medicines m ON m.id = ms.medicine_id
     WHERE m.status = 'ACTIVE' AND ms.sellable_quantity = 0
    UNION ALL
    SELECT 'LOW_STOCK:' || ms.branch_id || ':' || ms.medicine_id, 'LOW_STOCK', 'WARNING', 3,
           ms.branch_id, ms.medicine_id, NULL, NULL, NULL, ms.sellable_quantity, ms.minimum_stock, NULL
      FROM medicine_stock ms JOIN medicines m ON m.id = ms.medicine_id
     WHERE m.status = 'ACTIVE' AND ms.sellable_quantity > 0 AND ms.sellable_quantity <= ms.minimum_stock
  )
  SELECT a.*, br.name AS branch_name, m.name AS medicine_name
    FROM alerts a
    JOIN branches br ON br.id = a.branch_id
    JOIN medicines m ON m.id = a.medicine_id
   WHERE ($3::uuid[] IS NULL OR a.branch_id = ANY($3::uuid[]))`;

async function list({ today, warningDays, branchIds, type, severity, limit, offset }) {
  const params = [today, warningDays, branchIds];
  const filters = [];
  if (type) {
    params.push(type);
    filters.push(`type = $${params.length}`);
  }
  if (severity) {
    params.push(severity);
    filters.push(`severity = $${params.length}`);
  }
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT *, count(*) OVER() AS total_count FROM (${ALERTS_SQL}) x
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY severity_rank, expiry_date NULLS LAST, quantity, medicine_name
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function counts({ today, warningDays, branchIds }) {
  const { rows } = await query(
    `SELECT type, severity, count(*)::int AS count FROM (${ALERTS_SQL}) x GROUP BY type, severity`,
    [today, warningDays, branchIds],
  );
  return rows;
}

async function findById(id, { today, warningDays, branchIds }) {
  const { rows } = await query(`SELECT * FROM (${ALERTS_SQL}) x WHERE id = $4`, [today, warningDays, branchIds, id]);
  return rows[0] || null;
}

module.exports = { list, counts, findById };
