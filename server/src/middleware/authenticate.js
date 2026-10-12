const config = require('../config');
const AppError = require('../errors/AppError');
const { findActiveSession, touchSession } = require('../auth/sessions');
const { loadAuthContext } = require('../auth/authContext');
const { hashToken, safeEqualHex } = require('../utils/crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Authenticates the session cookie, loads the user, verifies the account is
 * active and computes effective permissions. Unsafe methods must also carry
 * a CSRF token bound to the session (double-submit, verified server-side).
 */
async function authenticate(req, res, next) {
  const token = req.cookies ? req.cookies[config.security.sessionCookieName] : null;
  if (!token) throw AppError.unauthenticated();

  const session = await findActiveSession(token);
  if (!session) throw AppError.unauthenticated('Your session has ended. Please sign in again.');

  if (!SAFE_METHODS.has(req.method)) {
    const headerToken = req.get(config.security.csrfHeaderName);
    if (!headerToken || !safeEqualHex(hashToken(headerToken), session.csrf_token_hash)) {
      throw AppError.forbidden('CSRF_TOKEN_INVALID', 'Security token is missing or invalid. Please reload the page.');
    }
  }

  const auth = await loadAuthContext(session.user_id);
  if (!auth || auth.status !== 'ACTIVE') {
    throw AppError.unauthenticated('Your account is inactive.');
  }

  auth.sessionId = session.id;
  req.auth = auth;
  touchSession(session.id).catch(() => {});
  next();
}

module.exports = authenticate;
