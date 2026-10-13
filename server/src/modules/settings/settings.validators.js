const { z, requiredText, optionalText } = require('../../validators/common');

const optionalUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().url('Must be a valid URL.').max(500).refine((u) => /^https?:\/\//.test(u), 'Use an http(s) URL.').nullable().optional(),
);

const updateSettingsBody = z.object({
  pharmacyName: requiredText(120).optional(),
  logoUrl: optionalUrl,
  phone: optionalText(40),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().trim().toLowerCase().email().max(254).nullable().optional()),
  address: optionalText(500),
  city: optionalText(120),
  country: requiredText(120).optional(),
  website: optionalUrl,
  currencyCode: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code.').optional(),
  expiryWarningDays: z.coerce.number().int().min(1).max(365).optional(),
  defaultMarkupPercent: z.union([z.string(), z.number()]).transform(String)
    .refine((v) => /^\d{1,4}(\.\d{1,2})?$/.test(v) && Number(v) <= 1000, 'Use a percentage between 0 and 1000 with up to 2 decimals.')
    .optional(),
  taxEnabled: z.boolean().optional(),
  taxName: requiredText(40).optional(),
  taxRate: z.union([z.string(), z.number()]).transform(String)
    .refine((v) => /^\d{1,3}(\.\d{1,3})?$/.test(v) && Number(v) <= 100, 'Use a rate between 0 and 100 with up to 3 decimals.')
    .optional(),
  taxMode: z.enum(['INCLUDED', 'ADDED_ON_TOP']).optional(),
}).strict();

module.exports = { updateSettingsBody };
