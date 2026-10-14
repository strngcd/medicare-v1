const { Pool, types } = require('pg');
const config = require('../config');

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Date objects,
// so calendar dates never shift across time zones.
types.setTypeParser(types.builtins.DATE, (value) => value);
// BIGINT counts (e.g. COUNT(*)) are safe as JS numbers for our volumes.
types.setTypeParser(types.builtins.INT8, (value) => Number.parseInt(value, 10));
// NUMERIC stays a string (default) so money is never converted to a float.

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.isTest ? 10 : 20,
  // Server-side limits per session: runaway queries, lock waits behind a stuck
  // transaction, and transactions left open by a crashed request all end.
  statement_timeout: config.database.statementTimeoutMs,
  lock_timeout: config.database.lockTimeoutMs,
  idle_in_transaction_session_timeout: config.database.idleInTransactionTimeoutMs,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err.message);
});

module.exports = pool;
