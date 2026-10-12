const { PERMISSIONS: P } = require('../../permissions/catalog');
const { resolveBranchScope } = require('../../permissions/branchAccess');
const repo = require('./search.repository');

/**
 * Header search across entity types. Each group is searched only when the
 * user holds its view permission, results are branch-scoped, and no cost or
 * profit fields are ever returned.
 */
async function globalSearch(auth, term, branchId) {
  const like = `%${term}%`;
  const branchIds = resolveBranchScope(auth, branchId);
  const has = (code) => auth.permissions.has(code);

  const groups = [
    has(P.MEDICINE_VIEW) && ['MEDICINE', 'Medicines', () => repo.medicines(like, term)],
    (has(P.SALES_VIEW_HISTORY) || has(P.SALES_VIEW)) && [
      'SALE', 'Sales', () => repo.sales(like, branchIds, has(P.SALES_VIEW_HISTORY) ? null : auth.userId),
    ],
    has(P.SUPPLIER_VIEW) && ['SUPPLIER', 'Suppliers', () => repo.suppliers(like)],
    has(P.PURCHASE_VIEW) && ['PURCHASE', 'Purchases', () => repo.purchases(like, branchIds)],
    has(P.INVENTORY_TRANSFER_VIEW) && ['TRANSFER', 'Transfers', () => repo.transfers(like, branchIds)],
    has(P.STAFF_VIEW) && ['STAFF', 'Staff', () => repo.staff(like, auth.isOwner ? null : auth.branchIds)],
  ].filter(Boolean);

  const results = await Promise.all(groups.map(async ([type, label, run]) => ({ type, label, results: await run() })));
  return { query: term, groups: results.filter((g) => g.results.length > 0) };
}

module.exports = { globalSearch };
