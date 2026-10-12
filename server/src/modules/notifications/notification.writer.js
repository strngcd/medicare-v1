const { query } = require('../../database/db');

/**
 * Persists informational notifications. Recipients are resolved at write
 * time so each user owns their own read/dismiss state.
 */
async function notifyUsers(client, userIds, notification) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;
  await query(
    `INSERT INTO notifications (user_id, type, title, message, branch_id, entity_type, entity_id)
     SELECT unnest($1::uuid[]), $2, $3, $4, $5, $6, $7`,
    [
      unique,
      notification.type,
      notification.title,
      notification.message,
      notification.branchId || null,
      notification.entityType || null,
      notification.entityId || null,
    ],
    client,
  );
}

/**
 * Active users who can work in `branchId` and hold `permissionCode`
 * (role default or explicit grant, minus explicit deny). Owners always qualify.
 */
async function findBranchRecipients(client, branchId, permissionCode, excludeUserId = null) {
  const { rows } = await query(
    `SELECT u.id
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN permissions p ON p.code = $2
       LEFT JOIN user_permission_overrides o ON o.user_id = u.id AND o.permission_id = p.id
      WHERE u.status = 'ACTIVE'
        AND ($3::uuid IS NULL OR u.id <> $3)
        AND (
          r.code = 'OWNER'
          OR (
            EXISTS (SELECT 1 FROM user_branches ub WHERE ub.user_id = u.id AND ub.branch_id = $1)
            AND (
              o.granted = true
              OR (o.granted IS NULL AND EXISTS (
                SELECT 1 FROM role_permissions rp WHERE rp.role_id = u.role_id AND rp.permission_id = p.id
              ))
            )
          )
        )`,
    [branchId, permissionCode, excludeUserId],
    client,
  );
  return rows.map((r) => r.id);
}

module.exports = { notifyUsers, findBranchRecipients };
