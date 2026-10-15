const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');
const { medicineStockCte, rowStatusSql } = require('./inventoryStatus');

/**
 * Inventory rows (branch x batch) with derived status.
 * Params $1 = business date, $2 = expiry warning days.
 */
async function listInventory({ today, warningDays, ids, branchIds, medicineId, categoryId, productType, statuses, search, archived = false, limit, offset, orderBy }) {
  // $3 is the branch scope, shared by the stock CTE and the row filter.
  const w = whereBuilder([today, warningDays, branchIds || null]);
  if (ids) w.add('bi.id = ANY(?::uuid[])', ids);
  // Archived (empty, hidden) batch rows are listed only on request; lookups by id always find them.
  else w.add(archived ? 'bi.archived_at IS NOT NULL' : 'bi.archived_at IS NULL');
  if (branchIds) w.add('bi.branch_id = ANY($3::uuid[])');
  if (medicineId) w.add('b.medicine_id = ?', medicineId);
  if (categoryId) w.add('m.category_id = ?', categoryId);
  if (productType) w.add('m.product_type = ?', productType);
  if (search) w.add('(m.name ILIKE ? OR m.generic_name ILIKE ? OR b.batch_number ILIKE ? OR m.barcode = ?)', `%${search}%`, `%${search}%`, `%${search}%`, search);
  if (statuses && statuses.length) w.add(`(${rowStatusSql('$1', '$2')}) = ANY(?::text[])`, statuses);

  const { rows } = await query(
    `WITH ${medicineStockCte('$1', '$3')}
     SELECT bi.id, bi.branch_id, br.name AS branch_name, br.code AS branch_code, br.status AS branch_status,
            bi.batch_id, b.batch_number, b.manufacturing_date, b.expiry_date, b.purchase_price,
            b.supplier_id, s.company_name AS supplier_name,
            b.medicine_id, m.name AS medicine_name, m.product_type, m.brand_name, m.strength, m.dosage_form, m.package_size,
            m.status AS medicine_status, m.category_id, c.name AS category_name,
            bi.quantity, bi.minimum_stock, bi.selling_price,
            ms.sellable_quantity AS medicine_sellable_quantity, ms.minimum_stock AS medicine_minimum_stock,
            (bi.quantity * b.purchase_price)::numeric(14,2) AS inventory_value,
            (b.expiry_date - $1::date) AS days_to_expiry,
            ${rowStatusSql('$1', '$2')} AS status,
            bi.archived_at, bi.created_at, bi.updated_at,
            count(*) OVER() AS total_count
       FROM branch_inventory bi
       JOIN batches b ON b.id = bi.batch_id
       JOIN medicines m ON m.id = b.medicine_id
       JOIN branches br ON br.id = bi.branch_id
       LEFT JOIN medicine_categories c ON c.id = m.category_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
       JOIN medicine_stock ms ON ms.branch_id = bi.branch_id AND ms.medicine_id = b.medicine_id
       ${w.sql}
      ORDER BY ${orderBy}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function findInventoryById(id, { today, warningDays }) {
  const { rows } = await listInventory({ today, warningDays, ids: [id], limit: 1, offset: 0, orderBy: 'bi.id' });
  return rows[0] || null;
}

async function listBatches({ branchIds, medicineId, supplierId, search, expiredOnly, today, limit, offset, orderBy }) {
  const w = whereBuilder([branchIds, today]);
  if (medicineId) w.add('b.medicine_id = ?', medicineId);
  if (supplierId) w.add('b.supplier_id = ?', supplierId);
  if (search) w.add('(b.batch_number ILIKE ? OR m.name ILIKE ?)', `%${search}%`, `%${search}%`);
  if (expiredOnly !== undefined) w.add(expiredOnly ? 'b.expiry_date < $2::date' : 'b.expiry_date >= $2::date');
  // Only batches stocked in a visible branch (or anywhere, for org-wide scope).
  w.add(`($1::uuid[] IS NULL OR EXISTS (
           SELECT 1 FROM branch_inventory x WHERE x.batch_id = b.id AND x.branch_id = ANY($1::uuid[])))`);

  const { rows } = await query(
    `SELECT b.id, b.medicine_id, m.name AS medicine_name, m.strength, m.dosage_form, m.package_size,
            b.batch_number, b.manufacturing_date, b.expiry_date,
            b.purchase_price, b.supplier_id, s.company_name AS supplier_name, b.created_at,
            (b.expiry_date < $2::date) AS is_expired,
            COALESCE((SELECT sum(x.quantity) FROM branch_inventory x
                       WHERE x.batch_id = b.id AND ($1::uuid[] IS NULL OR x.branch_id = ANY($1::uuid[]))), 0)::int AS quantity,
            count(*) OVER() AS total_count
       FROM batches b
       JOIN medicines m ON m.id = b.medicine_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
       ${w.sql}
      ORDER BY ${orderBy}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function findBatch(id) {
  const { rows } = await query(
    `SELECT b.id, b.medicine_id, m.name AS medicine_name, m.status AS medicine_status, b.batch_number,
            b.manufacturing_date, b.expiry_date, b.purchase_price, b.supplier_id, s.company_name AS supplier_name,
            b.created_at, b.updated_at
       FROM batches b
       JOIN medicines m ON m.id = b.medicine_id
       LEFT JOIN suppliers s ON s.id = b.supplier_id
      WHERE b.id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function listBatchStock(batchId, branchIds) {
  const { rows } = await query(
    `SELECT bi.id AS inventory_id, bi.branch_id, br.name AS branch_name, br.code AS branch_code,
            bi.quantity, bi.minimum_stock, bi.selling_price, bi.archived_at
       FROM branch_inventory bi JOIN branches br ON br.id = bi.branch_id
      WHERE bi.batch_id = $1 AND ($2::uuid[] IS NULL OR bi.branch_id = ANY($2::uuid[]))
      ORDER BY br.name`,
    [batchId, branchIds],
  );
  return rows;
}

async function listMovements({ branchIds, batchId, medicineId, movementType, referenceType, referenceId, dateFrom, dateTo, timezone, limit, offset, orderBy }) {
  const w = whereBuilder();
  if (branchIds) w.add('sm.branch_id = ANY(?::uuid[])', branchIds);
  if (batchId) w.add('sm.batch_id = ?', batchId);
  if (medicineId) w.add('b.medicine_id = ?', medicineId);
  if (movementType) w.add('sm.movement_type = ?', movementType);
  if (referenceType) w.add('sm.reference_type = ?', referenceType);
  if (referenceId) w.add('sm.reference_id = ?', referenceId);
  if (dateFrom) w.add('sm.created_at >= (?::date AT TIME ZONE ?)', dateFrom, timezone);
  if (dateTo) w.add('sm.created_at < ((?::date + 1) AT TIME ZONE ?)', dateTo, timezone);

  const { rows } = await query(
    `SELECT sm.id, sm.branch_id, br.name AS branch_name, sm.batch_id, b.batch_number,
            b.medicine_id, m.name AS medicine_name, m.strength, m.dosage_form, m.package_size,
            sm.movement_type, sm.quantity_change,
            sm.quantity_before, sm.quantity_after, sm.reference_type, sm.reference_id, sm.reason,
            sm.created_by, u.full_name AS created_by_name, sm.created_at,
            count(*) OVER() AS total_count
       FROM stock_movements sm
       JOIN batches b ON b.id = sm.batch_id
       JOIN medicines m ON m.id = b.medicine_id
       JOIN branches br ON br.id = sm.branch_id
       JOIN users u ON u.id = sm.created_by
       ${w.sql}
      ORDER BY ${orderBy}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function insertAdjustment(client, data) {
  const { rows } = await query(
    `INSERT INTO inventory_adjustments (adjustment_number, branch_id, batch_id, branch_inventory_id, reason,
       quantity_before, quantity_change, quantity_after, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, adjustment_number, created_at`,
    [
      data.adjustmentNumber, data.branchId, data.batchId, data.inventoryId, data.reason,
      data.quantityBefore, data.quantityChange, data.quantityAfter, data.notes ?? null, data.userId,
    ],
    client,
  );
  return rows[0];
}

async function updateInventoryField(client, id, column, value) {
  if (!['minimum_stock', 'selling_price'].includes(column)) throw new Error('Unsupported inventory field');
  await query(`UPDATE branch_inventory SET ${column} = $2 WHERE id = $1`, [id, value], client);
}

async function setArchived(client, id, userId) {
  await query(
    `UPDATE branch_inventory
        SET archived_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE now() END, archived_by = $2
      WHERE id = $1`,
    [id, userId],
    client,
  );
}

async function findMedicineForStock(client, medicineId) {
  const { rows } = await query('SELECT id, name, status, product_type FROM medicines WHERE id = $1 FOR SHARE', [medicineId], client);
  return rows[0] || null;
}

async function findSupplier(client, supplierId) {
  const { rows } = await query('SELECT id, company_name, status FROM suppliers WHERE id = $1 AND deleted_at IS NULL', [supplierId], client);
  return rows[0] || null;
}

/** Status counts and totals for a branch (or the whole organization). */
async function inventorySummary({ branchIds, today, warningDays }) {
  const { rows } = await query(
    `WITH ${medicineStockCte('$1', '$3')},
     scoped AS (
       SELECT ms.* FROM medicine_stock ms
         JOIN medicines m ON m.id = ms.medicine_id
        WHERE m.status <> 'ARCHIVED' AND ($3::uuid[] IS NULL OR ms.branch_id = ANY($3::uuid[]))
     )
     SELECT
       (SELECT count(DISTINCT medicine_id) FROM scoped WHERE total_quantity > 0)::int AS stocked_medicines,
       (SELECT count(*) FROM scoped WHERE sellable_quantity = 0)::int AS out_of_stock,
       (SELECT count(*) FROM scoped WHERE sellable_quantity > 0 AND sellable_quantity <= minimum_stock)::int AS low_stock,
       (SELECT COALESCE(sum(sellable_quantity), 0) FROM scoped)::int AS sellable_units,
       (SELECT count(*) FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
         WHERE bi.quantity > 0 AND b.expiry_date < $1::date
           AND ($3::uuid[] IS NULL OR bi.branch_id = ANY($3::uuid[])))::int AS expired_batches,
       (SELECT COALESCE(sum(bi.quantity), 0) FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
         WHERE bi.quantity > 0 AND b.expiry_date < $1::date
           AND ($3::uuid[] IS NULL OR bi.branch_id = ANY($3::uuid[])))::int AS expired_units,
       (SELECT count(*) FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
         WHERE bi.quantity > 0 AND b.expiry_date >= $1::date AND b.expiry_date <= $1::date + $2::int
           AND ($3::uuid[] IS NULL OR bi.branch_id = ANY($3::uuid[])))::int AS expiring_soon_batches,
       (SELECT COALESCE(sum(bi.quantity * b.purchase_price), 0) FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
         WHERE ($3::uuid[] IS NULL OR bi.branch_id = ANY($3::uuid[])))::numeric(14,2) AS inventory_value`,
    [today, warningDays, branchIds],
  );
  return rows[0];
}

/**
 * Medicine-per-branch stock levels (used for LOW_STOCK / OUT_OF_STOCK lists and alerts).
 * Archived medicines are excluded: they cannot be sold or restocked.
 */
async function listStockLevels({ today, branchIds, level, medicineId, limit, offset }) {
  const w = whereBuilder([today, branchIds || null]);
  w.add("m.status <> 'ARCHIVED'");
  if (branchIds) w.add('ms.branch_id = ANY($2::uuid[])');
  if (medicineId) w.add('ms.medicine_id = ?', medicineId);
  if (level === 'OUT_OF_STOCK') w.add('ms.sellable_quantity = 0');
  if (level === 'LOW_STOCK') w.add('ms.sellable_quantity > 0 AND ms.sellable_quantity <= ms.minimum_stock');

  const { rows } = await query(
    `WITH ${medicineStockCte('$1', '$2')}
     SELECT ms.branch_id, br.name AS branch_name, ms.medicine_id, m.name AS medicine_name,
            m.strength, m.dosage_form, m.package_size, c.name AS category_name,
            ms.sellable_quantity, ms.total_quantity, ms.minimum_stock,
            count(*) OVER() AS total_count
       FROM medicine_stock ms
       JOIN medicines m ON m.id = ms.medicine_id
       JOIN branches br ON br.id = ms.branch_id
       LEFT JOIN medicine_categories c ON c.id = m.category_id
       ${w.sql}
      ORDER BY ms.sellable_quantity ASC, m.name ASC
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function findMovement(id) {
  const { rows } = await query(
    `SELECT sm.id, sm.branch_id, br.name AS branch_name, sm.batch_id, b.batch_number,
            b.medicine_id, m.name AS medicine_name, m.strength, m.dosage_form, m.package_size,
            sm.movement_type, sm.quantity_change,
            sm.quantity_before, sm.quantity_after, sm.reference_type, sm.reference_id, sm.reason,
            sm.created_by, u.full_name AS created_by_name, sm.created_at
       FROM stock_movements sm
       JOIN batches b ON b.id = sm.batch_id
       JOIN medicines m ON m.id = b.medicine_id
       JOIN branches br ON br.id = sm.branch_id
       JOIN users u ON u.id = sm.created_by
      WHERE sm.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Non-locking read of sellable batches (used for previews only). */
async function listSellableBatches({ branchId, medicineId, today }) {
  const { rows } = await query(
    `SELECT bi.batch_id, bi.quantity, bi.selling_price, b.batch_number, b.expiry_date, b.created_at
       FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
      WHERE bi.branch_id = $1 AND b.medicine_id = $2 AND bi.quantity > 0 AND b.expiry_date >= $3`,
    [branchId, medicineId, today],
  );
  return rows.map((r) => ({
    batchId: r.batch_id,
    batchNumber: r.batch_number,
    expiryDate: r.expiry_date,
    createdAt: r.created_at,
    available: r.quantity,
    sellingPrice: r.selling_price,
  }));
}

module.exports = {
  findMovement,
  listSellableBatches,
  listStockLevels,
  listInventory,
  findInventoryById,
  listBatches,
  findBatch,
  listBatchStock,
  listMovements,
  insertAdjustment,
  updateInventoryField,
  setArchived,
  findMedicineForStock,
  findSupplier,
  inventorySummary,
};
