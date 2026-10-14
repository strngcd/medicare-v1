const AppError = require('../../errors/AppError');
const { withTransaction } = require('../../database/db');
const { recordAudit, diff } = require('../audit/audit.recorder');
const { notifyUsers } = require('../notifications/notification.writer');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { sendMail } = require('../../utils/mailer');
const config = require('../../config');
const { revokeUserSessions } = require('../../auth/sessions');
const { describePermissions } = require('../../permissions/effectivePermissions');
const { canAccessBranch, assertBranchAccess } = require('../../permissions/branchAccess');
const { ROLES } = require('../../permissions/catalog');
const { issuePasswordToken } = require('../auth/auth.service');
const files = require('../files/files');
const repo = require('./users.repository');

const SORTABLE = {
  fullName: 'u.full_name',
  email: 'u.email',
  employeeId: 'u.employee_id',
  role: 'r.rank',
  status: 'u.status',
  createdAt: 'u.created_at',
  lastLoginAt: 'u.last_login_at',
};

function toDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  dto.role = { code: dto.roleCode, name: dto.roleName };
  delete dto.roleCode;
  delete dto.roleName;
  delete dto.roleRank;
  return dto;
}

// ---------------------------------------------------------------------------
// Authority rules
// ---------------------------------------------------------------------------

function assertNotSelf(auth, targetId, what) {
  if (auth.userId === targetId) {
    throw AppError.forbidden('SELF_MODIFICATION_NOT_ALLOWED', `You cannot change your own ${what}.`);
  }
}

/** Owners manage everyone; others only manage roles below their own. */
function assertCanManage(auth, target) {
  if (auth.isOwner) return;
  if (target.role_rank <= auth.roleRank) {
    throw AppError.forbidden('INSUFFICIENT_AUTHORITY', 'You cannot modify a user with an equal or higher role.');
  }
}

function assertCanAssignRole(auth, role) {
  if (auth.isOwner) return;
  if (role.rank <= auth.roleRank) {
    throw AppError.forbidden('INSUFFICIENT_AUTHORITY', 'You cannot assign a role equal to or above your own.');
  }
}

/** Non-Owners can only see staff who share a branch with them (and Owners). */
function canSeeUser(auth, target) {
  if (auth.isOwner || target.role_code === ROLES.OWNER || target.id === auth.userId) return true;
  return target.branches.some((b) => auth.branchIds.includes(b.id));
}

async function loadVisibleUser(auth, id, client, options) {
  const target = await repo.findById(id, client, options);
  if (!target || !canSeeUser(auth, target)) throw AppError.notFound('Staff member not found.');
  return target;
}

async function assertUnique(client, { email, employeeId }, excludeUserId) {
  const { emailTaken, employeeIdTaken } = await repo.findConflicts(client, { email, employeeId, excludeUserId });
  if (emailTaken) {
    throw AppError.conflict('DUPLICATE_EMAIL', 'Another account already uses this email.', {
      fields: { email: 'This email is already in use.' },
    });
  }
  if (employeeIdTaken) {
    throw AppError.conflict('DUPLICATE_EMPLOYEE_ID', 'Another account already uses this employee ID.', {
      fields: { employeeId: 'This employee ID is already in use.' },
    });
  }
}

/** Validates requested branches exist, are ACTIVE, and are within the actor's reach. */
async function loadAssignableBranches(client, auth, branchIds) {
  const unique = [...new Set(branchIds)];
  const branches = await repo.findBranchesByIds(client, unique);
  if (branches.length !== unique.length) throw AppError.validation('One or more branches do not exist.');
  for (const branch of branches) {
    if (!canAccessBranch(auth, branch.id)) {
      throw AppError.forbidden('BRANCH_ACCESS_DENIED', `You cannot assign staff to branch ${branch.name}.`);
    }
  }
  return branches;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function listUsers(auth, query) {
  if (query.branchId) assertBranchAccess(auth, query.branchId);
  const params = parseListParams(query, { sortable: SORTABLE, defaultSort: 'fullName', defaultOrder: 'asc' });
  const { rows, total } = await repo.list({
    visibleBranchIds: auth.isOwner ? null : auth.branchIds,
    search: query.search,
    roleCode: query.role,
    branchId: query.branchId,
    status: query.status,
    ...params,
  });
  return { rows: rows.map(toDto), total, page: params.page, limit: params.limit };
}

async function getUser(auth, id) {
  return toDto(await loadVisibleUser(auth, id));
}

async function getUserPermissions(auth, id) {
  const target = await loadVisibleUser(auth, id);
  const [roleCodes, overrides, catalog] = await Promise.all([
    repo.listRolePermissionCodes(target.role_code),
    repo.listOverrides(id),
    repo.listPermissionCatalog(),
  ]);
  const meta = new Map(catalog.map((p) => [p.code, p]));
  const described = describePermissions(target.role_code, roleCodes, overrides);
  return {
    userId: id,
    role: { code: target.role_code, name: target.role_name },
    isOwner: target.role_code === ROLES.OWNER,
    permissions: described.map((p) => ({
      ...p,
      module: meta.get(p.code).module,
      description: meta.get(p.code).description,
      // The actor can only change permissions they hold themselves.
      canModify:
        target.role_code !== ROLES.OWNER &&
        target.id !== auth.userId &&
        auth.permissions.has('STAFF_MANAGE_PERMISSIONS') &&
        auth.permissions.has(p.code) &&
        (auth.isOwner || target.role_rank > auth.roleRank),
    })),
  };
}

async function getUserActivity(auth, id, query) {
  await loadVisibleUser(auth, id);
  const params = parseListParams(query, { sortable: { timestamp: 'a."timestamp"' }, defaultSort: 'timestamp' });
  const { rows, total } = await repo.listActivity(id, params);
  return {
    rows: rows.map((r) => {
      const dto = camelize(r);
      delete dto.totalCount;
      return dto;
    }),
    total,
    page: params.page,
    limit: params.limit,
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function createUser(auth, actor, data) {
  const result = await withTransaction(async (client) => {
    const role = await repo.findRoleByCode(data.roleCode, client);
    if (!role) throw AppError.validation('Unknown role.', { fields: { roleCode: 'Select a valid role.' } });
    assertCanAssignRole(auth, role);
    await assertUnique(client, data, null);

    const isOwnerRole = role.code === ROLES.OWNER;
    const branchIds = isOwnerRole ? [] : data.branchIds || [];
    if (!isOwnerRole && branchIds.length === 0) {
      throw AppError.validation('Assign at least one branch.', { fields: { branchIds: 'Select at least one branch.' } });
    }
    const branches = await loadAssignableBranches(client, auth, branchIds);
    const inactive = branches.filter((b) => b.status !== 'ACTIVE');
    if (inactive.length) {
      throw AppError.conflict('BRANCH_INACTIVE', `Staff cannot be assigned to inactive branch ${inactive[0].name}.`);
    }

    const id = await repo.insert(client, {
      fullName: data.fullName,
      email: data.email,
      phone: data.phone ?? null,
      roleId: role.id,
      employeeId: data.employeeId ?? null,
      jobTitle: data.jobTitle ?? null,
      hireDate: data.hireDate ?? null,
    });
    await repo.replaceBranches(client, id, { add: branchIds, remove: [] }, auth.userId);
    const link = await issuePasswordToken(client, { userId: id, purpose: 'ACCOUNT_SETUP', createdBy: auth.userId });

    const created = await repo.findById(id, client);
    const dto = toDto(created);
    await recordAudit(client, actor, {
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: id,
      branchId: branchIds[0] || null,
      description: `Staff account created for ${dto.fullName} (${role.name})`,
      newValues: {
        fullName: dto.fullName,
        email: dto.email,
        employeeId: dto.employeeId,
        role: role.code,
        branches: branches.map((b) => b.code),
      },
    });
    return { user: dto, link };
  });

  await sendMail({
    to: result.user.email,
    subject: 'Set up your Medicar account',
    text:
      `An account has been created for you in Medicar.\n\n` +
      `Open this link to choose your password (valid for ${config.security.accountSetupTtlHours} hours, single use):\n` +
      `${result.link.url}\n`,
  });

  return {
    user: result.user,
    // Shown once to the creator so it can be shared if email is not configured.
    setupLink: { url: result.link.url, expiresAt: result.link.expiresAt },
  };
}

async function resendSetupLink(auth, actor, id) {
  const result = await withTransaction(async (client) => {
    const target = await loadVisibleUser(auth, id, client, { forUpdate: true });
    assertNotSelf(auth, id, 'setup link');
    assertCanManage(auth, target);
    if (target.status !== 'ACTIVE') throw AppError.conflict('ACCOUNT_INACTIVE', 'This account is inactive.');
    if (target.has_password) {
      throw AppError.conflict('ACCOUNT_ALREADY_SET_UP', 'This account already has a password. Use password reset instead.');
    }
    const link = await issuePasswordToken(client, { userId: id, purpose: 'ACCOUNT_SETUP', createdBy: auth.userId });
    await recordAudit(client, actor, {
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: id,
      description: `Account setup link reissued for ${target.full_name}`,
    });
    return { email: target.email, link };
  });
  await sendMail({
    to: result.email,
    subject: 'Set up your Medicar account',
    text: `Open this link to choose your password (single use):\n${result.link.url}\n`,
  });
  return { setupLink: { url: result.link.url, expiresAt: result.link.expiresAt } };
}

async function updateUser(auth, actor, id, changes) {
  return withTransaction(async (client) => {
    const target = await loadVisibleUser(auth, id, client, { forUpdate: true });
    assertNotSelf(auth, id, 'staff record here; use your profile page');
    assertCanManage(auth, target);
    await assertUnique(client, { email: changes.email, employeeId: changes.employeeId }, id);

    const before = toDto(target);
    const { previous, next, changed } = diff(before, changes, Object.keys(changes));
    if (!changed) return before;

    await repo.updateProfile(client, id, changes);
    await recordAudit(client, actor, {
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: id,
      description: `Staff profile updated for ${target.full_name}`,
      previousValues: previous,
      newValues: next,
    });
    return toDto(await repo.findById(id, client));
  });
}

async function changeRole(auth, actor, id, roleCode) {
  return withTransaction(async (client) => {
    assertNotSelf(auth, id, 'role');
    const target = await loadVisibleUser(auth, id, client, { forUpdate: true });
    assertCanManage(auth, target);
    const role = await repo.findRoleByCode(roleCode, client);
    if (!role) throw AppError.validation('Unknown role.', { fields: { roleCode: 'Select a valid role.' } });
    assertCanAssignRole(auth, role);
    if (role.code === target.role_code) return toDto(target);

    if (target.role_code === ROLES.OWNER && target.status === 'ACTIVE' && (await repo.countActiveOwners(client)) <= 1) {
      throw AppError.conflict('LAST_OWNER', 'The organization must keep at least one active Owner.');
    }
    if (role.code !== ROLES.OWNER && (await repo.countActiveBranches(client, id)) === 0) {
      throw AppError.conflict('BRANCH_REQUIRED', 'Assign at least one active branch before changing to this role.');
    }

    await repo.updateRole(client, id, role.id);
    await recordAudit(client, actor, {
      action: 'ROLE_CHANGED',
      entityType: 'USER',
      entityId: id,
      description: `Role of ${target.full_name} changed from ${target.role_name} to ${role.name}`,
      previousValues: { role: target.role_code },
      newValues: { role: role.code },
    });
    await notifyUsers(client, [id], {
      type: 'IMPORTANT_CONFIGURATION_CHANGE',
      title: 'Your role changed',
      message: `Your role was changed from ${target.role_name} to ${role.name}.`,
      entityType: 'USER',
      entityId: id,
    });
    return toDto(await repo.findById(id, client));
  });
}

async function setBranches(auth, actor, id, branchIds) {
  return withTransaction(async (client) => {
    assertNotSelf(auth, id, 'branch assignments');
    const target = await loadVisibleUser(auth, id, client, { forUpdate: true });
    assertCanManage(auth, target);
    if (target.role_code === ROLES.OWNER) {
      throw AppError.conflict('OWNER_HAS_ALL_BRANCHES', 'Owners have access to all branches.');
    }

    const requested = new Set(branchIds);
    const current = target.branches.map((b) => b.id);
    // A non-Owner actor only manages assignments inside their own branches;
    // assignments to branches outside their reach are left untouched.
    const manageable = current.filter((b) => canAccessBranch(auth, b));
    const add = [...requested].filter((b) => !current.includes(b));
    const remove = manageable.filter((b) => !requested.has(b));

    const addedBranches = await loadAssignableBranches(client, auth, add);
    const inactive = addedBranches.filter((b) => b.status !== 'ACTIVE');
    if (inactive.length) {
      throw AppError.conflict('BRANCH_INACTIVE', `Staff cannot be assigned to inactive branch ${inactive[0].name}.`);
    }
    if (add.length === 0 && remove.length === 0) return toDto(target);

    await repo.replaceBranches(client, id, { add, remove }, auth.userId);
    if (target.status === 'ACTIVE' && (await repo.countActiveBranches(client, id)) === 0) {
      throw AppError.conflict('BRANCH_REQUIRED', 'Staff must keep at least one active branch.');
    }

    const updated = await repo.findById(id, client);
    await recordAudit(client, actor, {
      action: 'BRANCHES_CHANGED',
      entityType: 'USER',
      entityId: id,
      description: `Branch assignments changed for ${target.full_name}`,
      previousValues: { branches: target.branches.map((b) => b.code) },
      newValues: { branches: updated.branches.map((b) => b.code) },
    });
    await notifyUsers(client, [id], {
      type: 'IMPORTANT_CONFIGURATION_CHANGE',
      title: 'Your branches changed',
      message: `You are now assigned to: ${updated.branches.map((b) => b.name).join(', ')}.`,
      entityType: 'USER',
      entityId: id,
    });
    return toDto(updated);
  });
}

async function setPermissionOverride(auth, actor, id, code, granted) {
  return withTransaction(async (client) => {
    assertNotSelf(auth, id, 'permissions');
    const target = await loadVisibleUser(auth, id, client, { forUpdate: true });
    if (target.role_code === ROLES.OWNER) {
      throw AppError.forbidden('OWNER_PERMISSIONS_FIXED', 'Owner permissions cannot be changed.');
    }
    assertCanManage(auth, target);
    if (!auth.permissions.has(code)) {
      throw AppError.forbidden('INSUFFICIENT_AUTHORITY', 'You cannot manage a permission you do not hold yourself.');
    }
    const catalog = await repo.listPermissionCatalog(client);
    if (!catalog.some((p) => p.code === code)) throw AppError.notFound('Unknown permission.');

    const overrides = await repo.listOverrides(id, client);
    const existing = overrides.find((o) => o.code === code);
    const previous = existing ? (existing.granted ? 'GRANT' : 'DENY') : 'INHERITED';
    const nextValue = granted === null ? 'INHERITED' : granted ? 'GRANT' : 'DENY';
    if (previous !== nextValue) {
      if (granted === null) await repo.deleteOverride(client, id, code);
      else await repo.upsertOverride(client, id, code, granted, auth.userId);

      await recordAudit(client, actor, {
        action: 'PERMISSIONS_CHANGED',
        entityType: 'USER',
        entityId: id,
        description: `Permission ${code} set to ${nextValue.toLowerCase()} for ${target.full_name}`,
        previousValues: { [code]: previous },
        newValues: { [code]: nextValue },
      });
      await notifyUsers(client, [id], {
        type: 'IMPORTANT_CONFIGURATION_CHANGE',
        title: 'Your permissions changed',
        message: `Permission ${code} is now ${nextValue.toLowerCase()}.`,
        entityType: 'USER',
        entityId: id,
      });
    }
    return null;
  }).then(() => getUserPermissions(auth, id));
}

async function deactivateUser(auth, actor, id) {
  return withTransaction(async (client) => {
    assertNotSelf(auth, id, 'account status');
    const target = await loadVisibleUser(auth, id, client, { forUpdate: true });
    assertCanManage(auth, target);
    if (target.status === 'INACTIVE') throw AppError.conflict('INVALID_STATUS_TRANSITION', 'This account is already inactive.');
    if (target.role_code === ROLES.OWNER && (await repo.countActiveOwners(client)) <= 1) {
      throw AppError.conflict('LAST_OWNER', 'The organization must keep at least one active Owner.');
    }

    await repo.setStatus(client, id, 'INACTIVE', auth.userId);
    await revokeUserSessions(client, id, 'ACCOUNT_DEACTIVATED');
    await recordAudit(client, actor, {
      action: 'DEACTIVATED',
      entityType: 'USER',
      entityId: id,
      description: `Account of ${target.full_name} deactivated`,
      previousValues: { status: 'ACTIVE' },
      newValues: { status: 'INACTIVE' },
    });
    await notifyUsers(client, [id], {
      type: 'ACCOUNT_DEACTIVATED',
      title: 'Account deactivated',
      message: 'Your account was deactivated and all sessions were signed out.',
      entityType: 'USER',
      entityId: id,
    });
    return toDto(await repo.findById(id, client));
  });
}

async function reactivateUser(auth, actor, id) {
  return withTransaction(async (client) => {
    assertNotSelf(auth, id, 'account status');
    const target = await loadVisibleUser(auth, id, client, { forUpdate: true });
    assertCanManage(auth, target);
    if (target.status === 'ACTIVE') throw AppError.conflict('INVALID_STATUS_TRANSITION', 'This account is already active.');
    if (target.role_code !== ROLES.OWNER && (await repo.countActiveBranches(client, id)) === 0) {
      throw AppError.conflict('BRANCH_REQUIRED', 'Assign at least one active branch before reactivating.');
    }

    await repo.setStatus(client, id, 'ACTIVE', auth.userId);
    await recordAudit(client, actor, {
      action: 'REACTIVATED',
      entityType: 'USER',
      entityId: id,
      description: `Account of ${target.full_name} reactivated`,
      previousValues: { status: 'INACTIVE' },
      newValues: { status: 'ACTIVE' },
    });
    await notifyUsers(client, [id], {
      type: 'ACCOUNT_REACTIVATED',
      title: 'Account reactivated',
      message: 'Your account was reactivated.',
      entityType: 'USER',
      entityId: id,
    });
    return toDto(await repo.findById(id, client));
  });
}

// ---------------------------------------------------------------------------
// Self-service
// ---------------------------------------------------------------------------

async function getMe(auth) {
  return toDto(await repo.findById(auth.userId));
}

/** Users may change only their own name and phone here. */
async function updateMe(auth, actor, changes) {
  return withTransaction(async (client) => {
    const current = await repo.findById(auth.userId, client, { forUpdate: true });
    const before = toDto(current);
    const { previous, next, changed } = diff(before, changes, Object.keys(changes));
    if (!changed) return before;
    await repo.updateProfile(client, auth.userId, changes);
    await recordAudit(client, actor, {
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: auth.userId,
      description: `${current.full_name} updated their profile`,
      previousValues: previous,
      newValues: next,
    });
    return toDto(await repo.findById(auth.userId, client));
  });
}

function toPreferencesDto(row) {
  return {
    theme: row.theme,
    pageSize: row.page_size,
    uiDensity: row.ui_density,
    lastSelectedBranchId: row.last_selected_branch_id,
  };
}

async function getPreferences(auth) {
  return toPreferencesDto(await repo.getPreferences(auth.userId));
}

async function updatePreferences(auth, changes) {
  return withTransaction(async (client) => {
    await repo.upsertPreferences(client, auth.userId, changes);
    if (changes.lastSelectedBranchId !== undefined) {
      // A UI preference only; access is still checked on every request.
      if (changes.lastSelectedBranchId === null) {
        if (!auth.isOwner) throw AppError.forbidden('BRANCH_ACCESS_DENIED', 'Select one of your branches.');
      } else {
        assertBranchAccess(auth, changes.lastSelectedBranchId);
      }
      await repo.setLastSelectedBranch(client, auth.userId, changes.lastSelectedBranchId);
    }
    return toPreferencesDto(await repo.getPreferences(auth.userId, client));
  });
}

// ---------------------------------------------------------------------------
// CV (PDF stored in the database)
// ---------------------------------------------------------------------------

/** Uploads (file) or removes (null) a staff member's CV. */
async function setCv(auth, actor, id, file) {
  return withTransaction(async (client) => {
    const target = await loadVisibleUser(auth, id, client, { forUpdate: true });
    // Attaching a document grants nothing, so staff managers may keep their own CV too.
    if (target.id !== auth.userId) assertCanManage(auth, target);
    const previousFileId = await repo.findCvFileId(id, client);
    if (!file && !previousFileId) return toDto(target);

    const stored = file ? await files.insertFile(client, file, auth.userId) : null;
    await repo.setCv(client, id, stored ? stored.id : null);
    await recordAudit(client, actor, {
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: id,
      description: stored ? `CV uploaded for ${target.full_name} (${stored.file_name})` : `CV removed for ${target.full_name}`,
      previousValues: { cvFileId: previousFileId },
      newValues: { cvFileId: stored ? stored.id : null },
    });
    return toDto(await repo.findById(id, client));
  });
}

async function getCv(auth, id) {
  await loadVisibleUser(auth, id);
  const fileId = await repo.findCvFileId(id);
  const file = fileId ? await files.findFile(fileId) : null;
  if (!file) throw AppError.notFound('No CV has been uploaded for this staff member.');
  return file;
}

module.exports = {
  setCv,
  getCv,
  listUsers,
  getUser,
  getUserPermissions,
  getUserActivity,
  createUser,
  resendSetupLink,
  updateUser,
  changeRole,
  setBranches,
  setPermissionOverride,
  deactivateUser,
  reactivateUser,
  getMe,
  updateMe,
  getPreferences,
  updatePreferences,
};
