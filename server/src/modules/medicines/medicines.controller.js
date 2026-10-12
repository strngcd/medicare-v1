const service = require('./medicines.service');
const { actorFromRequest } = require('../audit/audit.recorder');
const { sendData, sendCreated, sendPage } = require('../../utils/response');

module.exports = {
  async list(req, res) {
    sendPage(res, await service.listMedicines(req.auth, req.valid.query));
  },
  async search(req, res) {
    sendData(res, await service.searchForSale(req.auth, req.valid.query));
  },
  async get(req, res) {
    sendData(res, await service.getMedicine(req.auth, req.valid.params.id, req.valid.query.branchId));
  },
  async create(req, res) {
    const result = await service.createMedicine(req.auth, actorFromRequest(req), req.valid.body);
    const message = result.warnings.duplicates.length
      ? 'Medicine created. A similar medicine already exists; please review.'
      : 'Medicine created as draft.';
    sendCreated(res, result, message);
  },
  async update(req, res) {
    sendData(res, await service.updateMedicine(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body), {
      message: 'Medicine updated.',
    });
  },
  async changeBarcode(req, res) {
    sendData(
      res,
      await service.changeBarcode(req.auth, actorFromRequest(req), req.valid.params.id, req.valid.body.barcode),
      { message: 'Barcode updated.' },
    );
  },
  async archive(req, res) {
    sendData(res, await service.archiveMedicine(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'Medicine archived.',
    });
  },
  async restore(req, res) {
    sendData(res, await service.restoreMedicine(req.auth, actorFromRequest(req), req.valid.params.id), {
      message: 'Medicine restored.',
    });
  },
};
