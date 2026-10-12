const service = require('./branches.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { sendData, sendCreated, sendPage } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listBranches(req.auth, req.valid.query));
  },
  async context(req, res) {
    sendData(res, await service.getBranchContext(req.auth));
  },
  async get(req, res) {
    sendData(res, await service.getBranch(req.auth, req.valid.params.id));
  },
  async create(req, res) {
    sendCreated(res, await service.createBranch(req.auth, actorFromRequest(req), req.valid.body), 'Branch created.');
  },
  async update(req, res) {
    sendData(res, await service.updateBranch(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body), {
      message: 'Branch updated.',
    });
  },
  async deactivate(req, res) {
    sendData(res, await service.deactivateBranch(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'Branch deactivated.',
    });
  },
  async reactivate(req, res) {
    sendData(res, await service.reactivateBranch(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'Branch reactivated.',
    });
  },
  async users(req, res) {
    sendData(res, await service.listBranchUsers(req.auth, req.valid.params.id));
  },
  async getSettings(req, res) {
    sendData(res, await service.getBranchSettings(req.auth, req.valid.params.id));
  },
  async updateSettings(req, res) {
    sendData(
      res,
      await service.updateBranchSettings(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body),
      { message: 'Branch settings updated.' },
    );
  },
};
