const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { z, idParam, uuid } = require('../../validators/common');
const controller = require('./medicines.controller');
const inventoryController = require('../inventory/inventory.controller');
const v = require('./medicines.validators');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission(P.MEDICINE_VIEW), validate({ query: v.listMedicinesQuery }), controller.list);
router.get('/search', requirePermission(P.MEDICINE_VIEW), validate({ query: v.searchQuery }), controller.search);
router.post('/', requirePermission(P.MEDICINE_CREATE), validate({ body: v.createMedicineBody }), controller.create);
router.get(
  '/:id',
  requirePermission(P.MEDICINE_VIEW),
  validate({ params: idParam, query: z.object({ branchId: uuid.optional() }) }),
  controller.get,
);
router.patch(
  '/:id',
  requirePermission(P.MEDICINE_EDIT),
  validate({ params: idParam, body: v.updateMedicineBody }),
  controller.update,
);
router.patch(
  '/:id/barcode',
  requirePermission(P.MEDICINE_EDIT),
  validate({ params: idParam, body: v.barcodeBody }),
  controller.changeBarcode,
);
router.post('/:id/archive', requirePermission(P.MEDICINE_ARCHIVE), validate({ params: idParam }), controller.archive);
router.post('/:id/restore', requirePermission(P.MEDICINE_RESTORE), validate({ params: idParam }), controller.restore);

router.get(
  '/:id/batches',
  requirePermission(P.INVENTORY_VIEW_BATCHES),
  validate({ params: idParam, query: z.object({ branchId: uuid.optional() }) }),
  inventoryController.medicineBatches,
);
router.get(
  '/:id/inventory',
  requirePermission(P.INVENTORY_VIEW),
  validate({ params: idParam, query: z.object({ branchId: uuid.optional() }) }),
  inventoryController.medicineInventory,
);

module.exports = router;
