const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { z, uuid } = require('../../validators/common');
const { sendData } = require('../../utils/response');
const service = require('./search.service');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  validate({ query: z.object({ q: z.string().trim().min(2, 'Type at least 2 characters.').max(100), branchId: uuid.optional() }) }),
  async (req, res) => {
    sendData(res, await service.globalSearch(req.auth, req.valid.query.q, req.valid.query.branchId));
  },
);

module.exports = router;
