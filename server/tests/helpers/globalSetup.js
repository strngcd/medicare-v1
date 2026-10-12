/**
 * Brings the test database schema up to date once before the test run.
 */
const path = require('path');

module.exports = async function globalSetup() {
  process.env.NODE_ENV = 'test';
  const { runner } = require('node-pg-migrate');
  const config = require('../../src/config');
  await runner({
    databaseUrl: config.databaseUrl,
    dir: path.resolve(__dirname, '../../migrations'),
    migrationsTable: 'schema_migrations',
    direction: 'up',
    count: Infinity,
    singleTransaction: true,
    log: () => {},
  });
};
