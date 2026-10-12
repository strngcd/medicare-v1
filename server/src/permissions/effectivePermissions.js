const { ALL_PERMISSION_CODES, ROLES } = require('./catalog');

/**
 * Effective permissions = role defaults, then user overrides applied on top.
 * The Owner always has every permission and cannot be restricted.
 *
 * @param {string} roleCode
 * @param {string[]} rolePermissionCodes
 * @param {{code: string, granted: boolean}[]} overrides
 * @returns {Set<string>}
 */
function computeEffectivePermissions(roleCode, rolePermissionCodes, overrides = []) {
  if (roleCode === ROLES.OWNER) return new Set(ALL_PERMISSION_CODES);

  const effective = new Set(rolePermissionCodes);
  for (const override of overrides) {
    if (override.granted) effective.add(override.code);
    else effective.delete(override.code);
  }
  return effective;
}

/**
 * Describes each permission's source for the permission management UI.
 * @returns {{code, inherited: boolean, override: 'GRANT'|'DENY'|null, effective: boolean}[]}
 */
function describePermissions(roleCode, rolePermissionCodes, overrides = []) {
  const roleSet = new Set(rolePermissionCodes);
  const overrideMap = new Map(overrides.map((o) => [o.code, o.granted]));
  const isOwner = roleCode === ROLES.OWNER;

  return ALL_PERMISSION_CODES.map((code) => {
    const inherited = isOwner || roleSet.has(code);
    const overrideValue = isOwner ? undefined : overrideMap.get(code);
    const override = overrideValue === undefined ? null : overrideValue ? 'GRANT' : 'DENY';
    const effective = isOwner ? true : override === null ? inherited : override === 'GRANT';
    return { code, inherited, override, effective };
  });
}

module.exports = { computeEffectivePermissions, describePermissions };
