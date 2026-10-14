/**
 * The inventory ledger: the ONLY code path that changes branch_inventory.quantity.
 *
 * Every change locks the inventory row, refuses to go below zero, updates
 * the quantity and appends an immutable stock_movements row with the
 * before/after quantities, all on the caller's transaction client.
 */
const AppError = require('../../errors/AppError');
const { query } = require('../../database/db');
const { money } = require('../../utils/money');

/** Locks one inventory row for update. Returns null when it does not exist. */
async function lockInventoryRow(client, branchId, batchId) {
  const { rows } = await query(
    `SELECT id, branch_id, batch_id, quantity, minimum_stock, selling_price
       FROM branch_inventory
      WHERE branch_id = $1 AND batch_id = $2
      FOR UPDATE`,
    [branchId, batchId],
    client,
  );
  return rows[0] || null;
}

/** Locks an inventory row by its own id. */
async function lockInventoryById(client, inventoryId) {
  const { rows } = await query(
    `SELECT bi.id, bi.branch_id, bi.batch_id, bi.quantity, bi.minimum_stock, bi.selling_price, bi.archived_at,
            b.medicine_id, b.batch_number, b.expiry_date, b.purchase_price, m.name AS medicine_name, m.status AS medicine_status,
            br.status AS branch_status
       FROM branch_inventory bi
       JOIN batches b ON b.id = bi.batch_id
       JOIN medicines m ON m.id = b.medicine_id
       JOIN branches br ON br.id = bi.branch_id
      WHERE bi.id = $1
      FOR UPDATE OF bi`,
    [inventoryId],
    client,
  );
  return rows[0] || null;
}

/**
 * Creates the inventory row for (branch, batch) if it does not exist yet,
 * then locks and returns it. New rows take the branch's default minimum stock
 * unless one is given.
 */
async function ensureInventoryRow(client, { branchId, batchId, sellingPrice, minimumStock }) {
  const inserted = await query(
    `INSERT INTO branch_inventory (branch_id, batch_id, quantity, minimum_stock, selling_price)
     SELECT $1, $2, 0,
            COALESCE($3::int, (SELECT default_minimum_stock FROM branch_settings WHERE branch_id = $1), 0),
            $4
     ON CONFLICT (branch_id, batch_id) DO NOTHING
     RETURNING id`,
    [branchId, batchId, minimumStock ?? null, sellingPrice],
    client,
  );
  const row = await lockInventoryRow(client, branchId, batchId);
  return { row, created: inserted.rows.length > 0 };
}

/**
 * Applies a signed quantity change to a (locked) inventory row and records
 * the stock movement. Throws INSUFFICIENT_STOCK if the result would be negative.
 *
 * @returns {{quantityBefore: number, quantityAfter: number, movementId: string}}
 */
async function applyMovement(
  client,
  { branchId, batchId, change, movementType, referenceType, referenceId, reason = null, userId, countsAsLoss = true },
) {
  if (!Number.isInteger(change) || change === 0) {
    throw new Error(`Invalid stock movement quantity: ${change}`);
  }

  const row = await lockInventoryRow(client, branchId, batchId);
  if (!row) {
    if (change < 0) {
      throw AppError.conflict('INSUFFICIENT_STOCK', 'Insufficient stock for this medicine.', { batchId, available: 0 });
    }
    throw new Error('Inventory row must exist before stock is added');
  }

  const quantityBefore = row.quantity;
  const quantityAfter = quantityBefore + change;
  if (quantityAfter < 0) {
    throw AppError.conflict('INSUFFICIENT_STOCK', 'Insufficient stock for this medicine.', {
      batchId,
      requested: -change,
      available: quantityBefore,
    });
  }

  // Stock arriving for an archived batch row brings it back into view.
  await query(
    `UPDATE branch_inventory
        SET quantity = $2,
            archived_at = CASE WHEN $2 > 0 THEN NULL ELSE archived_at END,
            archived_by = CASE WHEN $2 > 0 THEN NULL ELSE archived_by END
      WHERE id = $1`,
    [row.id, quantityAfter],
    client,
  );
  const { rows } = await query(
    `INSERT INTO stock_movements (branch_id, batch_id, movement_type, quantity_change, quantity_before,
       quantity_after, reference_type, reference_id, reason, created_by, counts_as_loss)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [branchId, batchId, movementType, change, quantityBefore, quantityAfter, referenceType, referenceId, reason, userId, countsAsLoss],
    client,
  );
  return { quantityBefore, quantityAfter, movementId: rows[0].id, inventoryId: row.id };
}

/**
 * Finds the batch identified by (medicine, batch number) or creates it.
 * An existing batch must match the given cost and dates: historical cost is
 * never silently overwritten.
 */
async function findOrCreateBatch(
  client,
  { medicineId, batchNumber, manufacturingDate, expiryDate, purchasePrice, supplierId, userId },
) {
  const inserted = await query(
    `INSERT INTO batches (medicine_id, batch_number, manufacturing_date, expiry_date, purchase_price, supplier_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (medicine_id, batch_number) DO NOTHING
     RETURNING id`,
    [medicineId, batchNumber, manufacturingDate ?? null, expiryDate, purchasePrice, supplierId ?? null, userId],
    client,
  );
  const { rows } = await query(
    `SELECT id, medicine_id, batch_number, manufacturing_date, expiry_date, purchase_price, supplier_id
       FROM batches WHERE medicine_id = $1 AND batch_number = $2
       FOR UPDATE`,
    [medicineId, batchNumber],
    client,
  );
  const batch = rows[0];
  const created = inserted.rows.length > 0;

  if (!money(batch.purchase_price).eq(money(purchasePrice))) {
    throw AppError.conflict(
      'BATCH_COST_CONFLICT',
      `Batch ${batchNumber} already exists with a different purchase price (${batch.purchase_price}).`,
      { batchId: batch.id, batchNumber },
    );
  }
  if (batch.expiry_date !== expiryDate || (manufacturingDate && batch.manufacturing_date && batch.manufacturing_date !== manufacturingDate)) {
    throw AppError.conflict(
      'BATCH_DATA_CONFLICT',
      `Batch ${batchNumber} already exists with different manufacturing or expiry dates.`,
      { batchId: batch.id, batchNumber, expiryDate: batch.expiry_date, manufacturingDate: batch.manufacturing_date },
    );
  }
  return { batch, created };
}

/**
 * Locks every inventory row of a medicine in a branch (in a stable order to
 * avoid deadlocks) and returns the sellable (non-expired, positive) batches.
 */
async function lockSellableBatches(client, { branchId, medicineId, today }) {
  const { rows } = await query(
    `SELECT bi.id AS inventory_id, bi.batch_id, bi.quantity, bi.selling_price,
            b.batch_number, b.expiry_date, b.purchase_price, b.created_at
       FROM branch_inventory bi JOIN batches b ON b.id = bi.batch_id
      WHERE bi.branch_id = $1 AND b.medicine_id = $2
      ORDER BY bi.id
      FOR UPDATE OF bi`,
    [branchId, medicineId],
    client,
  );
  return rows
    .filter((r) => r.quantity > 0 && r.expiry_date >= today)
    .map((r) => ({
      inventoryId: r.inventory_id,
      batchId: r.batch_id,
      batchNumber: r.batch_number,
      expiryDate: r.expiry_date,
      createdAt: r.created_at,
      available: r.quantity,
      sellingPrice: r.selling_price,
      purchasePrice: r.purchase_price,
    }));
}

module.exports = {
  lockInventoryRow,
  lockInventoryById,
  ensureInventoryRow,
  applyMovement,
  findOrCreateBatch,
  lockSellableBatches,
};
