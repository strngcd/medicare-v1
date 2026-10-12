const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { idParam } = require('../../validators/common');
const controller = require('./supplierPayments.controller');
const v = require('./supplierPayments.validators');

const router = express.Router();
router.use(authenticate);
router.get('/', requirePermission(P.SUPPLIER_PAYMENT_VIEW), validate({ query: v.listPaymentsQuery }), controller.list);
router.post('/', requirePermission(P.SUPPLIER_PAYMENT_CREATE), validate({ body: v.createPaymentBody }), controller.create);
router.get('/:id', requirePermission(P.SUPPLIER_PAYMENT_VIEW), validate({ params: idParam }), controller.get);

module.exports = router;
