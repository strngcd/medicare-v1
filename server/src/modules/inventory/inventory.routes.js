const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission, requireAnyPermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { idParam } = require('../../validators/common');
const controller = require('./inventory.controller');
const v = require('./inventory.validators');

/** /api/v1/inventory */
const inventoryRouter = express.Router();
inventoryRouter.use(authenticate);

inventoryRouter.get('/', requirePermission(P.INVENTORY_VIEW), validate({ query: v.listInventoryQuery }), controller.list);
inventoryRouter.get('/expired', requirePermission(P.INVENTORY_VIEW), validate({ query: v.listInventoryQuery }), controller.expired);
inventoryRouter.get('/expiring-soon', requirePermission(P.INVENTORY_VIEW), validate({ query: v.listInventoryQuery }), controller.expiringSoon);
inventoryRouter.get('/low-stock', requirePermission(P.INVENTORY_VIEW), validate({ query: v.branchScopedQuery }), controller.lowStock);
inventoryRouter.get('/out-of-stock', requirePermission(P.INVENTORY_VIEW), validate({ query: v.branchScopedQuery }), controller.outOfStock);
inventoryRouter.get('/disposals', requirePermission(P.INVENTORY_VIEW), validate({ query: v.listDisposalsQuery }), controller.disposals);
inventoryRouter.get('/movements', requirePermission(P.INVENTORY_VIEW_MOVEMENTS), validate({ query: v.listMovementsQuery }), controller.movements);
inventoryRouter.get('/movements/:id', requirePermission(P.INVENTORY_VIEW_MOVEMENTS), validate({ params: idParam }), controller.movement);
inventoryRouter.post('/stock', requirePermission(P.INVENTORY_ADD_STOCK), validate({ body: v.addStockBody }), controller.addStock);
inventoryRouter.post(
  '/adjustments/preview',
  requirePermission(P.INVENTORY_ADJUST),
  validate({ body: v.adjustmentPreviewBody }),
  controller.previewAdjustment,
);
inventoryRouter.post('/adjustments', requirePermission(P.INVENTORY_ADJUST), validate({ body: v.adjustmentBody }), controller.createAdjustment);
inventoryRouter.post(
  '/fefo-preview',
  requireAnyPermission(P.SALES_CREATE, P.INVENTORY_VIEW),
  validate({ body: v.fefoPreviewBody }),
  controller.fefoPreview,
);
inventoryRouter.get('/:id', requirePermission(P.INVENTORY_VIEW), validate({ params: idParam }), controller.get);
inventoryRouter.post('/:id/dispose', requirePermission(P.INVENTORY_DISPOSE), validate({ params: idParam, body: v.disposeBody }), controller.dispose);
inventoryRouter.post('/:id/archive', requirePermission(P.INVENTORY_BATCH_ARCHIVE), validate({ params: idParam }), controller.archive);
inventoryRouter.post('/:id/restore', requirePermission(P.INVENTORY_BATCH_RESTORE), validate({ params: idParam }), controller.restore);
inventoryRouter.patch(
  '/:id/minimum-stock',
  requirePermission(P.INVENTORY_ADJUST),
  validate({ params: idParam, body: v.minimumStockBody }),
  controller.updateMinimumStock,
);
inventoryRouter.patch(
  '/:id/selling-price',
  requirePermission(P.INVENTORY_ADJUST),
  validate({ params: idParam, body: v.sellingPriceBody }),
  controller.updateSellingPrice,
);

/** /api/v1/batches */
const batchesRouter = express.Router();
batchesRouter.use(authenticate);
batchesRouter.get('/', requirePermission(P.INVENTORY_VIEW_BATCHES), validate({ query: v.listBatchesQuery }), controller.listBatches);
batchesRouter.get('/:id', requirePermission(P.INVENTORY_VIEW_BATCHES), validate({ params: idParam }), controller.getBatch);
batchesRouter.get(
  '/:id/movements',
  requirePermission(P.INVENTORY_VIEW_MOVEMENTS),
  validate({ params: idParam, query: v.listMovementsQuery }),
  controller.batchMovements,
);

module.exports = { inventoryRouter, batchesRouter };
