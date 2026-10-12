const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { idParam } = require('../../validators/common');
const controller = require('./refunds.controller');
const v = require('./refunds.validators');

const router = express.Router();
router.use(authenticate);

router.get('/', requireAnyPermission(P.SALES_VIEW_HISTORY, P.SALES_PROCESS_REFUND), validate({ query: v.listRefundsQuery }), controller.list);
router.post('/', requirePermission(P.SALES_PROCESS_REFUND), validate({ body: v.createRefundBody }), controller.create);
router.get('/:id', requireAnyPermission(P.SALES_VIEW, P.SALES_VIEW_HISTORY, P.SALES_PROCESS_REFUND), validate({ params: idParam }), controller.get);

module.exports = router;
