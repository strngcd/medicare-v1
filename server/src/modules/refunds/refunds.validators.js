const { z, uuid, optionalText, isoDate, positiveInt, listQuery } = require('../../validators/common');

const REASONS = ['CUSTOMER_RETURN', 'DAMAGED_PRODUCT', 'WRONG_ITEM', 'WRONG_QUANTITY', 'DUPLICATE_SALE', 'OTHER'];

const createRefundBody = z.object({
  saleId: uuid,
  reason: z.enum(REASONS),
  notes: optionalText(1000),
  items: z.array(z.object({ saleItemId: uuid, quantity: positiveInt }).strict()).min(1, 'Select at least one item.').max(200),
}).strict().refine((v) => v.reason !== 'OTHER' || (v.notes && v.notes.trim().length > 0), {
  message: 'A note is required when the reason is "Other".',
  path: ['notes'],
});

const listRefundsQuery = listQuery.extend({
  branchId: uuid.optional(),
  saleId: uuid.optional(),
  staffId: uuid.optional(),
  reason: z.enum(REASONS).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

module.exports = { createRefundBody, listRefundsQuery };
