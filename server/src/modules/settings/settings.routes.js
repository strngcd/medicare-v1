const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const controller = require('./settings.controller');
const v = require('./settings.validators');

/** /api/v1/settings */
const settingsRouter = express.Router();
settingsRouter.use(authenticate);
settingsRouter.get('/', requirePermission(P.SETTINGS_VIEW), controller.get);
settingsRouter.patch('/', requirePermission(P.SETTINGS_EDIT), validate({ body: v.updateSettingsBody }), controller.update);

/** /api/v1/system */
const systemRouter = express.Router();
systemRouter.use(authenticate);
systemRouter.get('/info', requirePermission(P.SETTINGS_VIEW), controller.systemInfo);

module.exports = { settingsRouter, systemRouter };
