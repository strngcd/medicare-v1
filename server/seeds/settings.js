/**
 * Creates the single global settings row with its documented defaults
 * (country Ethiopia, currency ETB, 30-day expiry warning, tax disabled).
 * Existing settings are never overwritten.
 */
async function seedSettings(client) {
  await client.query('INSERT INTO system_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
}

module.exports = { seedSettings };
