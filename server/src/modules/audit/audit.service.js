const AppError = require('../../errors/AppError');
const config = require('../../config');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { resolveBranchScope, assertBranchAccess } = require('../../permissions/branchAccess');
const { filterFinancialFields } = require('../../permissions/financialVisibility');
const repo = require('./audit.repository');

function toAuditDto(auth, row) {
  const dto = camelize(row);
  delete dto.totalCount;
  // Before/after values keep their original keys; cost and profit inside them are still protected.
  dto.previousValues = row.previous_values ? filterFinancialFields(row.previous_values, auth) : null;
  dto.newValues = row.new_values ? filterFinancialFields(row.new_values, auth) : null;
  return dto;
}

async function listAuditLogs(auth, query) {
  if (query.branchId) assertBranchAccess(auth, query.branchId);
  const params = parseListParams(query, { sortable: { d: '1' }, defaultSort: 'd' });
  const { rows, total } = await repo.listAudit({
    ...query,
    branchIds: resolveBranchScope(auth, null),
    timezone: config.businessTimezone,
    limit: params.limit,
    offset: params.offset,
  });
  return { rows: rows.map((r) => toAuditDto(auth, r)), total, page: params.page, limit: params.limit };
}

async function getAuditLog(auth, id) {
  const row = await repo.findAudit(id);
  if (!row) throw AppError.notFound('Audit entry not found.');
  if (row.branch_id) assertBranchAccess(auth, row.branch_id);
  return toAuditDto(auth, row);
}

async function listAuditActions() {
  return repo.listActions();
}

async function listLoginHistory(auth, query) {
  const params = parseListParams(query, { sortable: { d: '1' }, defaultSort: 'd' });
  const { rows, total } = await repo.listLoginHistory({
    ...query,
    branchIds: resolveBranchScope(auth, null),
    timezone: config.businessTimezone,
    limit: params.limit,
    offset: params.offset,
  });
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

module.exports = { listAuditLogs, getAuditLog, listAuditActions, listLoginHistory };
