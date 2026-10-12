const { z, uuid, requiredText, isoDate, money, positiveInt, listQuery } = require('../../validators/common');

const createSaleBody = z.object({
  branchId: uuid,
  items: z.array(z.object({
    medicineId: uuid,
    quantity: positiveInt.max(100000),
    // Optional FEFO override: explicit batches (requires SALES_OVERRIDE_FEFO and a reason).
    batchAllocations: z.array(z.object({ batchId: uuid, quantity: positiveInt })).min(1).max(50).optional(),
    fefoOverrideReason: z.string().trim().max(500).optional(),
    // Ignored if sent: prices always come from branch inventory.
  }).strict()).min(1, 'The cart is empty.').max(200),
  discount: z.object({
    type: z.enum(['PERCENTAGE', 'FIXED']),
    value: money,
  }).strict().nullable().optional(),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER']),
  amountPaid: money,
}).strict();

const voidSaleBody = z.object({ reason: requiredText(500) }).strict();

const listSalesQuery = listQuery.extend({
  branchId: uuid.optional(),
  staffId: uuid.optional(),
  medicineId: uuid.optional(),
  categoryId: uuid.optional(),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER']).optional(),
  status: z.enum(['COMPLETED', 'VOIDED']).optional(),
  receiptNumber: z.string().trim().max(40).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  minAmount: money.optional(),
  maxAmount: money.optional(),
});

module.exports = { createSaleBody, voidSaleBody, listSalesQuery };
