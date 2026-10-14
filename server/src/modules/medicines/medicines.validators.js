const { z, uuid, requiredText, optionalText, listQuery, queryBoolean } = require('../../validators/common');

const barcode = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(64).regex(/^[A-Za-z0-9\-_.]+$/, 'Barcodes may contain letters, digits, dashes, dots and underscores.').nullable(),
);

const productType = z.enum(['MEDICINE', 'COSMETIC']);

const identityFields = {
  name: requiredText(200),
  genericName: optionalText(200),
  brandName: optionalText(200),
  categoryId: uuid.nullable().optional(),
  manufacturer: optionalText(200),
  countryOfOrigin: optionalText(100),
  strength: optionalText(60),
  dosageForm: optionalText(60),
  packageSize: requiredText(60),
  prescriptionRequired: z.boolean(),
  description: optionalText(2000),
  storageInstructions: optionalText(1000),
};

// Cosmetics never require a prescription, so they may omit the flag; for
// medicines it stays required (the service rejects true on a cosmetic).
const createMedicineBody = z.preprocess(
  (v) => (v && typeof v === 'object' && v.productType === 'COSMETIC' && v.prescriptionRequired === undefined
    ? { ...v, prescriptionRequired: false } : v),
  z.object({ ...identityFields, productType: productType.optional(), barcode: barcode.optional() }).strict(),
);

const updateMedicineBody = z.object({
  ...Object.fromEntries(Object.entries(identityFields).map(([k, s]) => [k, s.optional()])),
  // Only DRAFT -> ACTIVE is allowed here; archive/restore have their own endpoints.
  status: z.literal('ACTIVE').optional(),
}).strict();

const barcodeBody = z.object({ barcode }).strict();

const listMedicinesQuery = listQuery.extend({
  categoryId: uuid.optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  prescriptionRequired: queryBoolean.optional(),
  productType: productType.optional(),
  branchId: uuid.optional(),
});

const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  branchId: uuid,
  categoryId: uuid.optional(),
  productType: productType.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

module.exports = { createMedicineBody, updateMedicineBody, barcodeBody, listMedicinesQuery, searchQuery };
