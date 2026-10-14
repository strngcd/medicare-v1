const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');

const COLUMNS = `
  c.id, c.name, c.description, c.product_type, c.status, c.created_at, c.updated_at,
  c.created_by, c.updated_by, c.archived_at, c.archived_by,
  (SELECT count(*) FROM medicines m WHERE m.category_id = c.id AND m.status <> 'ARCHIVED') AS medicine_count`;

async function list({ status, productType, search, limit, offset, orderBy }) {
  const w = whereBuilder();
  if (status) w.add('c.status = ?', status);
  if (productType) w.add('c.product_type = ?', productType);
  if (search) w.add('c.name ILIKE ?', `%${search}%`);
  const { rows } = await query(
    `SELECT ${COLUMNS}, count(*) OVER() AS total_count
       FROM medicine_categories c ${w.sql}
      ORDER BY ${orderBy}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function findById(id, client, { forUpdate = false } = {}) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM medicine_categories c WHERE c.id = $1 ${forUpdate ? 'FOR UPDATE OF c' : ''}`,
    [id],
    client,
  );
  return rows[0] || null;
}

async function nameExists(client, name, excludeId = null) {
  const { rows } = await query(
    'SELECT 1 FROM medicine_categories WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2)',
    [name, excludeId],
    client,
  );
  return rows.length > 0;
}

async function insert(client, { name, description, productType }, actorId) {
  const { rows } = await query(
    `INSERT INTO medicine_categories (name, description, product_type, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`,
    [name, description ?? null, productType || 'MEDICINE', actorId],
    client,
  );
  return rows[0].id;
}

async function update(client, id, { name, description }, actorId) {
  await query(
    `UPDATE medicine_categories
        SET name = COALESCE($2, name),
            description = CASE WHEN $4 THEN $3 ELSE description END,
            updated_by = $5
      WHERE id = $1`,
    [id, name ?? null, description ?? null, description !== undefined, actorId],
    client,
  );
}

async function setStatus(client, id, status, actorId) {
  await query(
    `UPDATE medicine_categories
        SET status = $2, updated_by = $3,
            archived_at = CASE WHEN $2 = 'ARCHIVED' THEN now() ELSE NULL END,
            archived_by = CASE WHEN $2 = 'ARCHIVED' THEN $3::uuid ELSE NULL END
      WHERE id = $1`,
    [id, status, actorId],
    client,
  );
}

module.exports = { list, findById, nameExists, insert, update, setStatus };
