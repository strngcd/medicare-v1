/**
 * An expected, client-facing error with a stable machine-readable code.
 * Anything that is not an AppError is treated as an unexpected 500.
 */
class AppError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  static badRequest(code, message, details) {
    return new AppError(code, message, 400, details);
  }

  static unauthenticated(message = 'Authentication is required.') {
    return new AppError('UNAUTHENTICATED', message, 401);
  }

  static forbidden(code = 'PERMISSION_DENIED', message = 'You do not have permission to perform this action.', details) {
    return new AppError(code, message, 403, details);
  }

  static notFound(message = 'The requested resource was not found.') {
    return new AppError('RESOURCE_NOT_FOUND', message, 404);
  }

  static conflict(code, message, details) {
    return new AppError(code, message, 409, details);
  }

  static validation(message = 'Validation failed.', details) {
    return new AppError('VALIDATION_ERROR', message, 422, details);
  }

  static rateLimited(message = 'Too many attempts. Please try again later.') {
    return new AppError('RATE_LIMITED', message, 429);
  }
}

module.exports = AppError;
