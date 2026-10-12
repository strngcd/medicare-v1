const pool = require('./pool');

/**
 * Run a single query on the shared pool, or on the given transaction client.
 * Repositories accept an optional `client` so they can participate in a
 * service-owned transaction.
 */
function query(text, params, client) {
  return (client || pool).query(text, params);
}

/**
 * Run `work(client)` inside a database transaction.
 * Commits when `work` resolves, rolls back when it throws.
 */
async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, withTransaction, pool };
