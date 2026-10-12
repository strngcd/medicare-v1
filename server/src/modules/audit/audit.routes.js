const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { z, uuid, idParam, isoDate, listQuery, queryBoolean } = require('../../validators/common');
const controller = require('./audit.controller');

const auditQuery = listQuery.extend({
  userId: uuid.optional(),
  branchId: uuid.optional(),
  action: z.string().max(60).optional(),
  entityType: z.string().max(60).optional(),
  entityId: uuid.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

const loginHistoryQuery = listQuery.extend({
  userId: uuid.optional(),
  eventType: z.enum(['LOGIN', 'LOGOUT']).optional(),
  success: queryBoolean.optional(),
  failureCategory: z.enum(['INVALID_CREDENTIALS', 'ACCOUNT_INACTIVE', 'RATE_LIMITED', 'INVALID_RESET_FLOW', 'OTHER']).optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

/** /api/v1/audit-logs */
const auditRouter = express.Router();
auditRouter.use(authenticate, requirePermission(P.AUDIT_LOG_VIEW));
auditRouter.get('/', validate({ query: auditQuery }), controller.list);
auditRouter.get('/actions', controller.actions);
auditRouter.get('/:id', validate({ params: idParam }), controller.get);

/** /api/v1/login-history */
const loginHistoryRouter = express.Router();
loginHistoryRouter.use(authenticate, requirePermission(P.LOGIN_HISTORY_VIEW));
loginHistoryRouter.get('/', validate({ query: loginHistoryQuery }), controller.loginHistory);

module.exports = { auditRouter, loginHistoryRouter };
