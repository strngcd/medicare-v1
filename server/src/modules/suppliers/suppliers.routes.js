const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { idParam } = require('../../validators/common');
const controller = require('./suppliers.controller');
const v = require('./suppliers.validators');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission(P.SUPPLIER_VIEW), validate({ query: v.listSuppliersQuery }), controller.list);
router.post('/', requirePermission(P.SUPPLIER_CREATE), validate({ body: v.createSupplierBody }), controller.create);
router.get('/:id', requirePermission(P.SUPPLIER_VIEW), validate({ params: idParam }), controller.get);
router.patch(
  '/:id',
  requirePermission(P.SUPPLIER_EDIT),
  validate({ params: idParam, body: v.updateSupplierBody }),
  controller.update,
);
router.post('/:id/archive', requirePermission(P.SUPPLIER_ARCHIVE), validate({ params: idParam }), controller.archive);
router.post('/:id/restore', requirePermission(P.SUPPLIER_RESTORE), validate({ params: idParam }), controller.restore);

module.exports = router;
