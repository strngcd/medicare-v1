/**
 * Runs versioned SQL migrations from server/migrations using node-pg-migrate.
 *
 *   node scripts/migrate.js up          apply all pending migrations
 *   node scripts/migrate.js down [n]    roll back n migrations (default 1)
 *
 * Set NODE_ENV=test to migrate the test database.
 */
const path = require('path');
const { runner } = require('node-pg-migrate');
const config = require('../src/config');

async function main() {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  const count = direction === 'down' ? Number.parseInt(process.argv[3] || '1', 10) : Infinity;

  await runner({
    databaseUrl: config.databaseUrl,
    dir: path.resolve(__dirname, '../migrations'),
    migrationsTable: 'schema_migrations',
    direction,
    count,
    singleTransaction: true,
    log: (msg) => console.log(msg),
  });
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
