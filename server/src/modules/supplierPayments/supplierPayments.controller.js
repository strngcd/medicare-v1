const service = require('./supplierPayments.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { readIdempotencyKey } = require('../idempotency/idempotency');
const { sendData, sendPage, sendIdempotent } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listPayments(req.auth, req.valid.query));
  },
  async get(req, res) {
    sendData(res, await service.getPayment(req.auth, req.valid.params.id));
  },
  async create(req, res) {
    const result = await service.createPayment(req.auth, actorFromRequest(req), req.valid.body, readIdempotencyKey(req));
    sendIdempotent(res, result, 'Supplier payment recorded.');
  },
  async balance(req, res) {
    sendData(res, await service.supplierBalance(req.auth, req.valid.params.id));
  },
};
