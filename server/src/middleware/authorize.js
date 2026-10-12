const AppError = require('../errors/AppError');

/** Requires every listed permission. */
function requirePermission(...codes) {
  return (req, res, next) => {
    const missing = codes.filter((code) => !req.auth.permissions.has(code));
    if (missing.length > 0) throw AppError.forbidden();
    next();
  };
}

/** Requires at least one of the listed permissions. */
function requireAnyPermission(...codes) {
  return (req, res, next) => {
    if (!codes.some((code) => req.auth.permissions.has(code))) throw AppError.forbidden();
    next();
  };
}

module.exports = { requirePermission, requireAnyPermission };
