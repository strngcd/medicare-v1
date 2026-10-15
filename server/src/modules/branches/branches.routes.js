const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { idParam } = require('../../validators/common');
const controller = require('./branches.controller');
const inventoryController = require('../inventory/inventory.controller');
const v = require('./branches.validators');

const router = express.Router();
router.use(authenticate);

// Branch selector data: every signed-in user may see their own accessible branches.
router.get('/context', controller.context);

router.get('/', requirePermission(P.BRANCH_VIEW), validate({ query: v.listBranchesQuery }), controller.list);
router.post('/', requirePermission(P.BRANCH_CREATE), validate({ body: v.createBranchBody }), controller.create);
router.get('/:id', requirePermission(P.BRANCH_VIEW), validate({ params: idParam }), controller.get);
router.patch('/:id', requirePermission(P.BRANCH_EDIT), validate({ params: idParam, body: v.updateBranchBody }), controller.update);
router.post('/:id/deactivate', requirePermission(P.BRANCH_DEACTIVATE), validate({ params: idParam }), controller.deactivate);
router.post('/:id/reactivate', requirePermission(P.BRANCH_REACTIVATE), validate({ params: idParam }), controller.reactivate);
router.delete('/:id', requirePermission(P.BRANCH_DEACTIVATE), validate({ params: idParam }), controller.remove);
router.get('/:id/users', requirePermission(P.BRANCH_VIEW, P.STAFF_VIEW), validate({ params: idParam }), controller.users);
router.get(
  '/:id/inventory-summary',
  requirePermission(P.INVENTORY_VIEW),
  validate({ params: idParam }),
  inventoryController.branchSummary,
);
router.get(
  '/:id/settings',
  requireAnyPermission(P.SETTINGS_VIEW, P.BRANCH_EDIT),
  validate({ params: idParam }),
  controller.getSettings,
);
router.patch(
  '/:id/settings',
  requireAnyPermission(P.SETTINGS_EDIT, P.BRANCH_EDIT),
  validate({ params: idParam, body: v.branchSettingsBody }),
  controller.updateSettings,
);

module.exports = router;
