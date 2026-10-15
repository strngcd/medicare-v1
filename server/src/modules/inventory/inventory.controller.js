const service = require('./inventory.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { readIdempotencyKey } = require('../idempotency/idempotency');
const { sendData, sendPage, sendIdempotent } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listInventory(req.auth, req.valid.query));
  },
  async get(req, res) {
    sendData(res, await service.getInventory(req.auth, req.valid.params.id));
  },
  async expired(req, res) {
    sendPage(res, await service.listInventory(req.auth, req.valid.query, ['EXPIRED']));
  },
  async expiringSoon(req, res) {
    sendPage(res, await service.listInventory(req.auth, req.valid.query, ['EXPIRING_SOON']));
  },
  async lowStock(req, res) {
    sendPage(res, await service.listStockLevels(req.auth, req.valid.query, 'LOW_STOCK'));
  },
  async outOfStock(req, res) {
    sendPage(res, await service.listStockLevels(req.auth, req.valid.query, 'OUT_OF_STOCK'));
  },
  async addStock(req, res) {
    const result = await service.addStock(req.auth, actorFromRequest(req), req.valid.body, readIdempotencyKey(req));
    sendIdempotent(res, result, 'Stock added.');
  },
  async previewAdjustment(req, res) {
    sendData(res, await service.previewAdjustment(req.auth, req.valid.body));
  },
  async createAdjustment(req, res) {
    const result = await service.createAdjustment(req.auth, actorFromRequest(req), req.valid.body, readIdempotencyKey(req));
    sendIdempotent(res, result, 'Inventory adjusted.');
  },
  async dispose(req, res) {
    const result = await service.disposeStock(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body, readIdempotencyKey(req));
    sendIdempotent(res, result, result.body.recordedAsLoss ? 'Stock disposed and recorded as a loss.' : 'Stock disposed (not recorded as a loss).');
  },
  async archive(req, res) {
    sendData(res, await service.setInventoryArchived(req.auth, actorFromRequest(req), req.valid.params.id, true), { message: 'Batch archived.' });
  },
  async restore(req, res) {
    sendData(res, await service.setInventoryArchived(req.auth, actorFromRequest(req), req.valid.params.id, false), { message: 'Batch restored.' });
  },
  async disposals(req, res) {
    const result = await service.listDisposals(req.auth, req.valid.query);
    sendPage(res, result, { totals: result.totals });
  },
  async movements(req, res) {
    sendPage(res, await service.listMovements(req.auth, req.valid.query));
  },
  async movement(req, res) {
    sendData(res, await service.getMovement(req.auth, req.valid.params.id));
  },
  async updateMinimumStock(req, res) {
    sendData(
      res,
      await service.updateMinimumStock(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body.minimumStock),
      { message: 'Minimum stock updated.' },
    );
  },
  async updateSellingPrice(req, res) {
    sendData(
      res,
      await service.updateSellingPrice(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body.sellingPrice),
      { message: 'Selling price updated.' },
    );
  },
  async fefoPreview(req, res) {
    sendData(res, await service.fefoPreview(req.auth, req.valid.body));
  },
  async listBatches(req, res) {
    sendPage(res, await service.listBatches(req.auth, req.valid.query));
  },
  async getBatch(req, res) {
    sendData(res, await service.getBatch(req.auth, req.valid.params.id));
  },
  async batchMovements(req, res) {
    sendPage(res, await service.listMovements(req.auth, req.valid.query, { batchId: req.valid.params.id }));
  },
  async medicineBatches(req, res) {
    sendData(res, await service.medicineBatches(req.auth, req.valid.params.id, req.valid.query.branchId));
  },
  async medicineInventory(req, res) {
    sendData(res, await service.medicineInventory(req.auth, req.valid.params.id, req.valid.query.branchId));
  },
  async branchSummary(req, res) {
    sendData(res, await service.branchInventorySummary(req.auth, req.valid.params.id));
  },
};
