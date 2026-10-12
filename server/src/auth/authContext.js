const { query } = require('../database/db');
const { computeEffectivePermissions } = require('../permissions/effectivePermissions');
const { ROLES } = require('../permissions/catalog');

/**
 * Loads everything authorization needs for one user in a few queries:
 * profile, role, effective permissions and branch assignments.
 * Never includes the password hash.
 */
async function loadAuthContext(userId, client) {
  const { rows } = await query(
    `SELECT u.id, u.full_name, u.email, u.status, u.last_selected_branch_id,
            r.code AS role_code, r.name AS role_name, r.rank AS role_rank,
            COALESCE((SELECT array_agg(p.code) FROM role_permissions rp
                        JOIN permissions p ON p.id = rp.permission_id
                       WHERE rp.role_id = u.role_id), '{}') AS role_permissions,
            COALESCE((SELECT json_agg(json_build_object('code', p.code, 'granted', o.granted))
                        FROM user_permission_overrides o
                        JOIN permissions p ON p.id = o.permission_id
                       WHERE o.user_id = u.id), '[]') AS overrides,
            COALESCE((SELECT array_agg(ub.branch_id) FROM user_branches ub
                       WHERE ub.user_id = u.id), '{}') AS branch_ids
       FROM users u
       JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`,
    [userId],
    client,
  );
  const row = rows[0];
  if (!row) return null;

  return {
    userId: row.id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    roleCode: row.role_code,
    roleName: row.role_name,
    roleRank: row.role_rank,
    isOwner: row.role_code === ROLES.OWNER,
    permissions: computeEffectivePermissions(row.role_code, row.role_permissions, row.overrides),
    branchIds: row.branch_ids,
    lastSelectedBranchId: row.last_selected_branch_id,
  };
}

module.exports = { loadAuthContext };
