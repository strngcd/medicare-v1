const service = require('./auth.service');
const { setAuthCookies, clearAuthCookies } = require('../../auth/cookies');
const { sendData } = require('../../utils/response');

async function login(req, res) {
  const { tokens, payload } = await service.login(req.valid.body, req.context);
  setAuthCookies(res, tokens);
  sendData(res, payload, { message: 'Signed in successfully.' });
}

async function logout(req, res) {
  await service.logout(req.auth, req.context);
  clearAuthCookies(res);
  sendData(res, null, { message: 'Signed out successfully.' });
}

async function forgotPassword(req, res) {
  await service.forgotPassword(req.valid.body);
  sendData(res, null, {
    message: 'If an active account uses that email, a password reset link has been sent.',
  });
}

async function resetPassword(req, res) {
  await service.resetPassword(req.valid.body, req.context);
  clearAuthCookies(res);
  sendData(res, null, { message: 'Your password has been set. You can now sign in.' });
}

async function changePassword(req, res) {
  await service.changePassword(req.auth, req.valid.body);
  sendData(res, null, { message: 'Password changed. Other sessions were signed out.' });
}

async function me(req, res) {
  sendData(res, await service.buildSessionPayload(req.auth));
}

module.exports = { login, logout, forgotPassword, resetPassword, changePassword, me };
