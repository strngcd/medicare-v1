const { pool, withTransaction } = require('../../src/database/db');
const { seedAll } = require('../../scripts/seed');
const { seedSettings } = require('../../seeds/settings');
const { seedCategories } = require('../../seeds/categories');

// Static reference data that tests never modify; kept between resets for speed.
const PRESERVED_TABLES = new Set(['schema_migrations', 'roles', 'permissions', 'role_permissions', 'help_articles']);

let referenceDataSeeded = false;

/**
 * Empties every application table (TRUNCATE bypasses the row-level
 * append-only triggers, which is exactly what a test reset needs) and
 * restores seeded settings and categories.
 */
async function resetDatabase() {
  const { rows } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  const tables = rows.map((r) => r.tablename).filter((t) => !PRESERVED_TABLES.has(t));
  await pool.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

  if (!referenceDataSeeded) {
    await withTransaction(seedAll);
    referenceDataSeeded = true;
  } else {
    await withTransaction(async (client) => {
      await seedSettings(client);
      await seedCategories(client);
    });
  }
}

module.exports = { resetDatabase, pool };
