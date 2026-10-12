const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { idParam } = require('../../validators/common');
const controller = require('./transfers.controller');
const v = require('./transfers.validators');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission(P.INVENTORY_TRANSFER_VIEW), validate({ query: v.listTransfersQuery }), controller.list);
router.post('/', requirePermission(P.INVENTORY_TRANSFER_CREATE), validate({ body: v.createTransferBody }), controller.create);
router.get('/:id', requirePermission(P.INVENTORY_TRANSFER_VIEW), validate({ params: idParam }), controller.get);
router.post('/:id/request', requirePermission(P.INVENTORY_TRANSFER_CREATE), validate({ params: idParam }), controller.request);
router.post('/:id/approve', requirePermission(P.INVENTORY_TRANSFER_APPROVE), validate({ params: idParam, body: v.approveBody }), controller.approve);
router.post('/:id/ship', requirePermission(P.INVENTORY_TRANSFER_SHIP), validate({ params: idParam, body: v.shipBody }), controller.ship);
router.post('/:id/receive', requirePermission(P.INVENTORY_TRANSFER_RECEIVE), validate({ params: idParam, body: v.receiveBody }), controller.receive);
// No dedicated cancel permission exists: creators and approvers may cancel before shipment.
router.post(
  '/:id/cancel',
  requireAnyPermission(P.INVENTORY_TRANSFER_CREATE, P.INVENTORY_TRANSFER_APPROVE),
  validate({ params: idParam, body: v.cancelBody }),
  controller.cancel,
);

module.exports = router;
