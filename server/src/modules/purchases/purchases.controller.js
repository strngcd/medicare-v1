const service = require('./purchases.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { readIdempotencyKey } = require('../idempotency/idempotency');
const { sendData, sendCreated, sendPage, sendIdempotent } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listPurchases(req.auth, req.valid.query));
  },
  async listForSupplier(req, res) {
    sendPage(res, await service.listPurchases(req.auth, req.valid.query, { supplierId: req.valid.params.id }));
  },
  async get(req, res) {
    sendData(res, await service.getPurchase(req.auth, req.valid.params.id));
  },
  async create(req, res) {
    sendCreated(res, await service.createPurchase(req.auth, actorFromRequest(req), req.valid.body), 'Purchase created.');
  },
  async update(req, res) {
    sendData(res, await service.updatePurchase(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body), {
      message: 'Purchase updated.',
    });
  },
  async receive(req, res) {
    const result = await service.receivePurchase(
      req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body, readIdempotencyKey(req),
    );
    sendIdempotent(res, result, 'Stock received.');
  },
  async receivings(req, res) {
    sendData(res, await service.listReceivings(req.auth, req.valid.params.id));
  },
  async receiving(req, res) {
    sendData(res, await service.getReceiving(req.auth, req.valid.params.id));
  },
  async cancel(req, res) {
    sendData(res, await service.cancelPurchase(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body.reason), {
      message: 'Purchase cancelled.',
    });
  },
};
