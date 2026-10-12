const { query } = require('../../database/db');

async function list(userId, { unreadOnly, type, limit, offset }) {
  const params = [userId];
  const filters = ['n.user_id = $1', 'n.dismissed_at IS NULL'];
  if (unreadOnly) filters.push('n.read_at IS NULL');
  if (type) {
    params.push(type);
    filters.push(`n.type = $${params.length}`);
  }
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT n.id, n.type, n.title, n.message, n.branch_id, br.name AS branch_name, n.entity_type, n.entity_id,
            n.read_at, n.created_at, count(*) OVER() AS total_count
       FROM notifications n LEFT JOIN branches br ON br.id = n.branch_id
      WHERE ${filters.join(' AND ')}
      ORDER BY n.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total: rows.length ? rows[0].total_count : 0 };
}

async function unreadCount(userId) {
  const { rows } = await query(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL',
    [userId],
  );
  return rows[0].n;
}

/** Updates only the caller's own notification; returns false if none matched. */
async function mark(userId, id, column) {
  if (!['read_at', 'dismissed_at'].includes(column)) throw new Error('Unsupported notification column');
  const extra = column === 'dismissed_at' ? ', read_at = COALESCE(read_at, now())' : '';
  const { rowCount } = await query(
    `UPDATE notifications SET ${column} = COALESCE(${column}, now())${extra} WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return rowCount > 0;
}

async function markAllRead(userId) {
  const { rowCount } = await query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND dismissed_at IS NULL',
    [userId],
  );
  return rowCount;
}

module.exports = { list, unreadCount, mark, markAllRead };
