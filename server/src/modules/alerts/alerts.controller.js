const service = require('./alerts.service');
const { sendData, sendPage } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listAlerts(req.auth, req.valid.query));
  },
  async count(req, res) {
    sendData(res, await service.countAlerts(req.auth, req.valid.query.branchId));
  },
  async get(req, res) {
    sendData(res, await service.getAlert(req.auth, req.valid.params.id));
  },
};
