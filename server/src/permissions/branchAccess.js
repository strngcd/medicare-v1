const AppError = require('../errors/AppError');
const { query } = require('../database/db');

/**
 * Branch assignment decides WHERE a user may act; permissions decide WHAT.
 * Owners may act in every branch. Everyone else only in assigned branches.
 */
function canAccessBranch(auth, branchId) {
  return auth.isOwner || auth.branchIds.includes(branchId);
}

function assertBranchAccess(auth, branchId) {
  if (!branchId || !canAccessBranch(auth, branchId)) {
    throw AppError.forbidden('BRANCH_ACCESS_DENIED', 'You do not have access to this branch.');
  }
}

/**
 * Resolves the branch filter for list/report queries.
 *  - an explicit branchId must be accessible
 *  - no branchId: Owner sees all (null), others see their assigned branches
 * Returns null (no restriction) or an array of branch IDs.
 */
function resolveBranchScope(auth, requestedBranchId) {
  if (requestedBranchId) {
    assertBranchAccess(auth, requestedBranchId);
    return [requestedBranchId];
  }
  return auth.isOwner ? null : [...auth.branchIds];
}

/**
 * Loads a branch, checks access, and (optionally) requires it to be ACTIVE
 * for operations that create new activity.
 */
async function loadAccessibleBranch(auth, branchId, { requireActive = false, client } = {}) {
  assertBranchAccess(auth, branchId);
  // Inside a transaction, KEY SHARE makes a concurrent delete wait for us (or
  // us for it, and then the deleted row no longer matches).
  const { rows } = await query(
    `SELECT id, name, code, status FROM branches WHERE id = $1 AND deleted_at IS NULL ${client ? 'FOR KEY SHARE' : ''}`,
    [branchId],
    client,
  );
  const branch = rows[0];
  if (!branch) throw AppError.notFound('Branch not found.');
  if (requireActive && branch.status !== 'ACTIVE') {
    throw AppError.conflict('BRANCH_INACTIVE', 'This branch is inactive and cannot accept new activity.');
  }
  return branch;
}

module.exports = { canAccessBranch, assertBranchAccess, resolveBranchScope, loadAccessibleBranch };
