const service = require('./settings.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { sendData } = require('../../utils/response');

module.exports = {
  async get(req, res) {
    sendData(res, await service.getSettings());
  },
  async update(req, res) {
    sendData(res, await service.updateSettings(req.auth, actorFromRequest(req), req.valid.body), { message: 'Settings saved.' });
  },
  async systemInfo(req, res) {
    sendData(res, await service.getSystemInfo());
  },
};
