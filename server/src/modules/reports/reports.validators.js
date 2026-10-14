const { z, uuid, isoDate, money, listQuery } = require('../../validators/common');
const { listRefundsQuery } = require('../refunds/refunds.validators');

const productType = z.enum(['MEDICINE', 'COSMETIC']);

const range = {
  range: z.enum(['TODAY', 'WEEK', 'MONTH', 'YEAR', 'CUSTOM']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  branchId: uuid.optional(),
};

const salesReportQuery = listQuery.extend({
  ...range,
  staffId: uuid.optional(),
  medicineId: uuid.optional(),
  categoryId: uuid.optional(),
  productType: productType.optional(),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER']).optional(),
  status: z.enum(['COMPLETED', 'VOIDED']).optional(),
  receiptNumber: z.string().trim().max(40).optional(),
  minAmount: money.optional(),
  maxAmount: money.optional(),
});

const inventoryReportQuery = listQuery.extend({
  branchId: uuid.optional(),
  categoryId: uuid.optional(),
  productType: productType.optional(),
  status: z.enum(['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING_SOON']).optional(),
});

const movementReportQuery = listQuery.extend({
  ...range,
  medicineId: uuid.optional(),
  batchId: uuid.optional(),
  movementType: z.string().max(40).optional(),
});

const lossReportQuery = listQuery.extend({
  ...range,
  movementType: z.enum(['EXPIRED', 'DAMAGED', 'LOST', 'DISPOSED']).optional(),
});

const refundReportQuery = listRefundsQuery.extend({ range: range.range });

const purchaseReportQuery = listQuery.extend({
  ...range,
  supplierId: uuid.optional(),
  status: z.enum(['DRAFT', 'PENDING', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']).optional(),
});

const supplierReportQuery = listQuery.extend({ ...range });

const exportFormat = { format: z.enum(['csv', 'pdf']).default('csv') };

const analyticsQuery = z.object({
  ...range,
  by: z.enum(['quantity', 'revenue']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

module.exports = {
  salesReportQuery,
  inventoryReportQuery,
  movementReportQuery,
  lossReportQuery,
  refundReportQuery,
  purchaseReportQuery,
  supplierReportQuery,
  exportFormat,
  analyticsQuery,
};
