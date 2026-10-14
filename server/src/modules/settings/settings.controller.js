const service = require('./settings.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { sendData } = require('../../utils/response');
const files = require('../files/files');

module.exports = {
  async get(req, res) {
    sendData(res, await service.getSettings());
  },
  async update(req, res) {
    sendData(res, await service.updateSettings(req.auth, actorFromRequest(req), req.valid.body), { message: 'Settings saved.' });
  },
  async uploadLogo(req, res) {
    const file = files.readUpload(req, 'PHARMACY_LOGO');
    sendData(res, await service.setLogo(req.auth, actorFromRequest(req), file), { message: 'Logo uploaded.' });
  },
  async removeLogo(req, res) {
    sendData(res, await service.setLogo(req.auth, actorFromRequest(req), null), { message: 'Logo removed.' });
  },
  async logo(req, res) {
    // The URL carries the file id, so a cached copy is valid until the logo changes.
    files.sendFile(res, await service.getLogo(), { cacheSeconds: 86400 });
  },
  async branding(req, res) {
    sendData(res, await service.getBranding());
  },
  async systemInfo(req, res) {
    sendData(res, await service.getSystemInfo());
  },
};
