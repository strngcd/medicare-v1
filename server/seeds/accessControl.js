const {
  PERMISSION_DEFINITIONS,
  ROLE_DEFINITIONS,
  ROLE_DEFAULT_PERMISSIONS,
} = require('../src/permissions/catalog');

/**
 * Upserts roles and permissions, then makes each role's default permission
 * set match the catalog exactly. User-level overrides are not touched.
 */
async function seedAccessControl(client) {
  for (const role of ROLE_DEFINITIONS) {
    await client.query(
      `INSERT INTO roles (code, name, description, rank)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, description = EXCLUDED.description, rank = EXCLUDED.rank`,
      [role.code, role.name, role.description, role.rank],
    );
  }

  for (const [code, module, description] of PERMISSION_DEFINITIONS) {
    await client.query(
      `INSERT INTO permissions (code, module, description)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, description = EXCLUDED.description`,
      [code, module, description],
    );
  }

  for (const [roleCode, permissionCodes] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
    await client.query(
      `DELETE FROM role_permissions rp
        USING roles r, permissions p
        WHERE rp.role_id = r.id AND rp.permission_id = p.id
          AND r.code = $1 AND NOT (p.code = ANY($2::text[]))`,
      [roleCode, permissionCodes],
    );
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.code = $1 AND p.code = ANY($2::text[])
       ON CONFLICT DO NOTHING`,
      [roleCode, permissionCodes],
    );
  }
}

module.exports = { seedAccessControl };
