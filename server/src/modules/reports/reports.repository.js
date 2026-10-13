/**
 * Aggregation queries for reports and dashboards. All aggregation happens in
 * PostgreSQL; only summarized rows are returned.
 *
 * Definitions used everywhere:
 *  - sales: COMPLETED sales whose completion date (business calendar) is in range
 *  - refunds: refunds whose creation date is in range (for sales matching the filters)
 *  - revenue: sale line totals excluding tax; refunds reverse their pre-tax share
 *  - COGS: allocation quantity x purchase_price_at_sale; refunds reverse the
 *    cost of the exact batches returned
 */
const { query } = require('../../database/db');

/**
 * Builds the shared sales filter. `s` is the sales alias.
 * Returns { params, salesWhere } where salesWhere applies to sales rows and
 * can be reused for refunds (joined to their sale).
 */
function buildSalesFilter(f) {
  const params = [f.timezone, f.dateFrom, f.dateTo, f.branchIds || null];
  const conditions = ['($4::uuid[] IS NULL OR s.branch_id = ANY($4::uuid[]))'];
  const add = (sql, value) => {
    params.push(value);
    conditions.push(sql.replace('?', `$${params.length}`));
  };
  if (f.staffId) add('s.sold_by = ?', f.staffId);
  if (f.receiptNumber) add('s.receipt_number ILIKE ?', `%${f.receiptNumber}%`);
  if (f.minAmount) add('s.total >= ?::numeric', f.minAmount);
  if (f.maxAmount) add('s.total <= ?::numeric', f.maxAmount);
  if (f.paymentMethod) add('EXISTS (SELECT 1 FROM sale_payments p WHERE p.sale_id = s.id AND p.payment_method = ?)', f.paymentMethod);
  if (f.medicineId) add('EXISTS (SELECT 1 FROM sale_items fi WHERE fi.sale_id = s.id AND fi.medicine_id = ?)', f.medicineId);
  if (f.categoryId) {
    add(
      `EXISTS (SELECT 1 FROM sale_items fi JOIN medicines fm ON fm.id = fi.medicine_id
                WHERE fi.sale_id = s.id AND fm.category_id = ?)`,
      f.categoryId,
    );
  }
  return { params, salesWhere: conditions.join(' AND ') };
}

function scopeCtes(salesWhere) {
  return `
    cs AS (
      SELECT s.* FROM sales s
       WHERE s.status = 'COMPLETED'
         AND (s.completed_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
         AND ${salesWhere}
    ),
    rr AS (
      SELECT r.* FROM refunds r JOIN sales s ON s.id = r.sale_id
       WHERE (r.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
         AND ${salesWhere}
    )`;
}

const REFUND_REVENUE_SHARE = `CASE WHEN si.line_total > 0 THEN (si.line_total - si.tax) / si.line_total ELSE 0 END`;

async function salesSummary(filters) {
  const { params, salesWhere } = buildSalesFilter(filters);
  const { rows } = await query(
    `WITH ${scopeCtes(salesWhere)}
     SELECT
       (SELECT count(*) FROM cs)::int AS transaction_count,
       (SELECT COALESCE(sum(total), 0) FROM cs)::numeric(14,2) AS gross_sales,
       (SELECT COALESCE(sum(subtotal), 0) FROM cs)::numeric(14,2) AS subtotal,
       (SELECT COALESCE(sum(discount), 0) FROM cs)::numeric(14,2) AS discounts,
       (SELECT COALESCE(sum(tax), 0) FROM cs)::numeric(14,2) AS tax,
       (SELECT COALESCE(sum(si.quantity), 0) FROM sale_items si JOIN cs ON cs.id = si.sale_id)::int AS items_sold,
       (SELECT COALESCE(sum(cs.total), 0) FROM cs JOIN sale_payments p ON p.sale_id = cs.id
         WHERE p.payment_method = 'CASH')::numeric(14,2) AS cash_sales,
       (SELECT COALESCE(sum(cs.total), 0) FROM cs JOIN sale_payments p ON p.sale_id = cs.id
         WHERE p.payment_method = 'BANK_TRANSFER')::numeric(14,2) AS bank_transfer_sales,
       (SELECT COALESCE(sum(si.line_total - si.tax), 0) FROM sale_items si JOIN cs ON cs.id = si.sale_id)::numeric(14,2) AS sales_revenue,
       (SELECT COALESCE(sum(a.quantity * a.purchase_price_at_sale), 0)
          FROM sale_item_batch_allocations a JOIN sale_items si ON si.id = a.sale_item_id
          JOIN cs ON cs.id = si.sale_id)::numeric(14,2) AS sales_cogs,
       (SELECT count(*) FROM rr)::int AS refund_count,
       (SELECT COALESCE(sum(refund_total), 0) FROM rr)::numeric(14,2) AS refunds,
       (SELECT COALESCE(sum(ri.quantity), 0) FROM refund_items ri JOIN rr ON rr.id = ri.refund_id)::int AS items_refunded,
       (SELECT COALESCE(sum(ri.refund_amount * ${REFUND_REVENUE_SHARE}), 0)
          FROM refund_items ri JOIN rr ON rr.id = ri.refund_id
          JOIN sale_items si ON si.id = ri.sale_item_id)::numeric(14,2) AS refunded_revenue,
       (SELECT COALESCE(sum(ra.quantity * sa.purchase_price_at_sale), 0)
          FROM refund_item_batch_allocations ra
          JOIN refund_items ri ON ri.id = ra.refund_item_id
          JOIN rr ON rr.id = ri.refund_id
          JOIN sale_item_batch_allocations sa ON sa.sale_item_id = ri.sale_item_id AND sa.batch_id = ra.batch_id)::numeric(14,2) AS refunded_cogs,
       (SELECT count(*) FROM sales s
         WHERE s.status = 'VOIDED' AND (s.completed_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
           AND ${salesWhere})::int AS voided_count,
       (SELECT COALESCE(sum(total), 0) FROM sales s
         WHERE s.status = 'VOIDED' AND (s.completed_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
           AND ${salesWhere})::numeric(14,2) AS voided_total`,
    params,
  );
  return rows[0];
}

const BUCKETS = {
  hour: { trunc: 'hour', step: '1 hour' },
  day: { trunc: 'day', step: '1 day' },
  month: { trunc: 'month', step: '1 month' },
};

/** Zero-filled time series of sales and refunds at the given granularity. */
async function salesSeries(filters, granularity) {
  const bucket = BUCKETS[granularity];
  const { params, salesWhere } = buildSalesFilter(filters);
  const { rows } = await query(
    `WITH ${scopeCtes(salesWhere)},
     periods AS (
       SELECT generate_series(
                date_trunc('${bucket.trunc}', $2::date::timestamp),
                date_trunc('${bucket.trunc}', ($3::date + 1)::timestamp - interval '1 second'),
                interval '${bucket.step}') AS period
     ),
     s_agg AS (
       SELECT date_trunc('${bucket.trunc}', cs.completed_at AT TIME ZONE $1) AS period,
              sum(cs.total) AS sales, count(*) AS transactions
         FROM cs GROUP BY 1
     ),
     i_agg AS (
       SELECT date_trunc('${bucket.trunc}', cs.completed_at AT TIME ZONE $1) AS period, sum(si.quantity) AS items
         FROM cs JOIN sale_items si ON si.sale_id = cs.id GROUP BY 1
     ),
     r_agg AS (
       SELECT date_trunc('${bucket.trunc}', rr.created_at AT TIME ZONE $1) AS period, sum(rr.refund_total) AS refunds
         FROM rr GROUP BY 1
     )
     SELECT to_char(p.period, ${granularity === 'hour' ? "'YYYY-MM-DD\"T\"HH24:00'" : granularity === 'day' ? "'YYYY-MM-DD'" : "'YYYY-MM'"}) AS period,
            COALESCE(s.sales, 0)::numeric(14,2) AS sales,
            COALESCE(s.transactions, 0)::int AS transactions,
            COALESCE(i.items, 0)::int AS items_sold,
            COALESCE(r.refunds, 0)::numeric(14,2) AS refunds,
            (COALESCE(s.sales, 0) - COALESCE(r.refunds, 0))::numeric(14,2) AS net_sales
       FROM periods p
       LEFT JOIN s_agg s ON s.period = p.period
       LEFT JOIN i_agg i ON i.period = p.period
       LEFT JOIN r_agg r ON r.period = p.period
      ORDER BY p.period`,
    params,
  );
  return rows;
}

/** Per-medicine quantities, revenue and cost, net of refunds (SQL text, no ORDER/LIMIT). */
function medicinePerformanceSql(salesWhere) {
  return `
    WITH ${scopeCtes(salesWhere)},
    sold AS (
      SELECT si.medicine_id, sum(si.quantity) AS quantity, sum(si.line_total - si.tax) AS revenue,
             sum((SELECT sum(a.quantity * a.purchase_price_at_sale) FROM sale_item_batch_allocations a
                   WHERE a.sale_item_id = si.id)) AS cogs
        FROM sale_items si JOIN cs ON cs.id = si.sale_id GROUP BY si.medicine_id
    ),
    returned AS (
      SELECT si.medicine_id, sum(ri.quantity) AS quantity,
             sum(ri.refund_amount * ${REFUND_REVENUE_SHARE}) AS revenue,
             sum((SELECT sum(ra.quantity * sa.purchase_price_at_sale)
                    FROM refund_item_batch_allocations ra
                    JOIN sale_item_batch_allocations sa ON sa.sale_item_id = ri.sale_item_id AND sa.batch_id = ra.batch_id
                   WHERE ra.refund_item_id = ri.id)) AS cogs
        FROM refund_items ri JOIN rr ON rr.id = ri.refund_id JOIN sale_items si ON si.id = ri.sale_item_id
       GROUP BY si.medicine_id
    ),
    perf AS (
      SELECT m.id AS medicine_id, m.name AS medicine_name, COALESCE(c.name, 'Uncategorized') AS category_name,
             COALESCE(sold.quantity, 0)::int AS quantity_sold,
             COALESCE(returned.quantity, 0)::int AS quantity_refunded,
             (COALESCE(sold.quantity, 0) - COALESCE(returned.quantity, 0))::int AS net_quantity,
             round(COALESCE(sold.revenue, 0) - COALESCE(returned.revenue, 0), 2) AS net_revenue,
             round(COALESCE(sold.cogs, 0) - COALESCE(returned.cogs, 0), 2) AS cogs
        FROM medicines m
        LEFT JOIN medicine_categories c ON c.id = m.category_id
        LEFT JOIN sold ON sold.medicine_id = m.id
        LEFT JOIN returned ON returned.medicine_id = m.id
       WHERE sold.medicine_id IS NOT NULL OR returned.medicine_id IS NOT NULL
    )`;
}

async function medicinePerformance(filters, { orderBy = 'net_quantity', limit = 10 } = {}) {
  const { params, salesWhere } = buildSalesFilter(filters);
  const order = { net_quantity: 'net_quantity DESC', net_revenue: 'net_revenue DESC', gross_profit: 'gross_profit DESC' }[orderBy];
  params.push(limit);
  const { rows } = await query(
    `${medicinePerformanceSql(salesWhere)}
     SELECT medicine_id, medicine_name, category_name, quantity_sold, quantity_refunded, net_quantity,
            net_revenue::numeric(14,2), cogs::numeric(14,2), (net_revenue - cogs)::numeric(14,2) AS gross_profit
       FROM perf
      ORDER BY ${order}, medicine_name
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

async function categoryPerformance(filters) {
  const { params, salesWhere } = buildSalesFilter(filters);
  const { rows } = await query(
    `${medicinePerformanceSql(salesWhere)}
     SELECT category_name, sum(net_quantity)::int AS net_quantity,
            sum(net_revenue)::numeric(14,2) AS net_revenue, sum(cogs)::numeric(14,2) AS cogs,
            sum(net_revenue - cogs)::numeric(14,2) AS gross_profit
       FROM perf GROUP BY category_name ORDER BY net_revenue DESC, category_name`,
    params,
  );
  return rows;
}

async function branchComparison(filters) {
  const { params, salesWhere } = buildSalesFilter(filters);
  const { rows } = await query(
    `WITH ${scopeCtes(salesWhere)}
     SELECT b.id AS branch_id, b.name AS branch_name, b.code AS branch_code, b.status,
            COALESCE((SELECT count(*) FROM cs WHERE cs.branch_id = b.id), 0)::int AS transaction_count,
            COALESCE((SELECT sum(total) FROM cs WHERE cs.branch_id = b.id), 0)::numeric(14,2) AS gross_sales,
            COALESCE((SELECT sum(refund_total) FROM rr WHERE rr.branch_id = b.id), 0)::numeric(14,2) AS refunds,
            COALESCE((SELECT sum(si.line_total - si.tax) FROM sale_items si JOIN cs ON cs.id = si.sale_id
                       WHERE cs.branch_id = b.id), 0)::numeric(14,2) AS sales_revenue,
            COALESCE((SELECT sum(ri.refund_amount * ${REFUND_REVENUE_SHARE}) FROM refund_items ri
                       JOIN rr ON rr.id = ri.refund_id JOIN sale_items si ON si.id = ri.sale_item_id
                       WHERE rr.branch_id = b.id), 0)::numeric(14,2) AS refunded_revenue,
            COALESCE((SELECT sum(a.quantity * a.purchase_price_at_sale) FROM sale_item_batch_allocations a
                       JOIN sale_items si ON si.id = a.sale_item_id JOIN cs ON cs.id = si.sale_id
                       WHERE cs.branch_id = b.id), 0)::numeric(14,2) AS sales_cogs,
            COALESCE((SELECT sum(ra.quantity * sa.purchase_price_at_sale) FROM refund_item_batch_allocations ra
                       JOIN refund_items ri ON ri.id = ra.refund_item_id JOIN rr ON rr.id = ri.refund_id
                       JOIN sale_item_batch_allocations sa ON sa.sale_item_id = ri.sale_item_id AND sa.batch_id = ra.batch_id
                       WHERE rr.branch_id = b.id), 0)::numeric(14,2) AS refunded_cogs
       FROM branches b
      WHERE ($4::uuid[] IS NULL OR b.id = ANY($4::uuid[]))
      ORDER BY gross_sales DESC, b.name`,
    params,
  );
  return rows;
}

/** Stock position per medicine and branch, with value at batch cost. */
async function inventoryPositions({ today, warningDays, branchIds, categoryId, status, limit, offset }) {
  const params = [today, warningDays, branchIds];
  const filters = ["m.status <> 'ARCHIVED' OR x.total_quantity > 0"];
  if (categoryId) {
    params.push(categoryId);
    filters.push(`m.category_id = $${params.length}`);
  }
  let statusFilter = '';
  if (status) {
    params.push(status);
    statusFilter = `WHERE status = $${params.length}`;
  }
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT *, count(*) OVER() AS total_count FROM (
       SELECT x.branch_id, br.name AS branch_name, x.medicine_id, m.name AS medicine_name, c.name AS category_name,
              x.total_quantity, x.sellable_quantity, x.expired_quantity, x.expiring_soon_quantity, x.minimum_stock,
              x.inventory_value, x.nearest_expiry,
              CASE WHEN x.sellable_quantity = 0 THEN 'OUT_OF_STOCK'
                   WHEN x.sellable_quantity <= x.minimum_stock THEN 'LOW_STOCK'
                   WHEN x.expiring_soon_quantity > 0 THEN 'EXPIRING_SOON'
                   ELSE 'AVAILABLE' END AS status
         FROM (
           SELECT bi.branch_id, b.medicine_id,
                  sum(bi.quantity)::int AS total_quantity,
                  COALESCE(sum(bi.quantity) FILTER (WHERE b.expiry_date >= $1::date), 0)::int AS sellable_quantity,
                  COALESCE(sum(bi.quantity) FILTER (WHERE b.expiry_date < $1::date), 0)::int AS expired_quantity,
                  COALESCE(sum(bi.quantity) FILTER (WHERE b.expiry_date >= $1::date AND b.expiry_date <= $1::date + $2::int), 0)::int AS expiring_soon_quantity,
                  max(bi.minimum_stock)::int AS minimum_stock,
                  sum(bi.quantity * b.purchase_price)::numeric(14,2) AS inventory_value,
                  min(b.expiry_date) FILTER (WHERE bi.quantity > 0 AND b.expiry_date >= $1::date) AS nearest_expiry
             FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
            WHERE ($3::uuid[] IS NULL OR bi.branch_id = ANY($3::uuid[]))
            GROUP BY bi.branch_id, b.medicine_id
         ) x
         JOIN medicines m ON m.id = x.medicine_id
         JOIN branches br ON br.id = x.branch_id
         LEFT JOIN medicine_categories c ON c.id = m.category_id
        WHERE ${filters.map((f) => `(${f})`).join(' AND ')}
     ) positions
     ${statusFilter}
     ORDER BY medicine_name, branch_name
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function inventoryTotals({ today, warningDays, branchIds }) {
  const { rows } = await query(
    `SELECT COALESCE(sum(bi.quantity), 0)::int AS total_units,
            COALESCE(sum(bi.quantity) FILTER (WHERE b.expiry_date < $1::date), 0)::int AS expired_units,
            COALESCE(sum(bi.quantity * b.purchase_price), 0)::numeric(14,2) AS inventory_value,
            COALESCE(sum(bi.quantity * b.purchase_price) FILTER (WHERE b.expiry_date < $1::date), 0)::numeric(14,2) AS expired_value,
            COALESCE(sum(bi.quantity * b.purchase_price) FILTER (WHERE b.expiry_date >= $1::date AND b.expiry_date <= $1::date + $2::int), 0)::numeric(14,2) AS expiring_soon_value,
            COALESCE(sum(bi.quantity * bi.selling_price) FILTER (WHERE b.expiry_date >= $1::date), 0)::numeric(14,2) AS retail_value
       FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
      WHERE ($3::uuid[] IS NULL OR bi.branch_id = ANY($3::uuid[]))`,
    [today, warningDays, branchIds],
  );
  return rows[0];
}

/** Expiry buckets and category value for the inventory analytics panel. */
async function inventoryDistribution({ today, branchIds }) {
  const expiry = await query(
    `SELECT bucket, sum(quantity)::int AS quantity, sum(value)::numeric(14,2) AS inventory_value FROM (
       SELECT bi.quantity, bi.quantity * b.purchase_price AS value,
              CASE WHEN b.expiry_date < $1::date THEN 'EXPIRED'
                   WHEN b.expiry_date <= $1::date + 30 THEN '0_30_DAYS'
                   WHEN b.expiry_date <= $1::date + 60 THEN '31_60_DAYS'
                   WHEN b.expiry_date <= $1::date + 90 THEN '61_90_DAYS'
                   ELSE 'OVER_90_DAYS' END AS bucket
         FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
        WHERE bi.quantity > 0 AND ($2::uuid[] IS NULL OR bi.branch_id = ANY($2::uuid[]))
     ) x GROUP BY bucket`,
    [today, branchIds],
  );
  const categories = await query(
    `SELECT COALESCE(c.name, 'Uncategorized') AS category_name,
            sum(bi.quantity)::int AS quantity,
            sum(bi.quantity * b.purchase_price)::numeric(14,2) AS inventory_value
       FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
       JOIN medicines m ON m.id = b.medicine_id LEFT JOIN medicine_categories c ON c.id = m.category_id
      WHERE bi.quantity > 0 AND ($2::uuid[] IS NULL OR bi.branch_id = ANY($2::uuid[]))
        AND b.expiry_date >= $1::date
      GROUP BY 1 ORDER BY inventory_value DESC`,
    [today, branchIds],
  );
  return { expiry: expiry.rows, categories: categories.rows };
}

async function countActiveMedicines() {
  const { rows } = await query("SELECT count(*)::int AS n FROM medicines WHERE status = 'ACTIVE'");
  return rows[0].n;
}

async function movementSummary({ timezone, dateFrom, dateTo, branchIds }) {
  const { rows } = await query(
    `SELECT movement_type, count(*)::int AS movement_count,
            COALESCE(sum(quantity_change) FILTER (WHERE quantity_change > 0), 0)::int AS units_in,
            COALESCE(-sum(quantity_change) FILTER (WHERE quantity_change < 0), 0)::int AS units_out
       FROM stock_movements
      WHERE (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
        AND ($4::uuid[] IS NULL OR branch_id = ANY($4::uuid[]))
      GROUP BY movement_type ORDER BY movement_type`,
    [timezone, dateFrom, dateTo, branchIds],
  );
  return rows;
}

// Stock that left inventory without a sale: valued at the batch purchase price.
const LOSS_MOVEMENT_TYPES = ['EXPIRED', 'DAMAGED', 'LOST', 'DISPOSED'];

function lossFilter({ timezone, dateFrom, dateTo, branchIds, movementType }) {
  const params = [timezone, dateFrom, dateTo, branchIds || null, movementType ? [movementType] : LOSS_MOVEMENT_TYPES];
  const where = `sm.quantity_change < 0
      AND sm.movement_type = ANY($5::text[])
      AND (sm.created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
      AND ($4::uuid[] IS NULL OR sm.branch_id = ANY($4::uuid[]))`;
  return { params, where };
}

async function stockLosses(filters, { limit, offset }) {
  const { params, where } = lossFilter(filters);
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT sm.id, sm.created_at, br.name AS branch_name, m.name AS medicine_name, b.batch_number, b.expiry_date,
            sm.movement_type, -sm.quantity_change AS quantity, b.purchase_price AS unit_cost,
            (-sm.quantity_change * b.purchase_price)::numeric(14,2) AS loss_value,
            u.full_name AS created_by_name, sm.reason,
            count(*) OVER() AS total_count
       FROM stock_movements sm
       JOIN batches b ON b.id = sm.batch_id
       JOIN medicines m ON m.id = b.medicine_id
       JOIN branches br ON br.id = sm.branch_id
       JOIN users u ON u.id = sm.created_by
      WHERE ${where}
      ORDER BY sm.created_at DESC
      LIMIT $6 OFFSET $7`,
    params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function stockLossSummary(filters) {
  const { params, where } = lossFilter(filters);
  const { rows } = await query(
    `SELECT count(*)::int AS entry_count,
            COALESCE(sum(-sm.quantity_change), 0)::int AS units_lost,
            COALESCE(sum(-sm.quantity_change * b.purchase_price), 0)::numeric(14,2) AS total_loss_value,
            COALESCE(sum(-sm.quantity_change * b.purchase_price) FILTER (WHERE sm.movement_type IN ('EXPIRED', 'DISPOSED')), 0)::numeric(14,2) AS expiry_loss_value,
            COALESCE(sum(-sm.quantity_change * b.purchase_price) FILTER (WHERE sm.movement_type IN ('DAMAGED', 'LOST')), 0)::numeric(14,2) AS damage_loss_value
       FROM stock_movements sm JOIN batches b ON b.id = sm.batch_id
      WHERE ${where}`,
    params,
  );
  return rows[0];
}

async function purchaseSummary({ dateFrom, dateTo, branchIds, supplierId, status }) {
  const { rows } = await query(
    `WITH p AS (
       SELECT p.*, COALESCE((SELECT sum(amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id), 0) AS paid,
              (SELECT COALESCE(sum(ri.quantity * ri.purchase_price), 0) FROM purchase_receiving_items ri
                 JOIN purchase_receivings r ON r.id = ri.receiving_id WHERE r.purchase_id = p.id) AS received_value
         FROM purchases p
        WHERE p.purchase_date BETWEEN $1::date AND $2::date
          AND ($3::uuid[] IS NULL OR p.branch_id = ANY($3::uuid[]))
          AND ($4::uuid IS NULL OR p.supplier_id = $4)
          AND ($5::text IS NULL OR p.status = $5)
     )
     SELECT count(*)::int AS purchase_count,
            count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled_count,
            count(*) FILTER (WHERE status IN ('PENDING', 'PARTIALLY_RECEIVED'))::int AS open_count,
            COALESCE(sum(total) FILTER (WHERE status NOT IN ('DRAFT', 'CANCELLED')), 0)::numeric(14,2) AS ordered_value,
            COALESCE(sum(received_value), 0)::numeric(14,2) AS received_value,
            COALESCE(sum(paid), 0)::numeric(14,2) AS total_paid,
            COALESCE(sum(total - paid) FILTER (WHERE status NOT IN ('DRAFT', 'CANCELLED')), 0)::numeric(14,2) AS outstanding
       FROM p`,
    [dateFrom, dateTo, branchIds, supplierId || null, status || null],
  );
  return rows[0];
}

async function supplierSummary({ dateFrom, dateTo, branchIds, search, limit, offset }) {
  const { rows } = await query(
    `SELECT s.id AS supplier_id, s.company_name, s.phone, s.status,
            count(p.id) FILTER (WHERE p.status NOT IN ('DRAFT', 'CANCELLED'))::int AS purchase_count,
            COALESCE(sum(p.total) FILTER (WHERE p.status NOT IN ('DRAFT', 'CANCELLED')), 0)::numeric(14,2) AS total_purchased,
            COALESCE(sum((SELECT sum(amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id)), 0)::numeric(14,2) AS total_paid,
            (COALESCE(sum(p.total) FILTER (WHERE p.status NOT IN ('DRAFT', 'CANCELLED')), 0)
              - COALESCE(sum((SELECT sum(amount) FROM supplier_payments sp WHERE sp.purchase_id = p.id)), 0))::numeric(14,2) AS balance,
            max(p.purchase_date) AS last_purchase_date,
            count(*) OVER() AS total_count
       FROM suppliers s
       LEFT JOIN purchases p ON p.supplier_id = s.id
            AND p.purchase_date BETWEEN $1::date AND $2::date
            AND ($3::uuid[] IS NULL OR p.branch_id = ANY($3::uuid[]))
      WHERE ($4::text IS NULL OR s.company_name ILIKE '%' || $4 || '%')
      GROUP BY s.id
      ORDER BY total_purchased DESC, s.company_name
      LIMIT $5 OFFSET $6`,
    [dateFrom, dateTo, branchIds, search || null, limit, offset],
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function pharmacyName() {
  const { rows } = await query('SELECT pharmacy_name FROM system_settings WHERE id = 1');
  return rows[0] ? rows[0].pharmacy_name : 'Pharmacy';
}

module.exports = {
  pharmacyName,
  buildSalesFilter,
  salesSummary,
  salesSeries,
  medicinePerformance,
  categoryPerformance,
  branchComparison,
  inventoryPositions,
  inventoryTotals,
  inventoryDistribution,
  countActiveMedicines,
  movementSummary,
  stockLosses,
  stockLossSummary,
  purchaseSummary,
  supplierSummary,
};
