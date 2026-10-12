const service = require('./categories.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { sendData, sendCreated, sendPage } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listCategories(req.valid.query));
  },
  async create(req, res) {
    sendCreated(res, await service.createCategory(req.auth, actorFromRequest(req), req.valid.body), 'Category created.');
  },
  async update(req, res) {
    sendData(res, await service.updateCategory(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body), {
      message: 'Category updated.',
    });
  },
  async archive(req, res) {
    sendData(res, await service.archiveCategory(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'Category archived.',
    });
  },
  async restore(req, res) {
    sendData(res, await service.restoreCategory(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'Category restored.',
    });
  },
};
