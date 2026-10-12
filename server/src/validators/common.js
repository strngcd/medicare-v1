const { z } = require('zod');

/** Reusable zod building blocks shared by module validators. */

const uuid = z.string().uuid({ message: 'Must be a valid identifier.' });

const trimmed = (max = 255) => z.string().trim().max(max);
const requiredText = (max = 255) => z.string().trim().min(1, 'This field is required.').max(max);
const optionalText = (max = 2000) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.').refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Not a valid calendar date.');

// Money is accepted as a string or number and validated without float math.
const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), 'Must be a non-negative amount with at most 2 decimals.');

const positiveMoney = money.refine((v) => Number(v) > 0, 'Must be greater than zero.');

const positiveInt = z.coerce.number().int('Must be a whole number.').positive('Must be greater than zero.');
const nonNegativeInt = z.coerce.number().int('Must be a whole number.').min(0, 'Cannot be negative.');

const email = z.string().trim().toLowerCase().email('Must be a valid email address.').max(254);

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc', 'ASC', 'DESC']).optional(),
  search: z.string().trim().max(100).optional(),
}).passthrough();

const queryBoolean = z.enum(['true', 'false']).transform((v) => v === 'true');

const idParam = z.object({ id: uuid });

module.exports = {
  z,
  uuid,
  trimmed,
  requiredText,
  optionalText,
  isoDate,
  money,
  positiveMoney,
  positiveInt,
  nonNegativeInt,
  email,
  listQuery,
  queryBoolean,
  idParam,
};
