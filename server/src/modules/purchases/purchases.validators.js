const { z, uuid, requiredText, optionalText, isoDate, money, positiveMoney, positiveInt, listQuery } = require('../../validators/common');

const itemSchema = z.object({
  medicineId: uuid,
  orderedQuantity: positiveInt.max(10000000),
  unitPurchasePrice: money,
  discount: money.optional(),
  tax: money.optional(),
  notes: optionalText(500),
}).strict();

const receiveLineFields = {
  // Required for medicines; optional for cosmetics (checked when receiving).
  batchNumber: optionalText(60),
  manufacturingDate: isoDate.nullable().optional(),
  expiryDate: isoDate.nullable().optional(),
  quantity: positiveInt.max(10000000),
  sellingPrice: money,
  notes: optionalText(500),
};
const datesInOrder = [(v) => !v.manufacturingDate || !v.expiryDate || v.manufacturingDate <= v.expiryDate, {
  message: 'Manufacturing date must be on or before the expiry date.',
  path: ['manufacturingDate'],
}];

// Optional extras when creating a purchase: receive some or all stock and/or
// record a payment in the same step. Lines refer to order items by medicine.
const initialReceiving = z.object({
  notes: optionalText(1000),
  items: z.array(z.object({ medicineId: uuid, ...receiveLineFields }).strict().refine(...datesInOrder))
    .min(1, 'Receive at least one line.').max(500),
}).strict();

const initialPayment = z.object({
  amount: positiveMoney,
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']),
  referenceNumber: optionalText(100),
  notes: optionalText(1000),
  paidAt: z.string().datetime({ offset: true }).optional(),
}).strict();

const createPurchaseBody = z.object({
  supplierId: uuid,
  branchId: uuid,
  status: z.enum(['DRAFT', 'PENDING']).optional(),
  purchaseDate: isoDate.optional(),
  expectedDate: isoDate.nullable().optional(),
  notes: optionalText(2000),
  items: z.array(itemSchema).min(1, 'Add at least one item.').max(200),
  receive: initialReceiving.optional(),
  payment: initialPayment.optional(),
}).strict().refine((v) => !v.expectedDate || !v.purchaseDate || v.expectedDate >= v.purchaseDate, {
  message: 'Expected date must be on or after the purchase date.',
  path: ['expectedDate'],
}).refine((v) => !(v.receive || v.payment) || v.status !== 'DRAFT', {
  message: 'Drafts cannot be received or paid. Submit the order instead.',
  path: ['status'],
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
  items: z.array(z.object({ purchaseItemId: uuid, ...receiveLineFields }).strict().refine(...datesInOrder))
    .min(1, 'Receive at least one line.').max(500),
}).strict();

const cancelBody = z.object({ reason: requiredText(500) }).strict();

const listPurchasesQuery = listQuery.extend({
  branchId: uuid.optional(),
  supplierId: uuid.optional(),
  status: z.enum(['DRAFT', 'PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  minAmount: money.optional(),
  maxAmount: money.optional(),
});

module.exports = { createPurchaseBody, updatePurchaseBody, receiveBody, cancelBody, listPurchasesQuery };
