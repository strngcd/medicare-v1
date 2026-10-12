const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { idParam } = require('../../validators/common');
const controller = require('./categories.controller');
const v = require('./categories.validators');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission(P.CATEGORY_VIEW), validate({ query: v.listCategoriesQuery }), controller.list);
router.post('/', requirePermission(P.CATEGORY_CREATE), validate({ body: v.createCategoryBody }), controller.create);
router.patch(
  '/:id',
  requirePermission(P.CATEGORY_EDIT),
  validate({ params: idParam, body: v.updateCategoryBody }),
  controller.update,
);
router.post('/:id/archive', requirePermission(P.CATEGORY_ARCHIVE), validate({ params: idParam }), controller.archive);
router.post('/:id/restore', requirePermission(P.CATEGORY_RESTORE), validate({ params: idParam }), controller.restore);

module.exports = router;
