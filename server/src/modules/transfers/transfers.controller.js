const service = require('./transfers.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { readIdempotencyKey } = require('../idempotency/idempotency');
const { sendData, sendCreated, sendPage, sendIdempotent } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listTransfers(req.auth, req.valid.query));
  },
  async get(req, res) {
    sendData(res, await service.getTransfer(req.auth, req.valid.params.id));
  },
  async create(req, res) {
    sendCreated(res, await service.createTransfer(req.auth, actorFromRequest(req), req.valid.body), 'Transfer created.');
  },
  async request(req, res) {
    sendData(res, await service.requestTransfer(req.auth, actorFromRequest(req), req.valid.params.id), { message: 'Transfer requested.' });
  },
  async approve(req, res) {
    sendData(res, await service.approveTransfer(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body), {
      message: 'Transfer approved.',
    });
  },
  async ship(req, res) {
    const result = await service.shipTransfer(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body, readIdempotencyKey(req));
    sendIdempotent(res, result, 'Transfer shipped.');
  },
  async receive(req, res) {
    const result = await service.receiveTransfer(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body, readIdempotencyKey(req));
    sendIdempotent(res, result, 'Transfer received.');
  },
  async cancel(req, res) {
    sendData(res, await service.cancelTransfer(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body.reason), {
      message: 'Transfer cancelled.',
    });
  },
};
