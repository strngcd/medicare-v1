const AppError = require('../../errors/AppError');
const { resolveBatchIdentity } = require('../inventory/batchIdentity');
const { withTransaction } = require('../../database/db');
const { recordAudit } = require('../audit/audit.recorder');
const { runIdempotent } = require('../idempotency/idempotency');
const { nextDocumentNumber } = require('../documents/documentNumbers');
const { notifyUsers, findBranchRecipients } = require('../notifications/notification.writer');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { money, round2, sum, toMoneyString } = require('../../utils/money');
const { businessToday } = require('../../utils/time');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { resolveBranchScope, assertBranchAccess, loadAccessibleBranch } = require('../../permissions/branchAccess');
const { canViewCost } = require('../../permissions/financialVisibility');
const ledger = require('../inventory/inventory.ledger');
const inventoryRepo = require('../inventory/inventory.repository');
const { recordPayment } = require('../supplierPayments/supplierPayments.service');
const repo = require('./purchases.repository');

const SORTABLE = {
  purchaseDate: 'purchase_date',
  purchaseNumber: 'purchase_number',
  supplierName: 'supplier_name',
  status: 'status',
  total: 'total',
  createdAt: 'created_at',
};

// Purchase amounts are acquisition cost: hidden without FINANCIAL_VIEW_PURCHASE_COST.
const PURCHASE_COST_FIELDS = [
  'subtotal', 'discount', 'tax', 'total', 'amountPaid', 'balance', 'unitPurchasePrice', 'lineTotal',
  'purchasePrice', 'totalCost',
];

function hideCost(dto) {
  if (Array.isArray(dto)) return dto.map(hideCost);
  if (!dto || typeof dto !== 'object' || dto instanceof Date) return dto;
  const out = {};
  for (const [key, value] of Object.entries(dto)) {
    if (PURCHASE_COST_FIELDS.includes(key)) continue;
    out[key] = hideCost(value);
  }
  return out;
}

function present(auth, data) {
  return canViewCost(auth) ? data : hideCost(data);
}

function toPurchaseDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  if (dto.total !== undefined && dto.amountPaid !== undefined) {
    dto.balance = dto.status === 'CANCELLED' || dto.status === 'DRAFT' ? '0.00' : toMoneyString(money(dto.total).minus(dto.amountPaid));
  }
  return dto;
}

// ---------------------------------------------------------------------------
// Calculations
// ---------------------------------------------------------------------------

/** Authoritative line and header totals (decimal arithmetic, 2 dp). */
function calculateTotals(items) {
  const lines = items.map((item, index) => {
    const gross = round2(money(item.unitPurchasePrice).times(item.orderedQuantity));
    const discount = round2(item.discount || 0);
    const tax = round2(item.tax || 0);
    if (discount.gt(gross)) {
      throw AppError.validation('A line discount cannot exceed the line amount.', {
        fields: { [`items.${index}.discount`]: 'Discount exceeds the line amount.' },
      });
    }
    return {
      ...item,
      gross,
      discount: toMoneyString(discount),
      tax: toMoneyString(tax),
      unitPurchasePrice: toMoneyString(item.unitPurchasePrice),
      lineTotal: toMoneyString(gross.minus(discount).plus(tax)),
    };
  });
  return {
    lines,
    totals: {
      subtotal: toMoneyString(sum(lines.map((l) => l.gross))),
      discount: toMoneyString(sum(lines.map((l) => l.discount))),
      tax: toMoneyString(sum(lines.map((l) => l.tax))),
      total: toMoneyString(sum(lines.map((l) => l.lineTotal))),
    },
  };
}

async function validateItems(client, items) {
  const ids = items.map((i) => i.medicineId);
  if (new Set(ids).size !== ids.length) {
    throw AppError.validation('Each medicine can appear only once in a purchase.', { fields: { items: 'Duplicate medicine.' } });
  }
  const medicines = await repo.findMedicines(client, ids);
  if (medicines.length !== ids.length) throw AppError.validation('One or more medicines do not exist.');
  const archived = medicines.find((m) => m.status === 'ARCHIVED');
  if (archived) {
    throw AppError.conflict('MEDICINE_ARCHIVED', `${archived.name} is archived and cannot be purchased.`, { medicineId: archived.id });
  }
}

async function assertActiveSupplier(client, supplierId) {
  const supplier = await repo.findSupplier(client, supplierId);
  if (!supplier) throw AppError.validation('Supplier not found.', { fields: { supplierId: 'Select a valid supplier.' } });
  if (supplier.status !== 'ACTIVE') {
    throw AppError.conflict('SUPPLIER_ARCHIVED', 'Archived suppliers cannot receive new purchases.');
  }
  return supplier;
}

function assertNotFuture(date, field) {
  if (date && date > businessToday()) {
    throw AppError.validation('Date cannot be in the future.', { fields: { [field]: 'Date cannot be in the future.' } });
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function listPurchases(auth, query, fixed = {}) {
  const params = parseListParams(query, { sortable: SORTABLE, defaultSort: 'purchaseDate' });
  const { rows, total } = await repo.list({
    branchIds: resolveBranchScope(auth, query.branchId),
    supplierId: fixed.supplierId || query.supplierId,
    status: query.status,
    paymentStatus: query.paymentStatus,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    search: query.search,
    // Filtering by amount would reveal cost to users who cannot see it.
    minAmount: canViewCost(auth) ? query.minAmount : undefined,
    maxAmount: canViewCost(auth) ? query.maxAmount : undefined,
    ...params,
  });
  return { rows: present(auth, rows.map(toPurchaseDto)), total, page: params.page, limit: params.limit };
}

async function loadPurchase(auth, id, client, options) {
  const purchase = await repo.findById(id, client, options);
  if (!purchase) throw AppError.notFound('Purchase not found.');
  assertBranchAccess(auth, purchase.branch_id);
  return purchase;
}

async function getPurchase(auth, id) {
  const purchase = await loadPurchase(auth, id);
  const [items, receivings, payments] = await Promise.all([
    repo.listItems(id),
    repo.listReceivings(id),
    auth.permissions.has(P.SUPPLIER_PAYMENT_VIEW) ? repo.listPayments(id) : Promise.resolve(null),
  ]);
  const dto = {
    ...toPurchaseDto(purchase),
    items: camelize(items),
    receivings: camelize(receivings),
  };
  if (payments) dto.payments = camelize(payments);
  return present(auth, dto);
}

async function listReceivings(auth, purchaseId) {
  await loadPurchase(auth, purchaseId);
  return present(auth, camelize(await repo.listReceivings(purchaseId)));
}

async function getReceiving(auth, id) {
  const receiving = await repo.findReceiving(id);
  if (!receiving) throw AppError.notFound('Receiving record not found.');
  assertBranchAccess(auth, receiving.branch_id);
  return present(auth, camelize(receiving));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function createPurchase(auth, actor, input) {
  const purchaseDate = input.purchaseDate || businessToday();
  assertNotFuture(purchaseDate, 'purchaseDate');
  if (input.receive && !auth.permissions.has(P.PURCHASE_RECEIVE)) {
    throw AppError.forbidden('PERMISSION_DENIED', 'You do not have permission to receive stock.');
  }
  if (input.payment && !auth.permissions.has(P.SUPPLIER_PAYMENT_CREATE)) {
    throw AppError.forbidden('PERMISSION_DENIED', 'You do not have permission to record supplier payments.');
  }
  const status = input.receive || input.payment ? 'PENDING' : input.status || 'DRAFT';

  const id = await withTransaction(async (client) => {
    const branch = await loadAccessibleBranch(auth, input.branchId, { requireActive: true, client });
    const supplier = await assertActiveSupplier(client, input.supplierId);
    await validateItems(client, input.items);
    const { lines, totals } = calculateTotals(input.items);

    const purchaseNumber = await nextDocumentNumber(client, 'PURCHASE');
    const purchaseId = await repo.insertPurchase(client, {
      purchaseNumber,
      supplierId: supplier.id,
      branchId: branch.id,
      status,
      purchaseDate,
      expectedDate: input.expectedDate,
      notes: input.notes,
      totals,
      userId: auth.userId,
    });
    await repo.insertItems(client, purchaseId, lines);
    await recordAudit(client, actor, {
      action: 'PURCHASE_CREATED',
      entityType: 'PURCHASE',
      entityId: purchaseId,
      branchId: branch.id,
      description: `Purchase ${purchaseNumber} created for ${supplier.company_name}`,
      newValues: { purchaseNumber, status, supplier: supplier.company_name, itemCount: lines.length, ...totals },
    });

    // Optional same-step receiving and payment: all or nothing with the order.
    if (input.receive) {
      const itemIdByMedicine = new Map((await repo.listItems(purchaseId, client)).map((i) => [i.medicine_id, i.id]));
      const receiveItems = input.receive.items.map(({ medicineId, ...line }, index) => {
        const purchaseItemId = itemIdByMedicine.get(medicineId);
        if (!purchaseItemId) {
          throw AppError.validation('Received medicines must be on the order.', { fields: { [`receive.items.${index}.medicineId`]: 'Not on this order.' } });
        }
        return { purchaseItemId, ...line };
      });
      await receiveLines(client, auth, actor, purchaseId, { notes: input.receive.notes, items: receiveItems });
    }
    if (input.payment) {
      await recordPayment(client, auth, actor, { purchaseId, ...input.payment });
    }
    return purchaseId;
  });
  return getPurchase(auth, id);
}

async function updatePurchase(auth, actor, id, input) {
  await withTransaction(async (client) => {
    const purchase = await loadPurchase(auth, id, client, { forUpdate: true });
    if (!['DRAFT', 'PENDING'].includes(purchase.status)) {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'Only draft or pending purchases can be edited.');
    }
    if (input.status === 'DRAFT' && purchase.status === 'PENDING') {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'A pending purchase cannot return to draft.');
    }
    if (input.purchaseDate) assertNotFuture(input.purchaseDate, 'purchaseDate');
    const expected = input.expectedDate !== undefined ? input.expectedDate : purchase.expected_date;
    const date = input.purchaseDate || purchase.purchase_date;
    if (expected && expected < date) {
      throw AppError.validation('Expected date must be on or after the purchase date.', {
        fields: { expectedDate: 'Must be on or after the purchase date.' },
      });
    }
    if (input.supplierId && input.supplierId !== purchase.supplier_id) await assertActiveSupplier(client, input.supplierId);

    const changes = { ...input };
    delete changes.items;
    const previousValues = {};
    const newValues = {};
    for (const key of ['supplierId', 'status', 'purchaseDate', 'expectedDate', 'notes']) {
      if (input[key] !== undefined) {
        previousValues[key] = camelize(purchase)[key] ?? null;
        newValues[key] = input[key];
      }
    }

    if (input.items) {
      await validateItems(client, input.items);
      const { lines, totals } = calculateTotals(input.items);
      if (money(totals.total).lt(purchase.amount_paid)) {
        throw AppError.conflict('TOTAL_BELOW_PAID', 'The new total is less than the amount already paid to the supplier.');
      }
      // Items can be replaced freely: nothing has been received (status DRAFT/PENDING).
      await repo.deleteItems(client, id);
      await repo.insertItems(client, id, lines);
      changes.totals = totals;
      previousValues.total = purchase.total;
      newValues.total = totals.total;
      newValues.itemCount = lines.length;
    }

    await repo.updatePurchase(client, id, changes, auth.userId);
    await recordAudit(client, actor, {
      action: 'PURCHASE_UPDATED',
      entityType: 'PURCHASE',
      entityId: id,
      branchId: purchase.branch_id,
      description: `Purchase ${purchase.purchase_number} updated`,
      previousValues,
      newValues,
    });
  });
  return getPurchase(auth, id);
}

/**
 * Receives stock against a purchase, atomically:
 * lock purchase and items -> validate quantities and batch data ->
 * find/create batches -> lock and update inventory -> stock movements ->
 * receiving records -> purchase status -> audit -> notifications.
 */
async function receivePurchase(auth, actor, id, input, idempotencyKey) {
  const result = await runIdempotent(
    { userId: auth.userId, scope: `purchases.receive:${id}`, key: idempotencyKey, payload: input },
    (client) => receiveLines(client, auth, actor, id, input),
  );
  return { ...result, body: { ...result.body, purchase: await getPurchase(auth, id) } };
}

/** The receiving itself, inside the caller's transaction. */
async function receiveLines(client, auth, actor, id, input) {
  const today = businessToday();
  const purchase = await loadPurchase(auth, id, client, { forUpdate: true });
  if (purchase.status === 'RECEIVED') {
    throw AppError.conflict('PURCHASE_ALREADY_RECEIVED', 'This purchase has already been fully received.');
  }
  if (!['PENDING', 'PARTIALLY_RECEIVED'].includes(purchase.status)) {
    throw AppError.conflict('INVALID_STATUS_TRANSITION', `A ${purchase.status.toLowerCase()} purchase cannot be received.`);
  }
  const branch = await loadAccessibleBranch(auth, purchase.branch_id, { requireActive: true, client });

  const items = await repo.listItems(id, client, { forUpdate: true });
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const receivingNow = new Map();
  const identities = [];

  // Validate every line before touching stock.
  input.items.forEach((line, index) => {
    const item = itemsById.get(line.purchaseItemId);
    const field = (name) => `items.${index}.${name}`;
    if (!item) {
      throw AppError.validation('The item does not belong to this purchase.', { fields: { [field('purchaseItemId')]: 'Unknown item.' } });
    }
    if (item.medicine_status !== 'ACTIVE') {
      throw AppError.conflict('MEDICINE_NOT_ACTIVE', `${item.medicine_name} must be active to receive stock.`, {
        medicineId: item.medicine_id,
      });
    }
    const already = receivingNow.get(item.id) || 0;
    if (already + line.quantity > item.remaining_quantity) {
      throw AppError.conflict('OVER_RECEIVING', `Cannot receive more ${item.medicine_name} than remains on the order.`, {
        purchaseItemId: item.id,
        remaining: item.remaining_quantity - already,
        requested: line.quantity,
      });
    }
    receivingNow.set(item.id, already + line.quantity);
    identities[index] = resolveBatchIdentity(item.product_type, line, field);
    if (line.expiryDate && line.expiryDate < today) {
      throw AppError.conflict('BATCH_EXPIRED', `Batch ${identities[index].batchNumber} is already expired.`, {
        fields: { [field('expiryDate')]: 'Expired stock cannot be received.' },
      });
    }
    if (line.manufacturingDate && line.manufacturingDate > today) {
      throw AppError.validation('Manufacturing date cannot be in the future.', {
        fields: { [field('manufacturingDate')]: 'Cannot be in the future.' },
      });
    }
  });

  const receiving = await repo.insertReceiving(client, {
    purchaseId: id,
    branchId: branch.id,
    userId: auth.userId,
    notes: input.notes,
  });

  const received = [];
  for (const [index, line] of input.items.entries()) {
    const item = itemsById.get(line.purchaseItemId);
    // Cost always comes from the order line; it is not editable on receiving.
    const purchasePrice = item.unit_purchase_price;

    const { batch } = await ledger.findOrCreateBatch(client, {
      medicineId: item.medicine_id,
      batchNumber: identities[index].batchNumber,
      manufacturingDate: line.manufacturingDate,
      expiryDate: identities[index].expiryDate,
      purchasePrice,
      supplierId: purchase.supplier_id,
      userId: auth.userId,
    });
    const { row, created } = await ledger.ensureInventoryRow(client, {
      branchId: branch.id,
      batchId: batch.id,
      sellingPrice: line.sellingPrice,
    });
    if (!created && toMoneyString(row.selling_price) !== toMoneyString(line.sellingPrice)) {
      await inventoryRepo.updateInventoryField(client, row.id, 'selling_price', toMoneyString(line.sellingPrice));
      await recordAudit(client, actor, {
        action: 'SELLING_PRICE_CHANGED',
        entityType: 'INVENTORY',
        entityId: row.id,
        branchId: branch.id,
        description: `Selling price of ${item.medicine_name} batch ${batch.batch_number} changed on receiving ${purchase.purchase_number}`,
        previousValues: { sellingPrice: row.selling_price },
        newValues: { sellingPrice: toMoneyString(line.sellingPrice) },
      });
    }
    await ledger.applyMovement(client, {
      branchId: branch.id,
      batchId: batch.id,
      change: line.quantity,
      movementType: 'PURCHASE_RECEIVED',
      referenceType: 'PURCHASE_RECEIVING',
      referenceId: receiving.id,
      reason: `Received on ${purchase.purchase_number}`,
      userId: auth.userId,
    });
    await repo.insertReceivingItem(client, {
      receivingId: receiving.id,
      purchaseItemId: item.id,
      batchId: batch.id,
      quantity: line.quantity,
      purchasePrice: toMoneyString(purchasePrice),
      sellingPrice: toMoneyString(line.sellingPrice),
      notes: line.notes,
    });
    await repo.incrementReceived(client, item.id, line.quantity);
    received.push({ medicine: item.medicine_name, batchNumber: batch.batch_number, quantity: line.quantity });
  }

  const fullyReceived = items.every((i) => i.remaining_quantity - (receivingNow.get(i.id) || 0) === 0);
  const newStatus = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
  await repo.setStatus(client, id, newStatus, auth.userId);

  await recordAudit(client, actor, {
    action: 'PURCHASE_RECEIVED',
    entityType: 'PURCHASE',
    entityId: id,
    branchId: branch.id,
    description: `${fullyReceived ? 'Fully' : 'Partially'} received ${purchase.purchase_number}`,
    previousValues: { status: purchase.status },
    newValues: { status: newStatus, receivingId: receiving.id, lines: received },
  });

  const recipients = await findBranchRecipients(client, branch.id, P.PURCHASE_VIEW, auth.userId);
  await notifyUsers(client, recipients, {
    type: fullyReceived ? 'PURCHASE_RECEIVED' : 'PURCHASE_PARTIALLY_RECEIVED',
    title: fullyReceived ? 'Purchase received' : 'Purchase partially received',
    message: `${purchase.purchase_number} from ${purchase.supplier_name} was ${fullyReceived ? 'fully' : 'partially'} received at ${branch.name}.`,
    branchId: branch.id,
    entityType: 'PURCHASE',
    entityId: id,
  });

  return { receivingId: receiving.id, purchaseId: id, status: newStatus };
}

async function cancelPurchase(auth, actor, id, reason) {
  await withTransaction(async (client) => {
    const purchase = await loadPurchase(auth, id, client, { forUpdate: true });
    if (!['DRAFT', 'PENDING'].includes(purchase.status)) {
      throw AppError.conflict(
        'INVALID_STATUS_TRANSITION',
        purchase.status === 'CANCELLED'
          ? 'This purchase is already cancelled.'
          : 'Purchases cannot be cancelled after stock has been received.',
      );
    }
    if (money(purchase.amount_paid).gt(0)) {
      throw AppError.conflict('PURCHASE_HAS_PAYMENTS', 'A purchase with recorded payments cannot be cancelled.');
    }
    await repo.cancel(client, id, reason, auth.userId);
    await recordAudit(client, actor, {
      action: 'PURCHASE_CANCELLED',
      entityType: 'PURCHASE',
      entityId: id,
      branchId: purchase.branch_id,
      description: `Purchase ${purchase.purchase_number} cancelled`,
      previousValues: { status: purchase.status },
      newValues: { status: 'CANCELLED', reason },
    });
    const recipients = await findBranchRecipients(client, purchase.branch_id, P.PURCHASE_VIEW, auth.userId);
    await notifyUsers(client, recipients, {
      type: 'PURCHASE_CANCELLED',
      title: 'Purchase cancelled',
      message: `${purchase.purchase_number} from ${purchase.supplier_name} was cancelled.`,
      branchId: purchase.branch_id,
      entityType: 'PURCHASE',
      entityId: id,
    });
  });
  return getPurchase(auth, id);
}

module.exports = {
  calculateTotals,
  listPurchases,
  getPurchase,
  listReceivings,
  getReceiving,
  createPurchase,
  updatePurchase,
  receivePurchase,
  cancelPurchase,
  hideCost,
};
