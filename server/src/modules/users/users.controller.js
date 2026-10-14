const service = require('./users.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { sendData, sendCreated, sendPage } = require('../../utils/response');
const files = require('../files/files');

module.exports = {
  async uploadCv(req, res) {
    const file = files.readUpload(req, 'STAFF_CV');
    sendData(res, await service.setCv(req.auth, actorFromRequest(req), req.valid.params.id, file), { message: 'CV uploaded.' });
  },
  async removeCv(req, res) {
    sendData(res, await service.setCv(req.auth, actorFromRequest(req), req.valid.params.id, null), { message: 'CV removed.' });
  },
  async downloadCv(req, res) {
    files.sendFile(res, await service.getCv(req.auth, req.valid.params.id), { download: req.query.download === '1' });
  },
  async list(req, res) {
    sendPage(res, await service.listUsers(req.auth, req.valid.query));
  },
  async get(req, res) {
    sendData(res, await service.getUser(req.auth, req.valid.params.id));
  },
  async create(req, res) {
    sendCreated(res, await service.createUser(req.auth, actorFromRequest(req), req.valid.body), 'Staff account created.');
  },
  async resendSetupLink(req, res) {
    sendData(res, await service.resendSetupLink(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'A new setup link was issued.',
    });
  },
  async update(req, res) {
    sendData(res, await service.updateUser(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body), {
      message: 'Staff profile updated.',
    });
  },
  async changeRole(req, res) {
    sendData(
      res,
      await service.changeRole(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body.roleCode),
      { message: 'Role changed.' },
    );
  },
  async setBranches(req, res) {
    sendData(
      res,
      await service.setBranches(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body.branchIds),
      { message: 'Branch assignments updated.' },
    );
  },
  async permissions(req, res) {
    sendData(res, await service.getUserPermissions(req.auth, req.valid.params.id));
  },
  async setPermission(req, res) {
    const { id, permissionCode } = req.valid.params;
    sendData(
      res,
      await service.setPermissionOverride(req.auth, actorFromRequest(req), id, permissionCode, req.valid.body.granted),
      { message: 'Permission updated.' },
    );
  },
  async clearPermission(req, res) {
    const { id, permissionCode } = req.valid.params;
    sendData(res, await service.setPermissionOverride(req.auth, actorFromRequest(req), id, permissionCode, null), {
      message: 'Permission reset to role default.',
    });
  },
  async deactivate(req, res) {
    sendData(res, await service.deactivateUser(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'Account deactivated.',
    });
  },
  async reactivate(req, res) {
    sendData(res, await service.reactivateUser(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'Account reactivated.',
    });
  },
  async activity(req, res) {
    sendPage(res, await service.getUserActivity(req.auth, req.valid.params.id, req.query));
  },
  async getMe(req, res) {
    sendData(res, await service.getMe(req.auth));
  },
  async updateMe(req, res) {
    sendData(res, await service.updateMe(req.auth, actorFromRequest(req), req.valid.body), {
      message: 'Profile updated.',
    });
  },
  async getPreferences(req, res) {
    sendData(res, await service.getPreferences(req.auth));
  },
  async updatePreferences(req, res) {
    sendData(res, await service.updatePreferences(req.auth, req.valid.body), { message: 'Preferences saved.' });
  },
};
