const service = require('./suppliers.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { sendData, sendCreated, sendPage } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listSuppliers(req.valid.query));
  },
  async get(req, res) {
    sendData(res, await service.getSupplier(req.valid.params.id));
  },
  async create(req, res) {
    const result = await service.createSupplier(req.auth, actorFromRequest(req), req.valid.body);
    const message = result.warnings.similarSuppliers.length
      ? 'Supplier created. A supplier with a similar name already exists; please review.'
      : 'Supplier created.';
    sendCreated(res, result, message);
  },
  async update(req, res) {
    sendData(res, await service.updateSupplier(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body), {
      message: 'Supplier updated.',
    });
  },
  async archive(req, res) {
    sendData(res, await service.archiveSupplier(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'Supplier archived.',
    });
  },
  async restore(req, res) {
    sendData(res, await service.restoreSupplier(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'Supplier restored.',
    });
  },
};
