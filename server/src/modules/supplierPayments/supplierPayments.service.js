const AppError = require('../../errors/AppError');
const config = require('../../config');
const { recordAudit } = require('../audit/audit.recorder');
const { runIdempotent } = require('../idempotency/idempotency');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { money, toMoneyString } = require('../../utils/money');
const { resolveBranchScope, assertBranchAccess } = require('../../permissions/branchAccess');
const supplierRepo = require('../suppliers/suppliers.repository');
const repo = require('./supplierPayments.repository');

const SORTABLE = { paidAt: 'sp.paid_at', amount: 'sp.amount', createdAt: 'sp.created_at' };

function toDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  return dto;
}

async function listPayments(auth, query) {
  const params = parseListParams(query, { sortable: SORTABLE, defaultSort: 'paidAt' });
  const { rows, total } = await repo.list({
    branchIds: resolveBranchScope(auth, query.branchId),
    supplierId: query.supplierId,
    purchaseId: query.purchaseId,
    paymentMethod: query.paymentMethod,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    timezone: config.businessTimezone,
    ...params,
  });
  return { rows: rows.map(toDto), total, page: params.page, limit: params.limit };
}

async function getPayment(auth, id) {
  const payment = await repo.findById(id);
  if (!payment) throw AppError.notFound('Supplier payment not found.');
  assertBranchAccess(auth, payment.branch_id);
  return toDto(payment);
}

/**
 * Records a payment against a purchase. The purchase row is locked so that
 * concurrent payments cannot together exceed the purchase total.
 */
async function createPayment(auth, actor, input, idempotencyKey) {
  const result = await runIdempotent(
    { userId: auth.userId, scope: 'supplier-payments', key: idempotencyKey, payload: input },
    (client) => recordPayment(client, auth, actor, input),
  );
  return { ...result, body: await getPayment(auth, result.body.id) };
}

/** The payment itself, inside the caller's transaction. Returns { id }. */
async function recordPayment(client, auth, actor, input) {
  if (input.paidAt && new Date(input.paidAt) > new Date()) {
    throw AppError.validation('Payment date cannot be in the future.', { fields: { paidAt: 'Cannot be in the future.' } });
  }
  const purchase = await repo.lockPurchaseForPayment(client, input.purchaseId);
  if (!purchase) throw AppError.notFound('Purchase not found.');
  assertBranchAccess(auth, purchase.branch_id);
  if (['DRAFT', 'CANCELLED'].includes(purchase.status)) {
    throw AppError.conflict('PURCHASE_NOT_PAYABLE', `A ${purchase.status.toLowerCase()} purchase cannot be paid.`);
  }

  const remaining = money(purchase.total).minus(purchase.amount_paid);
  if (money(input.amount).gt(remaining)) {
    throw AppError.conflict('OVERPAYMENT_NOT_ALLOWED', 'The payment exceeds the remaining balance of this purchase.', {
      remaining: toMoneyString(remaining),
      requested: toMoneyString(input.amount),
    });
  }

  const paymentId = await repo.insert(client, {
    ...input,
    amount: toMoneyString(input.amount),
    supplierId: purchase.supplier_id,
    branchId: purchase.branch_id,
    userId: auth.userId,
  });
  const newRemaining = remaining.minus(input.amount);
  await recordAudit(client, actor, {
    action: 'SUPPLIER_PAYMENT_CREATED',
    entityType: 'SUPPLIER_PAYMENT',
    entityId: paymentId,
    branchId: purchase.branch_id,
    description: `Payment of ${toMoneyString(input.amount)} recorded for ${purchase.purchase_number}`,
    previousValues: { amountPaid: toMoneyString(purchase.amount_paid) },
    newValues: {
      amount: toMoneyString(input.amount),
      paymentMethod: input.paymentMethod,
      amountPaid: toMoneyString(money(purchase.amount_paid).plus(input.amount)),
      remaining: toMoneyString(newRemaining),
    },
  });
  return { id: paymentId };
}

async function supplierBalance(auth, supplierId) {
  const supplier = await supplierRepo.findById(supplierId);
  if (!supplier) throw AppError.notFound('Supplier not found.');
  const balance = await repo.supplierBalance(supplierId, resolveBranchScope(auth, null));
  return { supplierId, companyName: supplier.company_name, ...camelize(balance) };
}

module.exports = { listPayments, getPayment, createPayment, recordPayment, supplierBalance };
