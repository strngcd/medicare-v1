/**
 * Seeds reference data: roles, permissions, role defaults, global settings,
 * starter categories and help articles. Safe to run repeatedly.
 * It never creates users, inventory or financial activity.
 */
const { withTransaction, pool } = require('../src/database/db');
const { seedAccessControl } = require('../seeds/accessControl');
const { seedSettings } = require('../seeds/settings');
const { seedCategories } = require('../seeds/categories');
const { seedHelpArticles } = require('../seeds/helpArticles');

async function seedAll(client) {
  await seedAccessControl(client);
  await seedSettings(client);
  await seedCategories(client);
  await seedHelpArticles(client);
}

if (require.main === module) {
  withTransaction(seedAll)
    .then(() => console.log('Seed completed.'))
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { seedAll };
