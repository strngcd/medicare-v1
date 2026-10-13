const { query } = require('../../database/db');
const { NUMBER_COLUMNS } = require('../documents/documentNumbers');

const COLUMNS = `
  pharmacy_name, logo_url, phone, email, address, city, country, website, currency_code,
  expiry_warning_days, default_markup_percent, tax_enabled, tax_name, tax_rate, tax_mode, updated_by, updated_at`;

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
  defaultMarkupPercent: 'default_markup_percent',
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
  const latest = Object.entries(NUMBER_COLUMNS).map(([type, [table, column]]) =>
    `(SELECT '${type}' AS document_type, ${column} AS number, created_at FROM ${table} ORDER BY created_at DESC LIMIT 1)`);
  const [migrations, latestNumbers, counts] = await Promise.all([
    query('SELECT name, run_on FROM schema_migrations ORDER BY run_on DESC, id DESC LIMIT 1'),
    query(latest.join(' UNION ALL ')),
    query(
      `SELECT (SELECT count(*) FROM branches WHERE status = 'ACTIVE')::int AS active_branches,
              (SELECT count(*) FROM users WHERE status = 'ACTIVE')::int AS active_users,
              (SELECT count(*) FROM medicines WHERE status = 'ACTIVE')::int AS active_medicines`,
    ),
  ]);
  return { latestMigration: migrations.rows[0] || null, latestNumbers: latestNumbers.rows, counts: counts.rows[0] };
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
