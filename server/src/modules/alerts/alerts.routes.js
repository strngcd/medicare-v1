const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { z, uuid, listQuery } = require('../../validators/common');
const controller = require('./alerts.controller');

const TYPES = ['EXPIRED', 'EXPIRING_SOON', 'OUT_OF_STOCK', 'LOW_STOCK'];
const listAlertsQuery = listQuery.extend({
  branchId: uuid.optional(),
  type: z.enum(TYPES).optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'WARNING']).optional(),
});
const alertIdParam = z.object({
  id: z.string().regex(/^(EXPIRED|EXPIRING_SOON|OUT_OF_STOCK|LOW_STOCK):[0-9a-f-]{36}(:[0-9a-f-]{36})?$/, 'Invalid alert id.'),
});

const router = express.Router();
router.use(authenticate, requirePermission(P.ALERT_VIEW));

router.get('/', validate({ query: listAlertsQuery }), controller.list);
router.get('/count', validate({ query: z.object({ branchId: uuid.optional() }) }), controller.count);
router.get('/:id', validate({ params: alertIdParam }), controller.get);

module.exports = router;
