const { query } = require('../../database/db');

/**
 * Shared SQL for derived inventory status.
 *
 * Stock-level status (OUT_OF_STOCK / LOW_STOCK) is evaluated per medicine per
 * branch: sellable quantity is the sum of non-expired stock across the
 * medicine's batches in that branch; the threshold is the highest minimum
 * stock among those rows. Expiry status is evaluated per batch row.
 *
 * Row status precedence:
 *   EXPIRED (row has expired stock) > OUT_OF_STOCK > LOW_STOCK > EXPIRING_SOON > AVAILABLE
 *
 * The caller supplies parameter placeholders for the business date and the
 * expiry warning window (days).
 */
function medicineStockCte(todayParam) {
  return `
    medicine_stock AS (
      SELECT bi.branch_id, b.medicine_id,
             COALESCE(sum(bi.quantity) FILTER (WHERE b.expiry_date >= ${todayParam}::date), 0)::int AS sellable_quantity,
             COALESCE(sum(bi.quantity), 0)::int AS total_quantity,
             max(bi.minimum_stock)::int AS minimum_stock
        FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
       GROUP BY bi.branch_id, b.medicine_id
    )`;
}

function rowStatusSql(todayParam, warningDaysParam) {
  return `
    CASE
      WHEN bi.quantity > 0 AND b.expiry_date < ${todayParam}::date THEN 'EXPIRED'
      WHEN ms.sellable_quantity = 0 THEN 'OUT_OF_STOCK'
      WHEN ms.sellable_quantity <= ms.minimum_stock THEN 'LOW_STOCK'
      WHEN bi.quantity > 0 AND b.expiry_date <= ${todayParam}::date + ${warningDaysParam}::int THEN 'EXPIRING_SOON'
      ELSE 'AVAILABLE'
    END`;
}

function medicineStatusSql(msAlias = 'ms') {
  return `
    CASE
      WHEN ${msAlias}.sellable_quantity = 0 THEN 'OUT_OF_STOCK'
      WHEN ${msAlias}.sellable_quantity <= ${msAlias}.minimum_stock THEN 'LOW_STOCK'
      ELSE 'AVAILABLE'
    END`;
}

async function getExpiryWarningDays(client) {
  const { rows } = await query('SELECT expiry_warning_days FROM system_settings WHERE id = 1', [], client);
  return rows[0] ? rows[0].expiry_warning_days : 30;
}

module.exports = { medicineStockCte, rowStatusSql, medicineStatusSql, getExpiryWarningDays };
