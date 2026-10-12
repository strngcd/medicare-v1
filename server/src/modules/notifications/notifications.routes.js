const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { z, idParam, listQuery, queryBoolean } = require('../../validators/common');
const controller = require('./notifications.controller');

const listNotificationsQuery = listQuery.extend({
  unreadOnly: queryBoolean.optional(),
  type: z.string().max(60).optional(),
});

const router = express.Router();
// Users only ever see and change their own notifications.
router.use(authenticate, requirePermission(P.NOTIFICATION_VIEW));

router.get('/', validate({ query: listNotificationsQuery }), controller.list);
router.get('/unread-count', controller.unreadCount);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', validate({ params: idParam }), controller.markRead);
router.patch('/:id/dismiss', validate({ params: idParam }), controller.dismiss);

module.exports = router;
