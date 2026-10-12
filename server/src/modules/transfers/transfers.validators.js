const { z, uuid, requiredText, optionalText, isoDate, positiveInt, nonNegativeInt, listQuery } = require('../../validators/common');

const STATUSES = ['DRAFT', 'REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'];

const createTransferBody = z.object({
  sourceBranchId: uuid,
  destinationBranchId: uuid,
  notes: optionalText(1000),
  items: z.array(z.object({
    batchId: uuid,
    requestedQuantity: positiveInt.max(10000000),
    notes: optionalText(500),
  }).strict()).min(1, 'Add at least one batch.').max(200),
}).strict();

const stepItems = z.array(z.object({ transferItemId: uuid, quantity: nonNegativeInt }).strict()).max(200).optional();

const approveBody = z.object({ items: stepItems }).strict();
const shipBody = z.object({ items: stepItems }).strict();
const receiveBody = z.object({ items: stepItems, discrepancyReason: optionalText(1000) }).strict();
const cancelBody = z.object({ reason: requiredText(500) }).strict();

const listTransfersQuery = listQuery.extend({
  branchId: uuid.optional(),
  sourceBranchId: uuid.optional(),
  destinationBranchId: uuid.optional(),
  status: z.enum(STATUSES).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

module.exports = { createTransferBody, approveBody, shipBody, receiveBody, cancelBody, listTransfersQuery };
