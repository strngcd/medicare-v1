const { z, uuid, requiredText, optionalText, isoDate, email, listQuery } = require('../../validators/common');
const { ALL_PERMISSION_CODES } = require('../../permissions/catalog');

const roleCode = z.enum(['OWNER', 'ADMIN', 'PHARMACIST', 'CASHIER']);
const employeeId = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(40).regex(/^[A-Za-z0-9_\-/]+$/, 'Use letters, digits, dashes or slashes.').nullable().optional(),
);
const optionalDate = z.preprocess((v) => (v === '' ? null : v), isoDate.nullable().optional());

const createUserBody = z.object({
  fullName: requiredText(120),
  email,
  phone: optionalText(40),
  roleCode,
  employeeId,
  jobTitle: optionalText(120),
  hireDate: optionalDate,
  branchIds: z.array(uuid).max(100).optional(),
}).strict();

const updateUserBody = z.object({
  fullName: requiredText(120).optional(),
  email: email.optional(),
  phone: optionalText(40),
  employeeId,
  jobTitle: optionalText(120),
  hireDate: optionalDate,
}).strict();

const updateMeBody = z.object({
  fullName: requiredText(120).optional(),
  phone: optionalText(40),
}).strict();

const changeRoleBody = z.object({ roleCode }).strict();
const setBranchesBody = z.object({ branchIds: z.array(uuid).max(100) }).strict();
const permissionOverrideBody = z.object({ granted: z.boolean() }).strict();
const permissionParams = z.object({ id: uuid, permissionCode: z.enum(ALL_PERMISSION_CODES) });

const listUsersQuery = listQuery.extend({
  role: roleCode.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  branchId: uuid.optional(),
});

const preferencesBody = z.object({
  theme: z.enum(['LIGHT', 'DARK', 'SYSTEM']).optional(),
  pageSize: z.union([z.literal(10), z.literal(25), z.literal(50), z.literal(100)]).optional(),
  uiDensity: z.enum(['COMFORTABLE', 'COMPACT']).optional(),
  lastSelectedBranchId: uuid.nullable().optional(),
}).strict();

module.exports = {
  createUserBody,
  updateUserBody,
  updateMeBody,
  changeRoleBody,
  setBranchesBody,
  permissionOverrideBody,
  permissionParams,
  listUsersQuery,
  preferencesBody,
};
