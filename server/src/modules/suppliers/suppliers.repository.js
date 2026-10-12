const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');

const NORMALIZED_NAME = "lower(regexp_replace(trim(s.company_name), '\\s+', ' ', 'g'))";

const COLUMNS = `
  s.id, s.company_name, s.phone, s.contact_person, s.email, s.address, s.notes, s.status,
  s.created_by, s.updated_by, s.created_at, s.updated_at, s.archived_at, s.archived_by`;

async function list({ status, search, limit, offset, orderBy }) {
  const w = whereBuilder();
  if (status) w.add('s.status = ?', status);
  if (search) w.add('(s.company_name ILIKE ? OR s.contact_person ILIKE ? OR s.phone ILIKE ?)', `%${search}%`, `%${search}%`, `%${search}%`);
  const { rows } = await query(
    `SELECT ${COLUMNS}, count(*) OVER() AS total_count
       FROM suppliers s ${w.sql}
      ORDER BY ${orderBy}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function findById(id, client, { forUpdate = false } = {}) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM suppliers s WHERE s.id = $1 ${forUpdate ? 'FOR UPDATE OF s' : ''}`,
    [id],
    client,
  );
  return rows[0] || null;
}

/** Suppliers whose normalized company name matches (warning only). */
async function findSimilar(client, companyName, excludeId = null) {
  const { rows } = await query(
    `SELECT s.id, s.company_name, s.phone, s.status
       FROM suppliers s
      WHERE ${NORMALIZED_NAME} = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
        AND ($2::uuid IS NULL OR s.id <> $2)`,
    [companyName, excludeId],
    client,
  );
  return rows;
}

const FIELD_COLUMNS = {
  companyName: 'company_name',
  phone: 'phone',
  contactPerson: 'contact_person',
  email: 'email',
  address: 'address',
  notes: 'notes',
};

async function insert(client, data, actorId) {
  const { rows } = await query(
    `INSERT INTO suppliers (company_name, phone, contact_person, email, address, notes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
    [data.companyName, data.phone, data.contactPerson ?? null, data.email ?? null, data.address ?? null, data.notes ?? null, actorId],
    client,
  );
  return rows[0].id;
}

async function update(client, id, changes, actorId) {
  const sets = ['updated_by = $2'];
  const params = [id, actorId];
  for (const [key, column] of Object.entries(FIELD_COLUMNS)) {
    if (changes[key] !== undefined) {
      params.push(changes[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  await query(`UPDATE suppliers SET ${sets.join(', ')} WHERE id = $1`, params, client);
}

async function setStatus(client, id, status, actorId) {
  await query(
    `UPDATE suppliers
        SET status = $2, updated_by = $3,
            archived_at = CASE WHEN $2 = 'ARCHIVED' THEN now() ELSE NULL END,
            archived_by = CASE WHEN $2 = 'ARCHIVED' THEN $3::uuid ELSE NULL END
      WHERE id = $1`,
    [id, status, actorId],
    client,
  );
}

module.exports = { list, findById, findSimilar, insert, update, setStatus };
