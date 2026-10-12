const { z, uuid, requiredText, optionalText, listQuery, nonNegativeInt } = require('../../validators/common');

const branchFields = {
  name: requiredText(120),
  phone: optionalText(40),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().toLowerCase().email().max(254).nullable().optional()),
  address: optionalText(500),
  city: optionalText(120),
  country: z.string().trim().min(1).max(120).optional(),
  managerUserId: uuid.nullable().optional(),
};

const createBranchBody = z.object({
  ...branchFields,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,19}$/, 'Use 1-20 letters, digits or dashes.'),
}).strict();

const updateBranchBody = z.object({
  ...branchFields,
  name: requiredText(120).optional(),
}).strict();

const listBranchesQuery = listQuery.extend({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const branchSettingsBody = z.object({
  defaultMinimumStock: nonNegativeInt.max(1000000).optional(),
  receiptShowTax: z.boolean().optional(),
  receiptShowDiscount: z.boolean().optional(),
  receiptShowBranchAddress: z.boolean().optional(),
  receiptShowBranchPhone: z.boolean().optional(),
  receiptShowStaff: z.boolean().optional(),
  receiptFooter: optionalText(500),
}).strict();

module.exports = { createBranchBody, updateBranchBody, listBranchesQuery, branchSettingsBody };
