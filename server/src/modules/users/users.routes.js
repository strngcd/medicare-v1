const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { rawUpload } = require('../files/files');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { idParam } = require('../../validators/common');
const controller = require('./users.controller');
const v = require('./users.validators');

const router = express.Router();
router.use(authenticate);

// Self-service (registered before /:id so "me" is never treated as an id).
router.get('/me', controller.getMe);
router.patch('/me', validate({ body: v.updateMeBody }), controller.updateMe);
router.get('/me/preferences', controller.getPreferences);
router.patch('/me/preferences', validate({ body: v.preferencesBody }), controller.updatePreferences);

router.get('/', requirePermission(P.STAFF_VIEW), validate({ query: v.listUsersQuery }), controller.list);
router.post('/', requirePermission(P.STAFF_CREATE), validate({ body: v.createUserBody }), controller.create);
router.get('/:id', requirePermission(P.STAFF_VIEW), validate({ params: idParam }), controller.get);
router.patch('/:id', requirePermission(P.STAFF_EDIT), validate({ params: idParam, body: v.updateUserBody }), controller.update);
router.get('/:id/cv', requirePermission(P.STAFF_VIEW), validate({ params: idParam }), controller.downloadCv);
router.put(
  '/:id/cv',
  requireAnyPermission(P.STAFF_CREATE, P.STAFF_EDIT),
  validate({ params: idParam }),
  rawUpload('STAFF_CV'),
  controller.uploadCv,
);
router.delete('/:id/cv', requireAnyPermission(P.STAFF_CREATE, P.STAFF_EDIT), validate({ params: idParam }), controller.removeCv);
router.post('/:id/setup-link', requirePermission(P.STAFF_CREATE), validate({ params: idParam }), controller.resendSetupLink);
router.patch(
  '/:id/role',
  requirePermission(P.STAFF_CHANGE_ROLE),
  validate({ params: idParam, body: v.changeRoleBody }),
  controller.changeRole,
);
router.patch(
  '/:id/branches',
  requirePermission(P.STAFF_MANAGE_BRANCHES),
  validate({ params: idParam, body: v.setBranchesBody }),
  controller.setBranches,
);
router.get('/:id/permissions', requirePermission(P.STAFF_VIEW), validate({ params: idParam }), controller.permissions);
router.put(
  '/:id/permissions/:permissionCode',
  requirePermission(P.STAFF_MANAGE_PERMISSIONS),
  validate({ params: v.permissionParams, body: v.permissionOverrideBody }),
  controller.setPermission,
);
router.delete(
  '/:id/permissions/:permissionCode',
  requirePermission(P.STAFF_MANAGE_PERMISSIONS),
  validate({ params: v.permissionParams }),
  controller.clearPermission,
);
router.delete('/:id', requirePermission(P.STAFF_DEACTIVATE), validate({ params: idParam }), controller.remove);
router.post('/:id/deactivate', requirePermission(P.STAFF_DEACTIVATE), validate({ params: idParam }), controller.deactivate);
router.post('/:id/reactivate', requirePermission(P.STAFF_REACTIVATE), validate({ params: idParam }), controller.reactivate);
router.get(
  '/:id/activity',
  requirePermission(P.STAFF_VIEW, P.AUDIT_LOG_VIEW),
  validate({ params: idParam }),
  controller.activity,
);

module.exports = router;
