const { z, uuid, optionalText, positiveMoney, isoDate, listQuery } = require('../../validators/common');

const createPaymentBody = z.object({
  purchaseId: uuid,
  amount: positiveMoney,
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']),
  referenceNumber: optionalText(100),
  notes: optionalText(1000),
  paidAt: z.string().datetime({ offset: true }).optional(),
}).strict();

const listPaymentsQuery = listQuery.extend({
  branchId: uuid.optional(),
  supplierId: uuid.optional(),
  purchaseId: uuid.optional(),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

module.exports = { createPaymentBody, listPaymentsQuery };
