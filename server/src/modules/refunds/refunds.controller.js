const service = require('./refunds.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { readIdempotencyKey } = require('../idempotency/idempotency');
const { sendData, sendPage, sendIdempotent } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listRefunds(req.auth, req.valid.query));
  },
  async get(req, res) {
    sendData(res, await service.getRefund(req.auth, req.valid.params.id));
  },
  async create(req, res) {
    const result = await service.createRefund(req.auth, actorFromRequest(req), req.valid.body, readIdempotencyKey(req));
    sendIdempotent(res, result, 'Refund processed.');
  },
};
