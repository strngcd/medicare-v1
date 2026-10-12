const AppError = require('../errors/AppError');

/**
 * State-changing requests must be JSON. HTML forms cannot send
 * application/json cross-site without a CORS preflight, which adds a second
 * layer of CSRF protection on top of SameSite cookies and the CSRF token.
 */
function requireJson(req, res, next) {
  const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && hasBody && !req.is('application/json')) {
    throw AppError.badRequest('UNSUPPORTED_CONTENT_TYPE', 'Requests must use application/json.');
  }
  next();
}

module.exports = requireJson;
