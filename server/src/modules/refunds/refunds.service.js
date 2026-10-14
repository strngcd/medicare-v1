const AppError = require('../../errors/AppError');
const config = require('../../config');
const { recordAudit } = require('../audit/audit.recorder');
const { runIdempotent } = require('../idempotency/idempotency');
const { nextDocumentNumber } = require('../documents/documentNumbers');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { round2, sum, toMoneyString } = require('../../utils/money');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { resolveBranchScope, assertBranchAccess, loadAccessibleBranch } = require('../../permissions/branchAccess');
const ledger = require('../inventory/inventory.ledger');
const salesRepo = require('../sales/sales.repository');
const { refundAmount } = require('../sales/salePricing');
const repo = require('./refunds.repository');

const SORTABLE = { createdAt: 'r.created_at', refundTotal: 'r.refund_total', refundNumber: 'r.refund_number' };

function toDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  delete dto.soldBy;
  return dto;
}

function assertCanSeeRefund(auth, refund) {
  assertBranchAccess(auth, refund.branch_id);
  if (auth.permissions.has(P.SALES_VIEW_HISTORY) || auth.permissions.has(P.SALES_PROCESS_REFUND)) return;
  if (auth.permissions.has(P.SALES_VIEW) && refund.sold_by === auth.userId) return;
  throw AppError.notFound('Refund not found.');
}

function refundFilters(auth, query) {
  return {
    branchIds: resolveBranchScope(auth, query.branchId),
    saleId: query.saleId,
    processedBy: query.staffId,
    reason: query.reason,
    search: query.search,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    minAmount: query.minAmount,
    maxAmount: query.maxAmount,
    timezone: config.businessTimezone,
  };
}

async function listRefunds(auth, query, { exportLimit } = {}) {
  const params = parseListParams(query, { sortable: SORTABLE, defaultSort: 'createdAt', exportLimit });
  const { rows, total } = await repo.list({ ...refundFilters(auth, query), ...params });
  return { rows: rows.map(toDto), total, page: params.page, limit: params.limit };
}

async function refundSummary(auth, query) {
  return camelize(await repo.summary(refundFilters(auth, query)));
}

async function getRefund(auth, id) {
  const refund = await repo.findById(id);
  if (!refund) throw AppError.notFound('Refund not found.');
  assertCanSeeRefund(auth, refund);
  return toDto(refund);
}

/**
 * Returns `quantity` units to the original batches of a sale item, taking
 * from batches that still have unrefunded units, in allocation order.
 */
function planBatchReturn(allocations, quantity) {
  const plan = [];
  let remaining = quantity;
  for (const allocation of allocations) {
    if (remaining === 0) break;
    const available = allocation.quantity - allocation.refunded;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    plan.push({ batchId: allocation.batchId, quantity: take });
    remaining -= take;
  }
  if (remaining > 0) throw new Error('Refund batch provenance is inconsistent');
  return plan;
}

/**
 * Processes a (partial or full) refund atomically. The sale row lock
 * serializes refunds and voids of the same sale.
 */
async function createRefund(auth, actor, input, idempotencyKey) {
  const ids = input.items.map((i) => i.saleItemId);
  if (new Set(ids).size !== ids.length) {
    throw AppError.validation('Each sale item can appear only once.', { fields: { items: 'Duplicate sale item.' } });
  }

  const result = await runIdempotent(
    { userId: auth.userId, scope: 'refunds.create', key: idempotencyKey, payload: input },
    async (client) => {
      const sale = await salesRepo.findById(input.saleId, client, { forUpdate: true });
      if (!sale) throw AppError.notFound('Sale not found.');
      assertBranchAccess(auth, sale.branch_id);
      if (sale.status === 'VOIDED') {
        throw AppError.conflict('SALE_NOT_REFUNDABLE', 'A voided sale cannot be refunded.');
      }
      await loadAccessibleBranch(auth, sale.branch_id, { requireActive: true, client });

      const saleItems = await repo.loadRefundableItems(client, sale.id);
      const itemsById = new Map(saleItems.map((i) => [i.id, i]));

      const lines = input.items.map((line, index) => {
        const item = itemsById.get(line.saleItemId);
        if (!item) {
          throw AppError.validation('The item does not belong to this sale.', { fields: { [`items.${index}.saleItemId`]: 'Unknown item.' } });
        }
        const remaining = item.quantity - item.refunded_quantity;
        if (line.quantity > remaining) {
          throw AppError.conflict('REFUND_EXCEEDS_REMAINING', `Only ${remaining} unit(s) of ${item.medicine_name} can still be refunded.`, {
            saleItemId: item.id,
            remaining,
            requested: line.quantity,
          });
        }
        const amount = refundAmount({
          lineTotal: item.line_total,
          soldQuantity: item.quantity,
          previouslyRefunded: item.refunded_quantity,
          quantity: line.quantity,
        });
        return {
          item,
          saleItemId: item.id,
          quantity: line.quantity,
          refundAmount: toMoneyString(amount),
          refundUnitPrice: toMoneyString(round2(amount.dividedBy(line.quantity))),
          batches: planBatchReturn(item.allocations, line.quantity),
        };
      });

      const refundTotal = toMoneyString(sum(lines.map((l) => l.refundAmount)));
      const refundNumber = await nextDocumentNumber(client, 'REFUND');
      const refund = await repo.insertRefund(client, {
        refundNumber,
        saleId: sale.id,
        branchId: sale.branch_id,
        refundTotal,
        // V1 rule: the refund is paid with the original sale's payment method.
        paymentMethod: sale.payment_method,
        reason: input.reason,
        notes: input.notes,
        userId: auth.userId,
      });

      for (const line of lines) {
        const refundItemId = await repo.insertRefundItem(client, refund.id, line);
        for (const part of line.batches) {
          await repo.insertRefundAllocation(client, refundItemId, part.batchId, part.quantity);
          await ledger.applyMovement(client, {
            branchId: sale.branch_id,
            batchId: part.batchId,
            change: part.quantity,
            movementType: 'REFUND',
            referenceType: 'REFUND',
            referenceId: refund.id,
            reason: `${refundNumber} for ${sale.receipt_number} (${input.reason})`,
            userId: auth.userId,
          });
        }
      }

      await recordAudit(client, actor, {
        action: 'REFUND_CREATED',
        entityType: 'REFUND',
        entityId: refund.id,
        branchId: sale.branch_id,
        description: `Refund ${refundNumber} of ${refundTotal} for sale ${sale.receipt_number}`,
        newValues: {
          refundNumber,
          saleId: sale.id,
          refundTotal,
          paymentMethod: sale.payment_method,
          reason: input.reason,
          lines: lines.map((l) => ({ medicine: l.item.medicine_name, quantity: l.quantity, amount: l.refundAmount })),
        },
      });
      return { id: refund.id };
    },
  );

  return { ...result, body: await getRefund(auth, result.body.id) };
}

module.exports = { listRefunds, refundSummary, getRefund, createRefund, planBatchReturn };
