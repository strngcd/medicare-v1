const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const controller = require('./auth.controller');
const v = require('./auth.validators');

const router = express.Router();

router.post('/login', validate({ body: v.loginBody }), controller.login);
router.post('/forgot-password', validate({ body: v.forgotPasswordBody }), controller.forgotPassword);
router.post('/reset-password', validate({ body: v.resetPasswordBody }), controller.resetPassword);

router.post('/logout', authenticate, controller.logout);
router.post('/change-password', authenticate, validate({ body: v.changePasswordBody }), controller.changePassword);
router.get('/me', authenticate, controller.me);

module.exports = router;
