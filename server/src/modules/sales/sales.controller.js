const service = require('./sales.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { readIdempotencyKey } = require('../idempotency/idempotency');
const { sendData, sendPage, sendIdempotent } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listSales(req.auth, req.valid.query));
  },
  async my(req, res) {
    sendPage(res, await service.listSales(req.auth, req.valid.query, { ownOnly: true }));
  },
  async get(req, res) {
    sendData(res, await service.getSale(req.auth, req.valid.params.id));
  },
  async receipt(req, res) {
    sendData(res, await service.getReceipt(req.auth, req.valid.params.id));
  },
  async create(req, res) {
    const result = await service.createSale(req.auth, actorFromRequest(req), req.valid.body, readIdempotencyKey(req));
    sendIdempotent(res, result, 'Sale completed.');
  },
  async void(req, res) {
    const result = await service.voidSale(
      req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body.reason, readIdempotencyKey(req),
    );
    sendIdempotent(res, result, 'Sale voided.');
  },
};
