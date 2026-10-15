const { query } = require('../../database/db');
const { whereBuilder } = require('../../utils/pagination');

const COLUMNS = `
  t.id, t.transfer_number, t.source_branch_id, sb.name AS source_branch_name, sb.code AS source_branch_code,
  t.destination_branch_id, db.name AS destination_branch_name, db.code AS destination_branch_code,
  t.status, t.created_by, cu.full_name AS created_by_name, t.requested_by, t.requested_at,
  t.approved_by, au.full_name AS approved_by_name, t.approved_at,
  t.shipped_by, su.full_name AS shipped_by_name, t.shipped_at,
  t.received_by, ru.full_name AS received_by_name, t.received_at,
  t.cancelled_by, t.cancelled_at, t.cancel_reason, t.notes, t.created_at, t.updated_at,
  t.discrepancy_quantity, t.discrepancy_reason, t.discrepancy_recorded_by, t.discrepancy_recorded_at`;

const FROM = `
  transfers t
  JOIN branches sb ON sb.id = t.source_branch_id
  JOIN branches db ON db.id = t.destination_branch_id
  JOIN users cu ON cu.id = t.created_by
  LEFT JOIN users au ON au.id = t.approved_by
  LEFT JOIN users su ON su.id = t.shipped_by
  LEFT JOIN users ru ON ru.id = t.received_by`;

async function list({ branchIds, status, sourceBranchId, destinationBranchId, dateFrom, dateTo, timezone, search, limit, offset, orderBy }) {
  const w = whereBuilder();
  if (branchIds) w.add('(t.source_branch_id = ANY(?::uuid[]) OR t.destination_branch_id = ANY(?::uuid[]))', branchIds, branchIds);
  if (status) w.add('t.status = ?', status);
  if (sourceBranchId) w.add('t.source_branch_id = ?', sourceBranchId);
  if (destinationBranchId) w.add('t.destination_branch_id = ?', destinationBranchId);
  if (search) w.add('t.transfer_number ILIKE ?', `%${search}%`);
  if (dateFrom) w.add('t.created_at >= (?::date AT TIME ZONE ?)', dateFrom, timezone);
  if (dateTo) w.add('t.created_at < ((?::date + 1) AT TIME ZONE ?)', dateTo, timezone);
  const { rows } = await query(
    `SELECT ${COLUMNS},
            (SELECT count(*) FROM transfer_items ti WHERE ti.transfer_id = t.id)::int AS item_count,
            (SELECT COALESCE(sum(ti.requested_quantity), 0) FROM transfer_items ti WHERE ti.transfer_id = t.id)::int AS requested_units,
            count(*) OVER() AS total_count
       FROM ${FROM} ${w.sql}
      ORDER BY ${orderBy} LIMIT ${w.param(limit)} OFFSET ${w.param(offset)}`,
    w.params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function findById(id, client, { forUpdate = false } = {}) {
  if (forUpdate) await query('SELECT id FROM transfers WHERE id = $1 FOR UPDATE', [id], client);
  const { rows } = await query(`SELECT ${COLUMNS} FROM ${FROM} WHERE t.id = $1`, [id], client);
  return rows[0] || null;
}

async function listItems(transferId, client) {
  const { rows } = await query(
    `SELECT ti.id, ti.transfer_id, ti.medicine_id, m.name AS medicine_name, m.status AS medicine_status,
            ti.batch_id, b.batch_number, b.expiry_date, ti.requested_quantity, ti.approved_quantity,
            ti.shipped_quantity, ti.received_quantity,
            CASE WHEN ti.received_quantity IS NOT NULL THEN ti.shipped_quantity - ti.received_quantity END AS discrepancy_quantity,
            ti.notes
       FROM transfer_items ti
       JOIN medicines m ON m.id = ti.medicine_id
       JOIN batches b ON b.id = ti.batch_id
      WHERE ti.transfer_id = $1
      ORDER BY m.name, b.expiry_date`,
    [transferId],
    client,
  );
  return rows;
}

async function findBatches(client, batchIds) {
  const { rows } = await query(
    `SELECT b.id, b.medicine_id, b.batch_number, b.expiry_date, m.name AS medicine_name, m.status AS medicine_status
       FROM batches b JOIN medicines m ON m.id = b.medicine_id
      WHERE b.id = ANY($1::uuid[])`,
    [batchIds],
    client,
  );
  return rows;
}

async function sourceQuantities(client, branchId, batchIds) {
  const { rows } = await query(
    'SELECT batch_id, quantity FROM branch_inventory WHERE branch_id = $1 AND batch_id = ANY($2::uuid[])',
    [branchId, batchIds],
    client,
  );
  return new Map(rows.map((r) => [r.batch_id, r.quantity]));
}

async function insertTransfer(client, data) {
  const { rows } = await query(
    `INSERT INTO transfers (transfer_number, source_branch_id, destination_branch_id, status, created_by, notes)
     VALUES ($1, $2, $3, 'DRAFT', $4, $5) RETURNING id`,
    [data.transferNumber, data.sourceBranchId, data.destinationBranchId, data.userId, data.notes ?? null],
    client,
  );
  return rows[0].id;
}

async function insertItem(client, transferId, item) {
  await query(
    `INSERT INTO transfer_items (transfer_id, medicine_id, batch_id, requested_quantity, notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [transferId, item.medicineId, item.batchId, item.requestedQuantity, item.notes ?? null],
    client,
  );
}

const STEP_COLUMNS = {
  REQUESTED: ['requested_by', 'requested_at'],
  APPROVED: ['approved_by', 'approved_at'],
  IN_TRANSIT: ['shipped_by', 'shipped_at'],
  RECEIVED: ['received_by', 'received_at'],
  CANCELLED: ['cancelled_by', 'cancelled_at'],
};

async function setStatus(client, id, status, userId, extra = {}) {
  const [byColumn, atColumn] = STEP_COLUMNS[status];
  const sets = [`status = $2`, `${byColumn} = $3`, `${atColumn} = now()`];
  const params = [id, status, userId];
  for (const [column, value] of Object.entries(extra)) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  await query(`UPDATE transfers SET ${sets.join(', ')} WHERE id = $1`, params, client);
}

async function setItemQuantity(client, itemId, column, quantity) {
  if (!['approved_quantity', 'shipped_quantity', 'received_quantity'].includes(column)) {
    throw new Error('Unsupported transfer quantity column');
  }
  await query(`UPDATE transfer_items SET ${column} = $2 WHERE id = $1`, [itemId, quantity], client);
}

async function findBranch(client, branchId) {
  const { rows } = await query('SELECT id, name, code, status FROM branches WHERE id = $1 AND deleted_at IS NULL', [branchId], client);
  return rows[0] || null;
}

/** Plain read of the source selling price, used to price stock arriving at the destination. */
async function findSellingPrice(client, branchId, batchId) {
  const { rows } = await query(
    'SELECT selling_price FROM branch_inventory WHERE branch_id = $1 AND batch_id = $2',
    [branchId, batchId],
    client,
  );
  return rows[0] ? rows[0].selling_price : '0.00';
}

module.exports = {
  findBranch,
  findSellingPrice,
  list,
  findById,
  listItems,
  findBatches,
  sourceQuantities,
  insertTransfer,
  insertItem,
  setStatus,
  setItemQuantity,
};
