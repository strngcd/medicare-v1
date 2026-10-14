const { ZodError } = require('zod');
const AppError = require('../errors/AppError');

// PostgreSQL error codes we translate into safe, stable API errors.
const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';
const PG_CHECK_VIOLATION = '23514';
const PG_SERIALIZATION_FAILURE = '40001';
const PG_DEADLOCK_DETECTED = '40P01';
const PG_INVALID_TEXT_REPRESENTATION = '22P02';
// Raised by the pool's safety limits (see database/pool.js).
const PG_QUERY_CANCELED = '57014'; // statement_timeout
const PG_LOCK_NOT_AVAILABLE = '55P03'; // lock_timeout
const PG_IDLE_IN_TRANSACTION_TIMEOUT = '25P03';

function fromZodError(err) {
  const fields = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return AppError.validation('Some fields are invalid.', { fields });
}

function fromPostgresError(err) {
  switch (err.code) {
    case PG_UNIQUE_VIOLATION:
      return AppError.conflict('DUPLICATE_RECORD', 'A record with the same unique value already exists.');
    case PG_FOREIGN_KEY_VIOLATION:
      return AppError.validation('A referenced record does not exist.');
    case PG_CHECK_VIOLATION:
      return AppError.validation('The request violates a data rule.');
    case PG_SERIALIZATION_FAILURE:
    case PG_DEADLOCK_DETECTED:
      return AppError.conflict('CONCURRENT_UPDATE', 'The record was changed by another operation. Please retry.');
    case PG_LOCK_NOT_AVAILABLE:
      return AppError.conflict('RECORD_BUSY', 'Another operation is using this record. Please retry in a moment.');
    case PG_QUERY_CANCELED:
    case PG_IDLE_IN_TRANSACTION_TIMEOUT:
      return new AppError('SERVICE_BUSY', 'The system took too long to respond. Please retry; narrow the date range for large reports.', 503);
    case PG_INVALID_TEXT_REPRESENTATION:
      return AppError.badRequest('INVALID_IDENTIFIER', 'An identifier in the request is malformed.');
    default:
      return null;
  }
}

function toAppError(err) {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) return fromZodError(err);
  if (err && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) {
    return fromPostgresError(err);
  }
  if (err && err.type === 'entity.parse.failed') {
    return AppError.badRequest('MALFORMED_REQUEST', 'The request body is not valid JSON.');
  }
  if (err && err.type === 'entity.too.large') {
    return AppError.badRequest('PAYLOAD_TOO_LARGE', 'The request body is too large.');
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const appError = toAppError(err);

  if (!appError) {
    // Always logged (tests included): a 500 is never an expected outcome.
    console.error(`[${new Date().toISOString()}] Unhandled error on ${req.method} ${req.originalUrl}`, err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred. Please try again.',
        details: {},
      },
    });
  }

  return res.status(appError.status).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      details: appError.details || {},
    },
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'The requested endpoint does not exist.',
      details: {},
    },
  });
}

module.exports = { errorHandler, notFoundHandler, toAppError };
