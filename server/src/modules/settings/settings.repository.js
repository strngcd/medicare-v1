const { query } = require('../../database/db');

const COLUMNS = `
  pharmacy_name, logo_url, phone, email, address, city, country, website, currency_code,
  expiry_warning_days, tax_enabled, tax_name, tax_rate, tax_mode, updated_by, updated_at`;

const FIELD_COLUMNS = {
  pharmacyName: 'pharmacy_name',
  logoUrl: 'logo_url',
  phone: 'phone',
  email: 'email',
  address: 'address',
  city: 'city',
  country: 'country',
  website: 'website',
  currencyCode: 'currency_code',
  expiryWarningDays: 'expiry_warning_days',
  taxEnabled: 'tax_enabled',
  taxName: 'tax_name',
  taxRate: 'tax_rate',
  taxMode: 'tax_mode',
};

async function get(client, { forUpdate = false } = {}) {
  const { rows } = await query(`SELECT ${COLUMNS} FROM system_settings WHERE id = 1 ${forUpdate ? 'FOR UPDATE' : ''}`, [], client);
  return rows[0];
}

async function update(client, changes, userId) {
  const sets = ['updated_by = $1'];
  const params = [userId];
  for (const [key, column] of Object.entries(FIELD_COLUMNS)) {
    if (changes[key] !== undefined) {
      params.push(changes[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  await query(`UPDATE system_settings SET ${sets.join(', ')} WHERE id = 1`, params, client);
}

async function systemInfo() {
  const [migrations, sequences, counts] = await Promise.all([
    query('SELECT name, run_on FROM schema_migrations ORDER BY run_on DESC, id DESC LIMIT 1'),
    query('SELECT sequence_type, year, last_value, updated_at FROM document_sequences ORDER BY year DESC, sequence_type'),
    query(
      `SELECT (SELECT count(*) FROM branches WHERE status = 'ACTIVE')::int AS active_branches,
              (SELECT count(*) FROM users WHERE status = 'ACTIVE')::int AS active_users,
              (SELECT count(*) FROM medicines WHERE status = 'ACTIVE')::int AS active_medicines`,
    ),
  ]);
  return { latestMigration: migrations.rows[0] || null, sequences: sequences.rows, counts: counts.rows[0] };
}

/** Active Owners and Admins, who are told about important configuration changes. */
async function listAdministrators(client, excludeUserId) {
  const { rows } = await query(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.status = 'ACTIVE' AND r.code IN ('OWNER', 'ADMIN') AND u.id <> $1`,
    [excludeUserId],
    client,
  );
  return rows.map((r) => r.id);
}

module.exports = { get, update, systemInfo, listAdministrators };
