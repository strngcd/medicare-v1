const { z, requiredText, optionalText, listQuery } = require('../../validators/common');

const productType = z.enum(['MEDICINE', 'COSMETIC']);

const createCategoryBody = z.object({ name: requiredText(100), description: optionalText(500), productType: productType.optional() }).strict();
const updateCategoryBody = z.object({ name: requiredText(100).optional(), description: optionalText(500) }).strict();
const listCategoriesQuery = listQuery.extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional(), productType: productType.optional() });

module.exports = { createCategoryBody, updateCategoryBody, listCategoriesQuery };
