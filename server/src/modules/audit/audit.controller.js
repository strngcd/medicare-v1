const service = require('./audit.service');
const { sendData, sendPage } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listAuditLogs(req.auth, req.valid.query));
  },
  async actions(req, res) {
    sendData(res, await service.listAuditActions());
  },
  async get(req, res) {
    sendData(res, await service.getAuditLog(req.auth, req.valid.params.id));
  },
  async loginHistory(req, res) {
    sendPage(res, await service.listLoginHistory(req.auth, req.valid.query));
  },
};
