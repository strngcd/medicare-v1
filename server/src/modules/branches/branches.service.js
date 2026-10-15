const AppError = require('../../errors/AppError');
const { withTransaction } = require('../../database/db');
const { recordAudit, diff } = require('../audit/audit.recorder');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { resolveBranchScope, assertBranchAccess } = require('../../permissions/branchAccess');
const repo = require('./branches.repository');

const SORTABLE = { name: 'b.name', code: 'b.code', city: 'b.city', status: 'b.status', createdAt: 'b.created_at' };

function toDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  return dto;
}

async function listBranches(auth, query) {
  const params = parseListParams(query, { sortable: SORTABLE, defaultSort: 'name', defaultOrder: 'asc' });
  const { rows, total } = await repo.list({
    branchIds: resolveBranchScope(auth, null),
    status: query.status,
    search: query.search,
    ...params,
  });
  return { rows: rows.map(toDto), total, page: params.page, limit: params.limit };
}

async function getBranch(auth, id) {
  assertBranchAccess(auth, id);
  const branch = await repo.findById(id);
  if (!branch) throw AppError.notFound('Branch not found.');
  // Only a branch nothing has happened in yet may be deleted.
  return { ...toDto(branch), canDelete: !(await repo.hasActivity(id)) };
}

/** Branches the user can pick in the header selector. */
async function getBranchContext(auth) {
  const { rows } = await repo.list({
    branchIds: resolveBranchScope(auth, null),
    limit: 1000,
    offset: 0,
    orderBy: 'b.status ASC, b.name ASC',
  });
  const context = {
    canAccessAllBranches: auth.isOwner,
    branches: rows.map((r) => ({ id: r.id, name: r.name, code: r.code, status: r.status })),
  };
  // Transfer creators may send stock to any active branch, so they need its name (nothing else).
  if (auth.permissions.has('INVENTORY_TRANSFER_CREATE')) {
    const all = await repo.list({ branchIds: null, status: 'ACTIVE', limit: 1000, offset: 0, orderBy: 'b.name ASC' });
    context.transferDestinations = all.rows.map((r) => ({ id: r.id, name: r.name, code: r.code }));
  }
  return context;
}

async function assertValidManager(client, managerUserId, branchId) {
  if (!managerUserId) return;
  if (!(await repo.isUserAssigned(client, managerUserId, branchId))) {
    throw AppError.validation('The manager must be an active staff member assigned to this branch.', {
      fields: { managerUserId: 'Select an active staff member assigned to this branch.' },
    });
  }
}

async function createBranch(auth, actor, data) {
  return withTransaction(async (client) => {
    if (await repo.findByCode(data.code, client)) {
      throw AppError.conflict('DUPLICATE_BRANCH_CODE', 'A branch with this code already exists.', {
        fields: { code: 'This code is already used.' },
      });
    }
    const id = await repo.insert(client, {
      ...data,
      country: data.country || 'Ethiopia',
      managerUserId: null,
    });

    // A non-Owner creator needs an assignment to be able to work in the branch.
    if (!auth.isOwner) {
      await client.query('INSERT INTO user_branches (user_id, branch_id, assigned_by) VALUES ($1, $2, $1)', [
        auth.userId,
        id,
      ]);
    }
    if (data.managerUserId) {
      await assertValidManager(client, data.managerUserId, id);
      await repo.update(client, id, { managerUserId: data.managerUserId });
    }

    const created = await repo.findById(id, client);
    await recordAudit(client, actor, {
      action: 'BRANCH_CREATED',
      entityType: 'BRANCH',
      entityId: id,
      branchId: id,
      description: `Branch ${created.name} (${created.code}) created`,
      newValues: toDto(created),
    });
    return toDto(created);
  });
}

async function updateBranch(auth, actor, id, changes) {
  assertBranchAccess(auth, id);
  return withTransaction(async (client) => {
    const existing = await repo.findById(id, client, { forUpdate: true });
    if (!existing) throw AppError.notFound('Branch not found.');
    if (changes.managerUserId) await assertValidManager(client, changes.managerUserId, id);

    const before = toDto(existing);
    const { previous, next, changed } = diff(before, changes, Object.keys(changes));
    if (!changed) return before;

    await repo.update(client, id, changes);
    await recordAudit(client, actor, {
      action: 'BRANCH_UPDATED',
      entityType: 'BRANCH',
      entityId: id,
      branchId: id,
      description: `Branch ${existing.name} updated`,
      previousValues: previous,
      newValues: next,
    });
    return toDto(await repo.findById(id, client));
  });
}

async function deactivateBranch(auth, actor, id) {
  assertBranchAccess(auth, id);
  return withTransaction(async (client) => {
    const branch = await repo.findById(id, client, { forUpdate: true });
    if (!branch) throw AppError.notFound('Branch not found.');
    if (branch.status === 'INACTIVE') {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'This branch is already inactive.');
    }

    const dependentStaff = await repo.findStaffDependingOnBranch(client, id);
    if (dependentStaff.length > 0) {
      throw AppError.conflict(
        'BRANCH_HAS_DEPENDENT_STAFF',
        'Some active staff have no other active branch. Reassign or deactivate them first.',
        { staff: dependentStaff.map((s) => ({ id: s.id, fullName: s.full_name })) },
      );
    }
    if ((await repo.countOpenTransfers(client, id)) > 0) {
      throw AppError.conflict(
        'BRANCH_HAS_TRANSFERS_IN_TRANSIT',
        'This branch has transfers in transit. Receive them before deactivating.',
      );
    }

    await repo.setStatus(client, id, 'INACTIVE', auth.userId);
    await recordAudit(client, actor, {
      action: 'BRANCH_DEACTIVATED',
      entityType: 'BRANCH',
      entityId: id,
      branchId: id,
      description: `Branch ${branch.name} deactivated`,
      previousValues: { status: 'ACTIVE' },
      newValues: { status: 'INACTIVE' },
    });
    return toDto(await repo.findById(id, client));
  });
}

async function reactivateBranch(auth, actor, id) {
  assertBranchAccess(auth, id);
  return withTransaction(async (client) => {
    const branch = await repo.findById(id, client, { forUpdate: true });
    if (!branch) throw AppError.notFound('Branch not found.');
    if (branch.status === 'ACTIVE') {
      throw AppError.conflict('INVALID_STATUS_TRANSITION', 'This branch is already active.');
    }
    await repo.setStatus(client, id, 'ACTIVE', auth.userId);
    await recordAudit(client, actor, {
      action: 'BRANCH_REACTIVATED',
      entityType: 'BRANCH',
      entityId: id,
      branchId: id,
      description: `Branch ${branch.name} reactivated`,
      previousValues: { status: 'INACTIVE' },
      newValues: { status: 'ACTIVE' },
    });
    return toDto(await repo.findById(id, client));
  });
}

/**
 * Deletes a branch created by mistake. Allowed only while it has no stock,
 * sales, purchases, transfers or payments; the row is kept (soft delete) so
 * audit and login history still resolve.
 */
async function deleteBranch(auth, actor, id) {
  assertBranchAccess(auth, id);
  return withTransaction(async (client) => {
    const branch = await repo.findById(id, client, { forUpdate: true });
    if (!branch) throw AppError.notFound('Branch not found.');
    if (await repo.hasActivity(id, client)) {
      throw AppError.conflict(
        'RECORD_IN_USE',
        'This branch already has stock or transactions, so it cannot be deleted. Deactivate it instead.',
      );
    }
    const dependentStaff = await repo.findStaffDependingOnBranch(client, id);
    if (dependentStaff.length > 0) {
      throw AppError.conflict(
        'BRANCH_HAS_DEPENDENT_STAFF',
        'Some active staff have no other active branch. Reassign or deactivate them first.',
        { staff: dependentStaff.map((s) => ({ id: s.id, fullName: s.full_name })) },
      );
    }

    await repo.markDeleted(client, id, auth.userId);
    await recordAudit(client, actor, {
      action: 'BRANCH_DELETED',
      entityType: 'BRANCH',
      entityId: id,
      branchId: id,
      description: `Branch ${branch.name} (${branch.code}) deleted`,
      previousValues: toDto(branch),
    });
    return { id };
  });
}

async function listBranchUsers(auth, id) {
  await getBranch(auth, id);
  return camelize(await repo.listUsers(id));
}

async function getBranchSettings(auth, id) {
  assertBranchAccess(auth, id);
  const settings = await repo.findSettings(id);
  if (!settings) throw AppError.notFound('Branch not found.');
  return camelize(settings);
}

async function updateBranchSettings(auth, actor, id, changes) {
  assertBranchAccess(auth, id);
  return withTransaction(async (client) => {
    const branch = await repo.findById(id, client);
    if (!branch) throw AppError.notFound('Branch not found.');
    const before = camelize((await repo.findSettings(id, client)) || {});
    const { previous, next, changed } = diff(before, changes, Object.keys(changes));
    if (!changed) return before;

    // Changing defaultMinimumStock deliberately does NOT touch existing inventory thresholds.
    await repo.updateSettings(client, id, changes, auth.userId);
    await recordAudit(client, actor, {
      action: 'SETTINGS_UPDATED',
      entityType: 'BRANCH_SETTINGS',
      entityId: id,
      branchId: id,
      description: `Branch settings updated for ${branch.name}`,
      previousValues: previous,
      newValues: next,
    });
    return camelize(await repo.findSettings(id, client));
  });
}

module.exports = {
  listBranches,
  getBranch,
  getBranchContext,
  createBranch,
  updateBranch,
  deactivateBranch,
  reactivateBranch,
  deleteBranch,
  listBranchUsers,
  getBranchSettings,
  updateBranchSettings,
};
