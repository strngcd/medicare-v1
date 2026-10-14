const AppError = require('../errors/AppError');
const { BINARY_UPLOAD_TYPES } = require('../modules/files/files');

/**
 * State-changing requests must be JSON. HTML forms cannot send
 * application/json cross-site without a CORS preflight, which adds a second
 * layer of CSRF protection on top of SameSite cookies and the CSRF token.
 * File uploads are the exception: they send the raw file with its own type
 * (still behind the CSRF token), and only upload routes parse those bodies.
 */
function requireJson(req, res, next) {
  const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && hasBody && !req.is('application/json') && !req.is(BINARY_UPLOAD_TYPES)) {
    throw AppError.badRequest('UNSUPPORTED_CONTENT_TYPE', 'Requests must use application/json.');
  }
  next();
}

module.exports = requireJson;
