const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');

const COLUMNS = `
  m.id, m.product_type, m.name, m.generic_name, m.brand_name, m.category_id, c.name AS category_name,
  m.manufacturer, m.country_of_origin, m.strength, m.dosage_form, m.package_size,
  m.prescription_required, m.description, m.storage_instructions, m.barcode, m.status,
  m.created_by, m.updated_by, m.created_at, m.updated_at, m.archived_at, m.archived_by`;

/**
 * Stock summary per medicine within a branch scope. `$today` is the business
 * date: batches expiring before it are not sellable.
 */
function stockSummarySql(branchParam, todayParam) {
  return `
    LEFT JOIN LATERAL (
      SELECT COALESCE(sum(bi.quantity), 0)::int AS total_quantity,
             COALESCE(sum(bi.quantity) FILTER (WHERE b.expiry_date >= ${todayParam}), 0)::int AS sellable_quantity,
             COALESCE(sum(bi.minimum_stock), 0)::int AS minimum_stock
        FROM batches b
        JOIN branch_inventory bi ON bi.batch_id = b.id
       WHERE b.medicine_id = m.id
         AND (${branchParam}::uuid[] IS NULL OR bi.branch_id = ANY(${branchParam}::uuid[]))
    ) stock ON true`;
}

async function list({ branchIds, today, search, categoryId, status, prescriptionRequired, productType, limit, offset, orderBy }) {
  const w = whereBuilder([branchIds, today]);
  if (search) {
    w.add(
      '(m.name ILIKE ? OR m.generic_name ILIKE ? OR m.brand_name ILIKE ? OR m.barcode = ?)',
      `%${search}%`, `%${search}%`, `%${search}%`, search,
    );
  }
  if (categoryId) w.add('m.category_id = ?', categoryId);
  if (status) w.add('m.status = ?', status);
  if (prescriptionRequired !== undefined) w.add('m.prescription_required = ?', prescriptionRequired);
  if (productType) w.add('m.product_type = ?', productType);

  const { rows } = await query(
    `SELECT ${COLUMNS}, stock.total_quantity, stock.sellable_quantity, stock.minimum_stock,
            count(*) OVER() AS total_count
       FROM medicines m
       LEFT JOIN medicine_categories c ON c.id = m.category_id
       ${stockSummarySql('$1', '$2')}
       ${w.sql}
      ORDER BY ${orderBy}
      LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function findById(id, client, { forUpdate = false, branchIds = null, today = null } = {}) {
  const { rows } = await query(
    `SELECT ${COLUMNS}, stock.total_quantity, stock.sellable_quantity, stock.minimum_stock
       FROM medicines m
       LEFT JOIN medicine_categories c ON c.id = m.category_id
       ${stockSummarySql('$2', '$3')}
      WHERE m.id = $1 ${forUpdate ? 'FOR UPDATE OF m' : ''}`,
    [id, branchIds, today || '1970-01-01'],
    client,
  );
  return rows[0] || null;
}

/**
 * POS search: active medicines by name/generic/brand or exact barcode, with
 * the branch's sellable quantity and the selling price of the next FEFO batch.
 */
async function searchForSale({ branchId, today, term, categoryId, productType, limit }) {
  // $1 branch, $2 business date, $3 search term (may be null).
  const w = whereBuilder([branchId, today, term || null]);
  w.add("m.status = 'ACTIVE'");
  if (term) {
    w.add('(m.barcode = $3 OR m.name ILIKE ? OR m.generic_name ILIKE ? OR m.brand_name ILIKE ?)', `%${term}%`, `%${term}%`, `%${term}%`);
  }
  if (categoryId) w.add('m.category_id = ?', categoryId);
  if (productType) w.add('m.product_type = ?', productType);

  const { rows } = await query(
    `SELECT m.id, m.product_type, m.name, m.generic_name, m.brand_name, m.strength, m.dosage_form, m.package_size,
            m.prescription_required, m.barcode, m.category_id, c.name AS category_name,
            COALESCE(stock.sellable_quantity, 0) AS sellable_quantity,
            stock.next_price, stock.min_price, stock.max_price,
            (m.barcode IS NOT NULL AND m.barcode = $3) AS barcode_match
       FROM medicines m
       LEFT JOIN medicine_categories c ON c.id = m.category_id
       LEFT JOIN LATERAL (
         SELECT sum(bi.quantity)::int AS sellable_quantity,
                (array_agg(bi.selling_price ORDER BY b.expiry_date, b.created_at))[1] AS next_price,
                min(bi.selling_price) AS min_price,
                max(bi.selling_price) AS max_price
           FROM batches b JOIN branch_inventory bi ON bi.batch_id = b.id
          WHERE b.medicine_id = m.id AND bi.branch_id = $1 AND bi.quantity > 0 AND b.expiry_date >= $2
       ) stock ON true
       ${w.sql}
      ORDER BY barcode_match DESC, (COALESCE(stock.sellable_quantity, 0) > 0) DESC, m.name
      LIMIT ${w.param(limit)}`,
    w.params,
  );
  return rows;
}

async function findDuplicates(client, { name, strength, dosageForm, packageSize }, excludeId = null) {
  const { rows } = await query(
    `SELECT id, name, strength, dosage_form, package_size, status
       FROM medicines
      WHERE lower(name) = lower($1)
        AND lower(coalesce(strength, '')) = lower(coalesce($2, ''))
        AND lower(coalesce(dosage_form, '')) = lower(coalesce($3, ''))
        AND lower(package_size) = lower($4)
        AND ($5::uuid IS NULL OR id <> $5)`,
    [name, strength ?? null, dosageForm ?? null, packageSize, excludeId],
    client,
  );
  return rows;
}

async function barcodeOwner(client, barcode, excludeId = null) {
  const { rows } = await query(
    'SELECT id, name FROM medicines WHERE barcode = $1 AND ($2::uuid IS NULL OR id <> $2)',
    [barcode, excludeId],
    client,
  );
  return rows[0] || null;
}

async function findCategory(client, id) {
  const { rows } = await query('SELECT id, name, status, product_type FROM medicine_categories WHERE id = $1', [id], client);
  return rows[0] || null;
}

const FIELD_COLUMNS = {
  productType: 'product_type',
  name: 'name',
  genericName: 'generic_name',
  brandName: 'brand_name',
  categoryId: 'category_id',
  manufacturer: 'manufacturer',
  countryOfOrigin: 'country_of_origin',
  strength: 'strength',
  dosageForm: 'dosage_form',
  packageSize: 'package_size',
  prescriptionRequired: 'prescription_required',
  description: 'description',
  storageInstructions: 'storage_instructions',
  barcode: 'barcode',
};

async function insert(client, data, actorId) {
  const columns = [];
  const values = [];
  for (const [key, column] of Object.entries(FIELD_COLUMNS)) {
    if (data[key] !== undefined) {
      columns.push(column);
      values.push(data[key]);
    }
  }
  columns.push('created_by', 'updated_by');
  values.push(actorId, actorId);
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  const { rows } = await query(
    `INSERT INTO medicines (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
    values,
    client,
  );
  return rows[0].id;
}

async function update(client, id, changes, actorId) {
  const sets = [];
  const params = [id, actorId];
  for (const [key, column] of Object.entries(FIELD_COLUMNS)) {
    if (changes[key] !== undefined) {
      params.push(changes[key]);
      sets.push(`${column} = $${params.length}`);
    }
  }
  if (changes.status !== undefined) {
    params.push(changes.status);
    sets.push(`status = $${params.length}`);
  }
  if (sets.length === 0) return;
  sets.push('updated_by = $2');
  await query(`UPDATE medicines SET ${sets.join(', ')} WHERE id = $1`, params, client);
}

async function setArchived(client, id, archived, actorId) {
  await query(
    `UPDATE medicines
        SET status = CASE WHEN $2 THEN 'ARCHIVED' ELSE 'ACTIVE' END,
            archived_at = CASE WHEN $2 THEN now() ELSE NULL END,
            archived_by = CASE WHEN $2 THEN $3::uuid ELSE NULL END,
            updated_by = $3
      WHERE id = $1`,
    [id, archived, actorId],
    client,
  );
}

module.exports = {
  list,
  findById,
  searchForSale,
  findDuplicates,
  barcodeOwner,
  findCategory,
  insert,
  update,
  setArchived,
};
