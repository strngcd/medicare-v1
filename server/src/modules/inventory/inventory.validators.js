const { z, uuid, requiredText, optionalText, isoDate, money, positiveInt, nonNegativeInt, listQuery, queryBoolean } = require('../../validators/common');

const INVENTORY_STATUSES = ['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'EXPIRING_SOON', 'EXPIRED'];
const MOVEMENT_TYPES = [
  'PURCHASE_RECEIVED', 'SALE', 'REFUND', 'ADJUSTMENT', 'TRANSFER_OUT',
  'TRANSFER_IN', 'EXPIRED', 'DAMAGED', 'LOST', 'CORRECTION', 'DISPOSED',
];

const listInventoryQuery = listQuery.extend({
  branchId: uuid.optional(),
  medicineId: uuid.optional(),
  categoryId: uuid.optional(),
  status: z.enum(INVENTORY_STATUSES).optional(),
  archived: queryBoolean.optional(),
});

const branchScopedQuery = listQuery.extend({ branchId: uuid.optional() });

const listBatchesQuery = listQuery.extend({
  branchId: uuid.optional(),
  medicineId: uuid.optional(),
  supplierId: uuid.optional(),
  expired: queryBoolean.optional(),
});

const listMovementsQuery = listQuery.extend({
  branchId: uuid.optional(),
  batchId: uuid.optional(),
  medicineId: uuid.optional(),
  movementType: z.enum(MOVEMENT_TYPES).optional(),
  referenceType: z.string().max(40).optional(),
  referenceId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

const addStockBody = z.object({
  branchId: uuid,
  medicineId: uuid,
  batchNumber: requiredText(60),
  manufacturingDate: isoDate.nullable().optional(),
  expiryDate: isoDate,
  purchasePrice: money,
  sellingPrice: money,
  quantity: positiveInt.max(10000000),
  supplierId: uuid.nullable().optional(),
  minimumStock: nonNegativeInt.max(1000000).optional(),
  notes: optionalText(500),
}).strict().refine((v) => !v.manufacturingDate || v.manufacturingDate <= v.expiryDate, {
  message: 'Manufacturing date must be on or before the expiry date.',
  path: ['manufacturingDate'],
});

const adjustmentFields = {
  inventoryId: uuid,
  reason: z.enum(['DAMAGED', 'EXPIRED', 'LOST', 'FOUND', 'CORRECTION', 'OTHER']),
  quantityChange: z.coerce.number().int('Must be a whole number.').refine((v) => v !== 0, 'Quantity change cannot be zero.'),
  notes: optionalText(500),
};

const adjustmentPreviewBody = z.object(adjustmentFields).strict();
const adjustmentBody = z.object({ ...adjustmentFields, expectedQuantityBefore: nonNegativeInt.optional() }).strict();

const disposeBody = z.object({ notes: optionalText(500), archive: z.boolean().optional() }).strict();

const minimumStockBody = z.object({ minimumStock: nonNegativeInt.max(1000000) }).strict();
const sellingPriceBody = z.object({ sellingPrice: money }).strict();

const fefoPreviewBody = z.object({
  branchId: uuid,
  medicineId: uuid,
  quantity: positiveInt.max(1000000),
}).strict();

module.exports = {
  listInventoryQuery,
  branchScopedQuery,
  listBatchesQuery,
  listMovementsQuery,
  addStockBody,
  adjustmentPreviewBody,
  adjustmentBody,
  minimumStockBody,
  disposeBody,
  sellingPriceBody,
  fefoPreviewBody,
};
