/**
 * Seeds reference data: roles, permissions, role defaults, global settings,
 * starter categories, help articles and the default medicine catalog
 * (499 medicines, ACTIVE, no stock). Safe to run repeatedly.
 * It never creates users, inventory or financial activity.
 */
const { withTransaction, pool } = require('../src/database/db');
const { seedAccessControl } = require('../seeds/accessControl');
const { seedSettings } = require('../seeds/settings');
const { seedCategories } = require('../seeds/categories');
const { seedHelpArticles } = require('../seeds/helpArticles');
const { seedMedicineCatalog } = require('../seeds/medicineCatalog');

/** `catalog: false` skips the default medicines (tests start with an empty catalog). */
async function seedAll(client, { catalog = true } = {}) {
  await seedAccessControl(client);
  await seedSettings(client);
  await seedCategories(client);
  await seedHelpArticles(client);
  if (catalog) {
    const result = await seedMedicineCatalog(client);
    console.log(`Medicine catalog: ${result.created} added, ${result.adopted} matched to existing medicines, ${result.total - result.created - result.adopted} already present.`);
  }
}

if (require.main === module) {
  withTransaction((client) => seedAll(client))
    .then(() => console.log('Seed completed.'))
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { seedAll };
