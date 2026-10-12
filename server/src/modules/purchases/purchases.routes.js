const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { idParam } = require('../../validators/common');
const controller = require('./purchases.controller');
const v = require('./purchases.validators');

/** /api/v1/purchases */
const purchasesRouter = express.Router();
purchasesRouter.use(authenticate);
purchasesRouter.get('/', requirePermission(P.PURCHASE_VIEW), validate({ query: v.listPurchasesQuery }), controller.list);
purchasesRouter.post('/', requirePermission(P.PURCHASE_CREATE), validate({ body: v.createPurchaseBody }), controller.create);
purchasesRouter.get('/:id', requirePermission(P.PURCHASE_VIEW), validate({ params: idParam }), controller.get);
purchasesRouter.patch('/:id', requirePermission(P.PURCHASE_EDIT), validate({ params: idParam, body: v.updatePurchaseBody }), controller.update);
purchasesRouter.post('/:id/receive', requirePermission(P.PURCHASE_RECEIVE), validate({ params: idParam, body: v.receiveBody }), controller.receive);
purchasesRouter.get('/:id/receivings', requirePermission(P.PURCHASE_VIEW), validate({ params: idParam }), controller.receivings);
purchasesRouter.post('/:id/cancel', requirePermission(P.PURCHASE_CANCEL), validate({ params: idParam, body: v.cancelBody }), controller.cancel);

/** /api/v1/purchase-receivings */
const receivingsRouter = express.Router();
receivingsRouter.use(authenticate);
receivingsRouter.get('/:id', requirePermission(P.PURCHASE_VIEW), validate({ params: idParam }), controller.receiving);

module.exports = { purchasesRouter, receivingsRouter, listPurchasesQuery: v.listPurchasesQuery };
