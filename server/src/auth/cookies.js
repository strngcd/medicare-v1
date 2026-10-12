const config = require('../config');

const CSRF_COOKIE_NAME = 'medicar_csrf';

function baseOptions() {
  return {
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/',
    // No maxAge/expires: a browser-session cookie. There is no "remember me".
  };
}

function setAuthCookies(res, { sessionToken, csrfToken }) {
  res.cookie(config.security.sessionCookieName, sessionToken, { ...baseOptions(), httpOnly: true });
  // Readable by the SPA so it can echo the value in the X-CSRF-Token header.
  res.cookie(CSRF_COOKIE_NAME, csrfToken, { ...baseOptions(), httpOnly: false });
}

function clearAuthCookies(res) {
  res.clearCookie(config.security.sessionCookieName, { ...baseOptions(), httpOnly: true });
  res.clearCookie(CSRF_COOKIE_NAME, { ...baseOptions(), httpOnly: false });
}

module.exports = { setAuthCookies, clearAuthCookies, CSRF_COOKIE_NAME };
