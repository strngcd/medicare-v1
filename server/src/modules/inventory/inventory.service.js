const AppError = require('../../errors/AppError');
const { resolveBatchIdentity, ensureNewLot } = require('./batchIdentity');
const { withTransaction } = require('../../database/db');
const { recordAudit } = require('../audit/audit.recorder');
const { runIdempotent } = require('../idempotency/idempotency');
const { nextDocumentNumber } = require('../documents/documentNumbers');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { money, toMoneyString } = require('../../utils/money');
const { addDays, businessToday } = require('../../utils/time');
const config = require('../../config');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { resolveBranchScope, assertBranchAccess, loadAccessibleBranch } = require('../../permissions/branchAccess');
const { filterFinancialFields } = require('../../permissions/financialVisibility');
const { getExpiryWarningDays } = require('./inventoryStatus');
const { allocateFefo } = require('./fefo');
const ledger = require('./inventory.ledger');
const repo = require('./inventory.repository');

const INVENTORY_SORTABLE = {
  medicineName: 'm.name',
  expiryDate: 'b.expiry_date',
  quantity: 'bi.quantity',
  branchName: 'br.name',
  sellingPrice: 'bi.selling_price',
  updatedAt: 'bi.updated_at',
};
const BATCH_SORTABLE = { expiryDate: 'b.expiry_date', batchNumber: 'b.batch_number', medicineName: 'm.name', createdAt: 'b.created_at' };
const MOVEMENT_SORTABLE = { createdAt: 'sm.created_at', movementType: 'sm.movement_type', quantityChange: 'sm.quantity_change' };

// Adjustment reason -> stock movement type (approved mapping).
const ADJUSTMENT_MOVEMENT_TYPE = {
  DAMAGED: 'DAMAGED',
  EXPIRED: 'EXPIRED',
  LOST: 'LOST',
  FOUND: 'CORRECTION',
  CORRECTION: 'CORRECTION',
  OTHER: 'ADJUSTMENT',
  DISPOSED: 'DISPOSED',
};

// Fields only shown to users who may view batch details.
const BATCH_DETAIL_FIELDS = ['batchNumber', 'manufacturingDate', 'supplierId', 'supplierName'];

function stripTotal(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  return dto;
}

/** Applies batch-detail and financial visibility rules to inventory DTOs. */
function presentInventory(auth, rows) {
  const canSeeBatches = auth.permissions.has(P.INVENTORY_VIEW_BATCHES);
  const dtos = rows.map((row) => {
    const dto = stripTotal(row);
    if (!canSeeBatches) for (const field of BATCH_DETAIL_FIELDS) delete dto[field];
    return dto;
  });
  return filterFinancialFields(dtos, auth);
}

async function statusContext() {
  return { today: businessToday(), warningDays: await getExpiryWarningDays() };
}

// ---------------------------------------------------------------------------
// Inventory queries
// ---------------------------------------------------------------------------

async function listInventory(auth, query, forcedStatuses) {
  const params = parseListParams(query, { sortable: INVENTORY_SORTABLE, defaultSort: 'medicineName', defaultOrder: 'asc' });
  const statuses = forcedStatuses || (query.status ? [query.status] : null);
  const { rows, total } = await repo.listInventory({
    ...(await statusContext()),
    branchIds: resolveBranchScope(auth, query.branchId),
    medicineId: query.medicineId,
    categoryId: query.categoryId,
    productType: query.productType,
    search: query.search,
    statuses,
    archived: Boolean(query.archived),
    ...params,
  });
  return { rows: presentInventory(auth, rows), total, page: params.page, limit: params.limit };
}

async function getInventory(auth, id) {
  const row = await repo.findInventoryById(id, await statusContext());
  if (!row) throw AppError.notFound('Inventory record not found.');
  assertBranchAccess(auth, row.branch_id);
  return presentInventory(auth, [row])[0];
}

async function listStockLevels(auth, query, level) {
  const params = parseListParams(query, { sortable: { default: '1' }, defaultSort: 'default' });
  const { rows, total } = await repo.listStockLevels({
    today: businessToday(),
    branchIds: resolveBranchScope(auth, query.branchId),
    level,
    limit: params.limit,
    offset: params.offset,
  });
  return { rows: rows.map(stripTotal), total, page: params.page, limit: params.limit };
}

async function branchInventorySummary(auth, branchId) {
  await loadAccessibleBranch(auth, branchId);
  const { today, warningDays } = await statusContext();
  const summary = camelize(await repo.inventorySummary({ branchIds: [branchId], today, warningDays }));
  return filterFinancialFields({ branchId, expiryWarningDays: warningDays, ...summary }, auth);
}

// ---------------------------------------------------------------------------
// Batches and movements
// ---------------------------------------------------------------------------

async function listBatches(auth, query) {
  const params = parseListParams(query, { sortable: BATCH_SORTABLE, defaultSort: 'expiryDate', defaultOrder: 'asc' });
  const { rows, total } = await repo.listBatches({
    branchIds: resolveBranchScope(auth, query.branchId),
    medicineId: query.medicineId,
    supplierId: query.supplierId,
    search: query.search,
    expiredOnly: query.expired,
    today: businessToday(),
    ...params,
  });
  return { rows: filterFinancialFields(rows.map(stripTotal), auth), total, page: params.page, limit: params.limit };
}

async function getBatch(auth, id) {
  const batch = await repo.findBatch(id);
  if (!batch) throw AppError.notFound('Batch not found.');
  const stock = await repo.listBatchStock(id, resolveBranchScope(auth, null));
  if (!auth.isOwner && stock.length === 0) throw AppError.notFound('Batch not found.');
  return filterFinancialFields({ ...camelize(batch), stock: camelize(stock) }, auth);
}

async function listMovements(auth, query, fixed = {}) {
  const params = parseListParams(query, { sortable: MOVEMENT_SORTABLE, defaultSort: 'createdAt' });
  const { rows, total } = await repo.listMovements({
    branchIds: resolveBranchScope(auth, query.branchId),
    batchId: fixed.batchId || query.batchId,
    medicineId: query.medicineId,
    movementType: query.movementType,
    referenceType: query.referenceType,
    referenceId: query.referenceId,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    timezone: config.businessTimezone,
    ...params,
  });
  return { rows: rows.map(stripTotal), total, page: params.page, limit: params.limit };
}

async function getMovement(auth, id) {
  const movement = await repo.findMovement(id);
  if (!movement) throw AppError.notFound('Stock movement not found.');
  assertBranchAccess(auth, movement.branch_id);
  return camelize(movement);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Adds stock outside of purchasing (e.g. opening stock during medicine
 * setup). Creates or reuses the batch, ensures the branch inventory row and
 * records an ADJUSTMENT movement referencing a STOCK_ADDITION.
 */
async function addStock(auth, actor, input, idempotencyKey) {
  const today = businessToday();
  if (input.expiryDate && input.expiryDate < today) {
    throw AppError.conflict('BATCH_EXPIRED', 'Expired stock cannot be added.', { fields: { expiryDate: 'This date is in the past.' } });
  }

  const result = await runIdempotent(
    { userId: auth.userId, scope: 'inventory.stock', key: idempotencyKey, payload: input },
    async (client) => {
      const branch = await loadAccessibleBranch(auth, input.branchId, { requireActive: true, client });
      const medicine = await repo.findMedicineForStock(client, input.medicineId);
      if (!medicine) throw AppError.notFound('Medicine not found.');
      if (medicine.status === 'ARCHIVED') {
        throw AppError.conflict('MEDICINE_ARCHIVED', 'Archived medicines cannot receive stock.');
      }
      const identity = resolveBatchIdentity(medicine.product_type, input);
      if (input.supplierId) {
        const supplier = await repo.findSupplier(client, input.supplierId);
        if (!supplier) throw AppError.validation('Supplier not found.', { fields: { supplierId: 'Select a valid supplier.' } });
      }

      const { batch, created: batchCreated } = await ledger.findOrCreateBatch(client, {
        medicineId: medicine.id,
        batchNumber: await ensureNewLot(client, medicine.id, identity),
        manufacturingDate: input.manufacturingDate,
        expiryDate: identity.expiryDate,
        purchasePrice: input.purchasePrice,
        supplierId: input.supplierId,
        userId: auth.userId,
      });

      const { row, created: rowCreated } = await ledger.ensureInventoryRow(client, {
        branchId: branch.id,
        batchId: batch.id,
        sellingPrice: input.sellingPrice,
        minimumStock: input.minimumStock,
      });
      if (!rowCreated && toMoneyString(row.selling_price) !== toMoneyString(input.sellingPrice)) {
        await repo.updateInventoryField(client, row.id, 'selling_price', input.sellingPrice);
        await recordAudit(client, actor, {
          action: 'SELLING_PRICE_CHANGED',
          entityType: 'INVENTORY',
          entityId: row.id,
          branchId: branch.id,
          description: `Selling price of ${medicine.name} batch ${batch.batch_number} changed while adding stock`,
          previousValues: { sellingPrice: row.selling_price },
          newValues: { sellingPrice: toMoneyString(input.sellingPrice) },
        });
      }

      const movement = await ledger.applyMovement(client, {
        branchId: branch.id,
        batchId: batch.id,
        change: input.quantity,
        movementType: 'ADJUSTMENT',
        referenceType: 'STOCK_ADDITION',
        referenceId: row.id,
        reason: input.notes ? `Stock added: ${input.notes}` : 'Stock added',
        userId: auth.userId,
      });

      await recordAudit(client, actor, {
        action: 'STOCK_ADDED',
        entityType: 'INVENTORY',
        entityId: row.id,
        branchId: branch.id,
        description: `${input.quantity} units of ${medicine.name} (batch ${batch.batch_number}) added to ${branch.name}`,
        newValues: {
          batchNumber: batch.batch_number,
          batchCreated,
          quantityBefore: movement.quantityBefore,
          quantityAfter: movement.quantityAfter,
          expiryDate: batch.expiry_date,
          purchasePrice: batch.purchase_price,
          sellingPrice: toMoneyString(input.sellingPrice),
        },
      });

      return { inventoryId: row.id, batchId: batch.id, batchCreated, quantityAfter: movement.quantityAfter };
    },
  );

  const inventory = await getInventory(auth, result.body.inventoryId);
  return { ...result, body: { ...result.body, inventory } };
}

function validateAdjustment({ reason, quantityChange, notes }, quantityBefore) {
  const errors = {};
  if (['DAMAGED', 'EXPIRED', 'LOST', 'DISPOSED'].includes(reason) && quantityChange >= 0) {
    errors.quantityChange = `${reason.toLowerCase()} adjustments must reduce stock.`;
  }
  if (reason === 'FOUND' && quantityChange <= 0) errors.quantityChange = 'Found stock must increase the quantity.';
  if (reason === 'OTHER' && !(notes && notes.trim())) errors.notes = 'A note is required for "Other".';
  if (quantityBefore + quantityChange < 0) {
    errors.quantityChange = `Stock cannot go below zero (current quantity is ${quantityBefore}).`;
  }
  return errors;
}

async function previewAdjustment(auth, input) {
  const row = await repo.findInventoryById(input.inventoryId, await statusContext());
  if (!row) throw AppError.notFound('Inventory record not found.');
  assertBranchAccess(auth, row.branch_id);
  const errors = validateAdjustment(input, row.quantity);
  return {
    inventoryId: row.id,
    medicineName: row.medicine_name,
    batchNumber: row.batch_number,
    branchName: row.branch_name,
    reason: input.reason,
    movementType: ADJUSTMENT_MOVEMENT_TYPE[input.reason],
    quantityBefore: row.quantity,
    quantityChange: input.quantityChange,
    quantityAfter: row.quantity + input.quantityChange,
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

async function createAdjustment(auth, actor, input, idempotencyKey) {
  return runIdempotent(
    { userId: auth.userId, scope: 'inventory.adjustments', key: idempotencyKey, payload: input },
    async (client) => {
      const row = await ledger.lockInventoryById(client, input.inventoryId);
      if (!row) throw AppError.notFound('Inventory record not found.');
      assertBranchAccess(auth, row.branch_id);
      if (row.branch_status !== 'ACTIVE' && input.quantityChange > 0) {
        throw AppError.conflict('BRANCH_INACTIVE', 'Inactive branches cannot receive new stock.');
      }
      // Guards the preview -> confirm flow against concurrent changes.
      if (input.expectedQuantityBefore !== undefined && input.expectedQuantityBefore !== row.quantity) {
        throw AppError.conflict('STOCK_CHANGED', 'The stock level changed since the preview. Review and confirm again.', {
          expected: input.expectedQuantityBefore,
          actual: row.quantity,
        });
      }
      const errors = validateAdjustment(input, row.quantity);
      if (Object.keys(errors).length) {
        if (errors.quantityChange && row.quantity + input.quantityChange < 0) {
          throw AppError.conflict('INSUFFICIENT_STOCK', errors.quantityChange, { fields: errors });
        }
        throw AppError.validation('The adjustment is not valid.', { fields: errors });
      }

      const adjustmentNumber = await nextDocumentNumber(client, 'STOCK_ADJUSTMENT');
      const quantityAfter = row.quantity + input.quantityChange;
      const adjustment = await repo.insertAdjustment(client, {
        adjustmentNumber,
        branchId: row.branch_id,
        batchId: row.batch_id,
        inventoryId: row.id,
        reason: input.reason,
        quantityBefore: row.quantity,
        quantityChange: input.quantityChange,
        quantityAfter,
        notes: input.notes,
        userId: auth.userId,
      });
      await ledger.applyMovement(client, {
        branchId: row.branch_id,
        batchId: row.batch_id,
        change: input.quantityChange,
        movementType: ADJUSTMENT_MOVEMENT_TYPE[input.reason],
        referenceType: 'INVENTORY_ADJUSTMENT',
        referenceId: adjustment.id,
        reason: input.notes ? `${input.reason}: ${input.notes}` : input.reason,
        userId: auth.userId,
      });
      await recordAudit(client, actor, {
        action: 'INVENTORY_ADJUSTED',
        entityType: 'INVENTORY_ADJUSTMENT',
        entityId: adjustment.id,
        branchId: row.branch_id,
        description: `${adjustmentNumber}: ${row.medicine_name} batch ${row.batch_number} ${input.quantityChange > 0 ? '+' : ''}${input.quantityChange} (${input.reason})`,
        previousValues: { quantity: row.quantity },
        newValues: { quantity: quantityAfter, reason: input.reason, notes: input.notes ?? null },
      });

      return {
        id: adjustment.id,
        adjustmentNumber,
        inventoryId: row.id,
        branchId: row.branch_id,
        batchId: row.batch_id,
        reason: input.reason,
        quantityBefore: row.quantity,
        quantityChange: input.quantityChange,
        quantityAfter,
        notes: input.notes ?? null,
        createdAt: adjustment.created_at,
      };
    },
  );
}

/**
 * Writes off some or (by default) all remaining stock of a batch row: expired, expiring, or in
 * date with a reason (damaged, recalled...). The units leave inventory through a DISPOSED adjustment, valued at the batch's
 * purchase price and, unless recordAsLoss is false, reported as a stock loss. Optionally archives the row
 * when it ends up empty.
 */
async function disposeStock(auth, actor, id, { quantity: requested, notes, archive, recordAsLoss = true }, idempotencyKey) {
  const { today, warningDays } = await statusContext();
  const result = await runIdempotent(
    { userId: auth.userId, scope: `inventory.dispose:${id}`, key: idempotencyKey, payload: { quantity: requested, notes, archive, recordAsLoss } },
    async (client) => {
      const row = await ledger.lockInventoryById(client, id);
      if (!row) throw AppError.notFound('Inventory record not found.');
      assertBranchAccess(auth, row.branch_id);
      if (row.quantity === 0) throw AppError.conflict('NOTHING_TO_DISPOSE', 'This batch has no stock left to dispose of.');
      const expired = row.expiry_date < today;
      const expiringSoon = !expired && row.expiry_date <= addDays(today, warningDays);
      // In-date stock (damaged, recalled, contaminated...) may be disposed of too,
      // but the loss must be explained.
      if (!expired && !expiringSoon && !notes) {
        throw AppError.validation('Say why in-date stock is being disposed of.', {
          fields: { notes: 'Give a reason, e.g. damaged or recalled.' },
        });
      }
      if (archive && !auth.permissions.has(P.INVENTORY_BATCH_ARCHIVE)) {
        throw AppError.forbidden('PERMISSION_DENIED', 'You do not have permission to archive batches.');
      }

      const quantity = requested ?? row.quantity;
      if (quantity > row.quantity) {
        throw AppError.validation(`Only ${row.quantity} unit(s) are in stock.`, { fields: { quantity: `At most ${row.quantity}.` } });
      }
      const remaining = row.quantity - quantity;
      // Archiving hides an empty row; a partial disposal leaves stock, so it stays visible.
      const archived = Boolean(archive) && remaining === 0;
      const lossValue = toMoneyString(money(row.purchase_price).times(quantity));
      const adjustmentNumber = await nextDocumentNumber(client, 'STOCK_ADJUSTMENT');
      const condition = expired ? 'expired' : expiringSoon ? 'expiring soon' : 'in date';
      const label = expired ? 'Expired stock disposed' : expiringSoon ? 'Expiring stock disposed' : 'Stock disposed';
      const adjustment = await repo.insertAdjustment(client, {
        adjustmentNumber,
        branchId: row.branch_id,
        batchId: row.batch_id,
        inventoryId: row.id,
        reason: 'DISPOSED',
        quantityBefore: row.quantity,
        quantityChange: -quantity,
        quantityAfter: remaining,
        notes: notes || label,
        userId: auth.userId,
      });
      await ledger.applyMovement(client, {
        branchId: row.branch_id,
        batchId: row.batch_id,
        change: -quantity,
        movementType: 'DISPOSED',
        referenceType: 'INVENTORY_ADJUSTMENT',
        referenceId: adjustment.id,
        reason: `${notes ? `${label}: ${notes}` : label}${recordAsLoss ? '' : ' (not recorded as a loss)'}`,
        userId: auth.userId,
        countsAsLoss: recordAsLoss,
      });
      if (archived) await repo.setArchived(client, row.id, auth.userId);
      await recordAudit(client, actor, {
        action: 'STOCK_DISPOSED',
        entityType: 'INVENTORY_ADJUSTMENT',
        entityId: adjustment.id,
        branchId: row.branch_id,
        description: `${adjustmentNumber}: ${quantity} units of ${row.medicine_name} batch ${row.batch_number} disposed (${condition}${recordAsLoss ? '' : ', not recorded as a loss'})`,
        previousValues: { quantity: row.quantity },
        newValues: { quantity: remaining, disposed: quantity, expiryDate: row.expiry_date, lossValue: recordAsLoss ? lossValue : '0.00', recordedAsLoss: recordAsLoss, archived, notes: notes ?? null },
      });
      return { id: adjustment.id, adjustmentNumber, inventoryId: row.id, quantityDisposed: quantity, quantityRemaining: remaining, archived, recordedAsLoss: recordAsLoss, lossValue: recordAsLoss ? lossValue : '0.00' };
    },
  );
  return { ...result, body: filterFinancialFields(result.body, auth) };
}

/** Hides (or un-hides) an empty batch row. Rows with stock cannot be archived. */
async function setInventoryArchived(auth, actor, id, archived) {
  await withTransaction(async (client) => {
    const row = await ledger.lockInventoryById(client, id);
    if (!row) throw AppError.notFound('Inventory record not found.');
    assertBranchAccess(auth, row.branch_id);
    if (archived && row.archived_at) throw AppError.conflict('BATCH_ALREADY_ARCHIVED', 'This batch is already archived.');
    if (!archived && !row.archived_at) throw AppError.conflict('BATCH_NOT_ARCHIVED', 'This batch is not archived.');
    if (archived && row.quantity > 0) {
      throw AppError.conflict('BATCH_HAS_STOCK', `This batch still has ${row.quantity} units. Sell, transfer or dispose of them before archiving.`);
    }
    await repo.setArchived(client, id, archived ? auth.userId : null);
    await recordAudit(client, actor, {
      action: archived ? 'BATCH_ARCHIVED' : 'BATCH_RESTORED',
      entityType: 'INVENTORY',
      entityId: id,
      branchId: row.branch_id,
      description: `${row.medicine_name} batch ${row.batch_number} ${archived ? 'archived' : 'restored'}`,
      previousValues: { archived: !archived },
      newValues: { archived },
    });
  });
  return getInventory(auth, id);
}

async function updateInventorySetting(auth, actor, id, field, value) {
  return withTransaction(async (client) => {
    const row = await ledger.lockInventoryById(client, id);
    if (!row) throw AppError.notFound('Inventory record not found.');
    assertBranchAccess(auth, row.branch_id);

    const column = field === 'minimumStock' ? 'minimum_stock' : 'selling_price';
    const previous = field === 'minimumStock' ? row.minimum_stock : row.selling_price;
    const next = field === 'minimumStock' ? value : toMoneyString(value);
    if (String(previous) !== String(next)) {
      await repo.updateInventoryField(client, id, column, next);
      await recordAudit(client, actor, {
        action: field === 'minimumStock' ? 'MINIMUM_STOCK_CHANGED' : 'SELLING_PRICE_CHANGED',
        entityType: 'INVENTORY',
        entityId: id,
        branchId: row.branch_id,
        description: `${field === 'minimumStock' ? 'Minimum stock' : 'Selling price'} of ${row.medicine_name} batch ${row.batch_number} changed`,
        previousValues: { [field]: previous },
        newValues: { [field]: next },
      });
    }
    return null;
  }).then(() => getInventory(auth, id));
}

/**
 * Non-binding FEFO preview for the POS. The sale itself recalculates the
 * allocation under row locks.
 */
async function fefoPreview(auth, { branchId, medicineId, quantity }) {
  await loadAccessibleBranch(auth, branchId);
  const today = businessToday();
  // A plain read: the preview never locks rows.
  const batches = await repo.listSellableBatches({ branchId, medicineId, today });

  const available = batches.reduce((sum, b) => sum + b.available, 0);
  let allocation = [];
  let sufficient = true;
  try {
    allocation = allocateFefo(batches, quantity);
  } catch (err) {
    if (err.code !== 'INSUFFICIENT_STOCK') throw err;
    sufficient = false;
    allocation = allocateFefo(batches, available || 0);
  }
  const byId = new Map(batches.map((b) => [b.batchId, b]));
  return {
    medicineId,
    branchId,
    requestedQuantity: quantity,
    availableQuantity: available,
    sufficient,
    allocation: allocation.map((a) => {
      const b = byId.get(a.batchId);
      return { ...a, batchNumber: b.batchNumber, expiryDate: b.expiryDate, sellingPrice: b.sellingPrice };
    }),
    sellableBatches: batches
      .sort((a, b) => (a.expiryDate < b.expiryDate ? -1 : a.expiryDate > b.expiryDate ? 1 : 0))
      .map(({ createdAt, ...rest }) => rest),
  };
}

// ---------------------------------------------------------------------------
// Medicine-centric views
// ---------------------------------------------------------------------------

async function medicineBatches(auth, medicineId, branchId) {
  const result = await listBatches(auth, { medicineId, branchId, limit: 100 });
  return result.rows;
}

async function medicineInventory(auth, medicineId, branchId) {
  const result = await listInventory(auth, { medicineId, branchId, limit: 100, sortBy: 'expiryDate', sortOrder: 'asc' });
  return result.rows;
}

module.exports = {
  disposeStock,
  setInventoryArchived,
  listInventory,
  getInventory,
  listStockLevels,
  branchInventorySummary,
  listBatches,
  getBatch,
  listMovements,
  getMovement,
  addStock,
  previewAdjustment,
  createAdjustment,
  updateMinimumStock: (auth, actor, id, value) => updateInventorySetting(auth, actor, id, 'minimumStock', value),
  updateSellingPrice: (auth, actor, id, value) => updateInventorySetting(auth, actor, id, 'sellingPrice', value),
  fefoPreview,
  medicineBatches,
  medicineInventory,
  ADJUSTMENT_MOVEMENT_TYPE,
};
