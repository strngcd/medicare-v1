const { z, requiredText, optionalText, listQuery } = require('../../validators/common');

const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().toLowerCase().email('Must be a valid email address.').max(254).nullable().optional(),
);

const createSupplierBody = z.object({
  companyName: requiredText(200),
  phone: requiredText(40),
  contactPerson: optionalText(120),
  email: optionalEmail,
  address: optionalText(500),
  notes: optionalText(2000),
}).strict();

const updateSupplierBody = z.object({
  companyName: requiredText(200).optional(),
  phone: requiredText(40).optional(),
  contactPerson: optionalText(120),
  email: optionalEmail,
  address: optionalText(500),
  notes: optionalText(2000),
}).strict();

const listSuppliersQuery = listQuery.extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() });

module.exports = { createSupplierBody, updateSupplierBody, listSuppliersQuery };
