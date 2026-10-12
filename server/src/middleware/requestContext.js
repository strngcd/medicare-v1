/**
 * Captures request metadata used by audit logs and login history.
 */
function requestContext(req, res, next) {
  req.context = {
    ipAddress: req.ip || null,
    userAgent: (req.get('user-agent') || '').slice(0, 500) || null,
  };
  next();
}

module.exports = requestContext;
