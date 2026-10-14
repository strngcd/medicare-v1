const AppError = require('../../errors/AppError');
const config = require('../../config');
const { recordAudit } = require('../audit/audit.recorder');
const { runIdempotent } = require('../idempotency/idempotency');
const { nextDocumentNumber } = require('../documents/documentNumbers');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { money, toMoneyString } = require('../../utils/money');
const { businessToday } = require('../../utils/time');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { resolveBranchScope, assertBranchAccess, loadAccessibleBranch } = require('../../permissions/branchAccess');
const { filterFinancialFields } = require('../../permissions/financialVisibility');
const ledger = require('../inventory/inventory.ledger');
const { allocateFefo, validateManualAllocation } = require('../inventory/fefo');
const { priceSale } = require('./salePricing');
const repo = require('./sales.repository');

const SORTABLE = {
  completedAt: 's.completed_at',
  total: 's.total',
  receiptNumber: 's.receipt_number',
  status: 's.status',
};

function toSaleDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  return dto;
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * SALES_VIEW_HISTORY: any sale in an accessible branch.
 * SALES_VIEW only: the user's own sales.
 */
function assertCanSeeSale(auth, sale) {
  assertBranchAccess(auth, sale.branch_id);
  if (auth.permissions.has(P.SALES_VIEW_HISTORY)) return;
  if (auth.permissions.has(P.SALES_VIEW) && sale.sold_by === auth.userId) return;
  throw AppError.notFound('Sale not found.');
}

/** SALES_VOID covers every sale; SALES_VOID_OWN only the user's own. */
function mayVoid(auth, sale) {
  if (auth.permissions.has(P.SALES_VOID)) return true;
  return auth.permissions.has(P.SALES_VOID_OWN) && sale.sold_by === auth.userId;
}

async function loadVisibleSale(auth, id) {
  const sale = await repo.findById(id);
  if (!sale) throw AppError.notFound('Sale not found.');
  assertCanSeeSale(auth, sale);
  return sale;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function listSales(auth, query, { ownOnly = false, exportLimit } = {}) {
  const params = parseListParams(query, { sortable: SORTABLE, defaultSort: 'completedAt', exportLimit });
  const { rows, total } = await repo.list({
    branchIds: resolveBranchScope(auth, query.branchId),
    soldBy: ownOnly ? auth.userId : query.staffId,
    status: query.status,
    receiptNumber: query.receiptNumber,
    minAmount: query.minAmount,
    maxAmount: query.maxAmount,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    paymentMethod: query.paymentMethod,
    medicineId: query.medicineId,
    categoryId: query.categoryId,
    timezone: config.businessTimezone,
    ...params,
  });
  return { rows: rows.map(toSaleDto), total, page: params.page, limit: params.limit };
}

async function getSale(auth, id) {
  const sale = await loadVisibleSale(auth, id);
  const [items, refunds, cogs] = await Promise.all([repo.listItems(id), repo.listRefunds(id), repo.costOfSale(id)]);
  const dto = {
    ...toSaleDto(sale),
    items: camelize(items).map((item) => ({
      ...item,
      refundableQuantity: sale.status === 'COMPLETED' ? item.quantity - item.refundedQuantity : 0,
    })),
    refunds: camelize(refunds),
    canVoid: sale.status === 'COMPLETED' && refunds.length === 0 && mayVoid(auth, sale),
    cogs,
    grossProfit: toMoneyString(money(sale.total).minus(sale.tax).minus(cogs)),
  };
  return filterFinancialFields(dto, auth);
}

/** Receipt data from the historical sale record plus current branding. */
async function getReceipt(auth, id) {
  const sale = await loadVisibleSale(auth, id);
  const [items, context] = await Promise.all([repo.listItems(id), repo.receiptContext(sale.branch_id)]);
  const ctx = camelize(context);
  return {
    pharmacy: {
      name: ctx.pharmacyName,
      logoUrl: ctx.logoUrl,
      phone: ctx.pharmacyPhone,
      email: ctx.pharmacyEmail,
      address: ctx.pharmacyAddress,
      city: ctx.pharmacyCity,
      country: ctx.pharmacyCountry,
      website: ctx.website,
      currencyCode: ctx.currencyCode,
    },
    branch: {
      name: ctx.branchName,
      code: ctx.branchCode,
      address: ctx.showBranchAddress ? [ctx.branchAddress, ctx.branchCity].filter(Boolean).join(', ') || null : null,
      phone: ctx.showBranchPhone ? ctx.branchPhone : null,
    },
    receiptNumber: sale.receipt_number,
    status: sale.status,
    completedAt: sale.completed_at,
    voidedAt: sale.voided_at,
    staff: ctx.showStaff ? sale.sold_by_name : null,
    paymentMethod: sale.payment_method,
    items: items.map((i) => ({
      medicineName: i.medicine_name,
      quantity: i.quantity,
      unitSellingPrice: i.unit_selling_price,
      lineTotal: i.line_total,
    })),
    subtotal: sale.subtotal,
    discount: ctx.showDiscount ? sale.discount : null,
    tax: ctx.showTax ? sale.tax : null,
    taxName: ctx.showTax ? sale.tax_name : null,
    taxRate: ctx.showTax ? sale.tax_rate : null,
    taxMode: sale.tax_mode,
    total: sale.total,
    footer: ctx.receiptFooter,
  };
}

// ---------------------------------------------------------------------------
// Create sale
// ---------------------------------------------------------------------------

function assertSaleRequestAllowed(auth, input) {
  const ids = input.items.map((i) => i.medicineId);
  if (new Set(ids).size !== ids.length) {
    throw AppError.validation('Each medicine can appear only once in the cart.', { fields: { items: 'Duplicate medicine.' } });
  }
  if (input.discount && money(input.discount.value).gt(0) && !auth.permissions.has(P.SALES_APPLY_DISCOUNT)) {
    throw AppError.forbidden('PERMISSION_DENIED', 'You do not have permission to apply discounts.');
  }
  for (const item of input.items) {
    if (item.batchAllocations) {
      if (!auth.permissions.has(P.SALES_OVERRIDE_FEFO)) {
        throw AppError.forbidden('PERMISSION_DENIED', 'You do not have permission to override FEFO batch selection.');
      }
      if (!item.fefoOverrideReason || !item.fefoOverrideReason.trim()) {
        throw AppError.validation('A reason is required to override FEFO.', { fields: { fefoOverrideReason: 'Required.' } });
      }
    }
  }
}

/**
 * Splits a medicine's batch allocation into sale lines by selling price,
 * because each sale line carries exactly one authoritative unit price.
 */
function splitByPrice(medicine, allocation, batchesById) {
  const groups = new Map();
  for (const part of allocation) {
    const batch = batchesById.get(part.batchId);
    const price = toMoneyString(batch.sellingPrice);
    if (!groups.has(price)) groups.set(price, { unitPrice: price, quantity: 0, allocations: [] });
    const group = groups.get(price);
    group.quantity += part.quantity;
    group.allocations.push({ batchId: part.batchId, quantity: part.quantity, purchasePrice: batch.purchasePrice });
  }
  return [...groups.values()].map((g) => ({ ...g, medicineId: medicine.id, medicineName: medicine.name }));
}

/**
 * The authoritative sale transaction. Prices, FEFO allocation, discount,
 * tax and totals are all recalculated here; client values are never trusted.
 */
async function createSale(auth, actor, input, idempotencyKey) {
  assertSaleRequestAllowed(auth, input);
  const today = businessToday();

  const result = await runIdempotent(
    { userId: auth.userId, scope: 'sales.create', key: idempotencyKey, payload: input },
    async (client) => {
      const branch = await loadAccessibleBranch(auth, input.branchId, { requireActive: true, client });

      const medicines = await repo.findMedicines(client, input.items.map((i) => i.medicineId));
      const medicinesById = new Map(medicines.map((m) => [m.id, m]));
      for (const item of input.items) {
        const medicine = medicinesById.get(item.medicineId);
        if (!medicine) throw AppError.notFound('Medicine not found.');
        if (medicine.status === 'ARCHIVED') {
          throw AppError.conflict('MEDICINE_ARCHIVED', `${medicine.name} is archived and cannot be sold.`, { medicineId: medicine.id });
        }
        if (medicine.status !== 'ACTIVE') {
          throw AppError.conflict('MEDICINE_NOT_ACTIVE', `${medicine.name} is not active and cannot be sold.`, { medicineId: medicine.id });
        }
      }

      // Lock inventory in a stable order (by medicine id) to avoid deadlocks.
      const ordered = [...input.items].sort((a, b) => (a.medicineId < b.medicineId ? -1 : 1));
      const saleLines = [];
      const overrides = [];
      for (const item of ordered) {
        const medicine = medicinesById.get(item.medicineId);
        const batches = await ledger.lockSellableBatches(client, { branchId: branch.id, medicineId: medicine.id, today });
        const batchesById = new Map(batches.map((b) => [b.batchId, b]));

        let allocation;
        try {
          if (item.batchAllocations) {
            allocation = validateManualAllocation(batches, item.batchAllocations, item.quantity);
          } else {
            allocation = allocateFefo(batches, item.quantity);
          }
        } catch (err) {
          if (err.code === 'INSUFFICIENT_STOCK') err.details = { ...err.details, medicineId: medicine.id, medicineName: medicine.name };
          throw err;
        }

        if (item.batchAllocations) {
          let recommended;
          try {
            recommended = allocateFefo(batches, item.quantity);
          } catch {
            recommended = [];
          }
          overrides.push({ medicine, recommended, actual: allocation, reason: item.fefoOverrideReason.trim() });
        }
        saleLines.push(...splitByPrice(medicine, allocation, batchesById));
      }

      const tax = await repo.getTaxSettings(client);
      const priced = priceSale(
        saleLines.map((l) => ({ ...l, unitPrice: l.unitPrice })),
        input.discount && money(input.discount.value).gt(0) ? input.discount : null,
        { enabled: tax.tax_enabled, rate: tax.tax_rate, mode: tax.tax_mode },
      );

      // V1: exact payment in a single method.
      if (!money(input.amountPaid).eq(priced.total)) {
        throw AppError.conflict('INVALID_PAYMENT_AMOUNT', 'The payment must equal the sale total.', {
          total: priced.total,
          amountPaid: toMoneyString(input.amountPaid),
        });
      }

      const receiptNumber = await nextDocumentNumber(client, 'SALE');
      const sale = await repo.insertSale(client, {
        receiptNumber,
        branchId: branch.id,
        userId: auth.userId,
        discountType: input.discount && money(input.discount.value).gt(0) ? input.discount.type : null,
        discountValue: input.discount && money(input.discount.value).gt(0) ? toMoneyString(input.discount.value) : null,
        taxName: tax.tax_enabled ? tax.tax_name : null,
        taxRate: priced.taxRate,
        taxMode: tax.tax_mode,
        subtotal: priced.subtotal,
        discount: priced.discount,
        tax: priced.tax,
        total: priced.total,
      });

      const saleItemIdByMedicine = new Map();
      for (const line of priced.lines) {
        const saleItemId = await repo.insertSaleItem(client, sale.id, line);
        if (!saleItemIdByMedicine.has(line.medicineId)) saleItemIdByMedicine.set(line.medicineId, saleItemId);
        for (const allocation of line.allocations) {
          await repo.insertAllocation(client, saleItemId, allocation);
          await ledger.applyMovement(client, {
            branchId: branch.id,
            batchId: allocation.batchId,
            change: -allocation.quantity,
            movementType: 'SALE',
            referenceType: 'SALE',
            referenceId: sale.id,
            reason: `Sold on ${receiptNumber}`,
            userId: auth.userId,
          });
        }
      }
      await repo.insertPayment(client, sale.id, input.paymentMethod, priced.total);

      for (const override of overrides) {
        await repo.insertFefoOverride(client, {
          saleId: sale.id,
          saleItemId: saleItemIdByMedicine.get(override.medicine.id),
          branchId: branch.id,
          medicineId: override.medicine.id,
          userId: auth.userId,
          recommended: override.recommended,
          actual: override.actual,
          reason: override.reason,
        });
      }

      await recordAudit(client, actor, {
        action: 'SALE_COMPLETED',
        entityType: 'SALE',
        entityId: sale.id,
        branchId: branch.id,
        description: `Sale ${receiptNumber} completed (${priced.total})`,
        newValues: {
          receiptNumber,
          subtotal: priced.subtotal,
          discount: priced.discount,
          tax: priced.tax,
          total: priced.total,
          paymentMethod: input.paymentMethod,
          lines: priced.lines.map((l) => ({ medicine: l.medicineName, quantity: l.quantity, unitPrice: l.unitPrice })),
          fefoOverrides: overrides.length,
        },
      });

      return { id: sale.id, receiptNumber };
    },
  );

  return { ...result, body: await getSale(auth, result.body.id) };
}

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

/**
 * COMPLETED -> VOIDED. Restores the exact original batch allocations.
 * A sale with any refund cannot be voided (prevents double restoration).
 */
async function voidSale(auth, actor, id, reason, idempotencyKey) {
  const result = await runIdempotent(
    { userId: auth.userId, scope: `sales.void:${id}`, key: idempotencyKey, payload: { reason }, successStatus: 200 },
    async (client) => {
      const sale = await repo.findById(id, client, { forUpdate: true });
      if (!sale) throw AppError.notFound('Sale not found.');
      assertBranchAccess(auth, sale.branch_id);
      if (!mayVoid(auth, sale)) throw AppError.forbidden('SALE_NOT_OWN', 'You can only void sales you made yourself.');
      if (sale.status === 'VOIDED') throw AppError.conflict('SALE_ALREADY_VOIDED', 'This sale has already been voided.');
      if ((await repo.countRefunds(client, id)) > 0) {
        throw AppError.conflict('SALE_HAS_REFUNDS', 'A sale with refunds cannot be voided.');
      }
      await loadAccessibleBranch(auth, sale.branch_id, { requireActive: true, client });

      const allocations = await repo.listAllocationsForSale(client, id);
      for (const allocation of allocations) {
        await ledger.applyMovement(client, {
          branchId: sale.branch_id,
          batchId: allocation.batch_id,
          change: allocation.quantity,
          movementType: 'CORRECTION',
          referenceType: 'SALE_VOID',
          referenceId: id,
          reason: `Void of ${sale.receipt_number}: ${reason}`,
          userId: auth.userId,
        });
      }
      await repo.markVoided(client, id, auth.userId, reason);
      await recordAudit(client, actor, {
        action: 'SALE_VOIDED',
        entityType: 'SALE',
        entityId: id,
        branchId: sale.branch_id,
        description: `Sale ${sale.receipt_number} voided`,
        previousValues: { status: 'COMPLETED' },
        newValues: { status: 'VOIDED', reason, restoredUnits: allocations.reduce((n, a) => n + a.quantity, 0) },
      });
      return { id };
    },
  );
  return { ...result, body: await getSale(auth, result.body.id) };
}

module.exports = { listSales, getSale, getReceipt, createSale, voidSale, assertCanSeeSale };
