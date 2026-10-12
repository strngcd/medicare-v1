const { z, uuid, requiredText, optionalText, isoDate, money, positiveInt, listQuery } = require('../../validators/common');

const itemSchema = z.object({
  medicineId: uuid,
  orderedQuantity: positiveInt.max(10000000),
  unitPurchasePrice: money,
  discount: money.optional(),
  tax: money.optional(),
  notes: optionalText(500),
}).strict();

const createPurchaseBody = z.object({
  supplierId: uuid,
  branchId: uuid,
  status: z.enum(['DRAFT', 'PENDING']).optional(),
  purchaseDate: isoDate.optional(),
  expectedDate: isoDate.nullable().optional(),
  notes: optionalText(2000),
  items: z.array(itemSchema).min(1, 'Add at least one item.').max(200),
}).strict().refine((v) => !v.expectedDate || !v.purchaseDate || v.expectedDate >= v.purchaseDate, {
  message: 'Expected date must be on or after the purchase date.',
  path: ['expectedDate'],
});

const updatePurchaseBody = z.object({
  supplierId: uuid.optional(),
  status: z.enum(['DRAFT', 'PENDING']).optional(),
  purchaseDate: isoDate.optional(),
  expectedDate: isoDate.nullable().optional(),
  notes: optionalText(2000),
  items: z.array(itemSchema).min(1).max(200).optional(),
}).strict();

const receiveBody = z.object({
  notes: optionalText(1000),
  items: z.array(z.object({
    purchaseItemId: uuid,
    batchNumber: requiredText(60),
    manufacturingDate: isoDate.nullable().optional(),
    expiryDate: isoDate,
    quantity: positiveInt.max(10000000),
    purchasePrice: money.optional(),
    sellingPrice: money,
    notes: optionalText(500),
  }).strict().refine((v) => !v.manufacturingDate || v.manufacturingDate <= v.expiryDate, {
    message: 'Manufacturing date must be on or before the expiry date.',
    path: ['manufacturingDate'],
  })).min(1, 'Receive at least one line.').max(500),
}).strict();

const cancelBody = z.object({ reason: requiredText(500) }).strict();

const listPurchasesQuery = listQuery.extend({
  branchId: uuid.optional(),
  supplierId: uuid.optional(),
  status: z.enum(['DRAFT', 'PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

module.exports = { createPurchaseBody, updatePurchaseBody, receiveBody, cancelBody, listPurchasesQuery };
