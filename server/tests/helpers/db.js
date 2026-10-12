const { pool, withTransaction } = require('../../src/database/db');
const { seedAll } = require('../../scripts/seed');

/**
 * Empties every application table (TRUNCATE bypasses the row-level
 * append-only triggers, which is exactly what a test reset needs) and
 * re-seeds reference data.
 */
async function resetDatabase() {
  const { rows } = await pool.query(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  await withTransaction(seedAll);
}

module.exports = { resetDatabase, pool };
