const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function readInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }
  return value;
}

function readBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes'].includes(raw.toLowerCase());
}

const env = process.env.NODE_ENV || 'development';
const isTest = env === 'test';
const isProduction = env === 'production';

const databaseUrl = isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(`${isTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not configured`);
}

const config = Object.freeze({
  env,
  isTest,
  isProduction,
  port: readInt('PORT', 4000),
  databaseUrl,
  // Safety limits on every pooled connection, so one stuck request cannot hold
  // stock-row locks or connections indefinitely (0 disables a limit).
  database: Object.freeze({
    statementTimeoutMs: readInt('DB_STATEMENT_TIMEOUT_MS', 30000),
    lockTimeoutMs: readInt('DB_LOCK_TIMEOUT_MS', 10000),
    idleInTransactionTimeoutMs: readInt('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 60000),
  }),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
  businessTimezone: process.env.BUSINESS_TIMEZONE || 'Africa/Addis_Ababa',
  trustProxy: readInt('TRUST_PROXY', 0),
  security: Object.freeze({
    sessionCookieName: process.env.SESSION_COOKIE_NAME || 'medicar_sid',
    csrfHeaderName: 'x-csrf-token',
    bcryptRounds: isTest ? 4 : readInt('BCRYPT_ROUNDS', 12),
    passwordResetTtlMinutes: readInt('PASSWORD_RESET_TTL_MINUTES', 60),
    accountSetupTtlHours: readInt('ACCOUNT_SETUP_TTL_HOURS', 72),
    loginRateLimitMaxAttempts: readInt('LOGIN_RATE_LIMIT_MAX_ATTEMPTS', 5),
    loginRateLimitWindowMinutes: readInt('LOGIN_RATE_LIMIT_WINDOW_MINUTES', 15),
  }),
  smtp: Object.freeze({
    host: process.env.SMTP_HOST || '',
    port: readInt('SMTP_PORT', 587),
    secure: readBool('SMTP_SECURE', false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'Medicar <no-reply@example.com>',
  }),
  pagination: Object.freeze({ defaultLimit: 25, maxLimit: 100 }),
  // Largest report export; bigger ones are refused with a clear message (never cut short).
  exportMaxRows: readInt('EXPORT_MAX_ROWS', 100000),
});

module.exports = config;
