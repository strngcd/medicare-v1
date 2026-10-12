const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { idParam } = require('../../validators/common');
const controller = require('./sales.controller');
const v = require('./sales.validators');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission(P.SALES_VIEW_HISTORY), validate({ query: v.listSalesQuery }), controller.list);
router.get('/my', requireAnyPermission(P.SALES_VIEW, P.SALES_CREATE), validate({ query: v.listSalesQuery }), controller.my);
router.post('/', requirePermission(P.SALES_CREATE), validate({ body: v.createSaleBody }), controller.create);
router.get('/:id', requireAnyPermission(P.SALES_VIEW, P.SALES_VIEW_HISTORY), validate({ params: idParam }), controller.get);
router.get('/:id/receipt', requirePermission(P.SALES_PRINT_RECEIPT), validate({ params: idParam }), controller.receipt);
router.post('/:id/void', requirePermission(P.SALES_VOID), validate({ params: idParam, body: v.voidSaleBody }), controller.void);

module.exports = router;
