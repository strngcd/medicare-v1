const AppError = require('../../errors/AppError');
const { parseListParams } = require('../../utils/pagination');
const { camelize } = require('../../utils/camelize');
const { businessToday } = require('../../utils/time');
const { resolveBranchScope } = require('../../permissions/branchAccess');
const { getExpiryWarningDays } = require('../inventory/inventoryStatus');
const repo = require('./alerts.repository');

const MESSAGES = {
  EXPIRED: (a) => `${a.medicine_name} batch ${a.batch_number} expired on ${a.expiry_date} (${a.quantity} units in stock).`,
  EXPIRING_SOON: (a) => `${a.medicine_name} batch ${a.batch_number} expires on ${a.expiry_date} (${a.quantity} units).`,
  OUT_OF_STOCK: (a) => `${a.medicine_name} is out of stock.`,
  LOW_STOCK: (a) => `${a.medicine_name} is low: ${a.quantity} sellable units (minimum ${a.minimum_stock}).`,
};

function toDto(row) {
  const dto = camelize(row);
  delete dto.totalCount;
  delete dto.severityRank;
  dto.message = MESSAGES[row.type](row);
  return dto;
}

async function scope(auth, branchId) {
  return {
    today: businessToday(),
    warningDays: await getExpiryWarningDays(),
    branchIds: resolveBranchScope(auth, branchId),
  };
}

async function listAlerts(auth, query) {
  const params = parseListParams(query, { sortable: { default: '1' }, defaultSort: 'default' });
  const { rows, total } = await repo.list({
    ...(await scope(auth, query.branchId)),
    type: query.type,
    severity: query.severity,
    limit: params.limit,
    offset: params.offset,
  });
  return { rows: rows.map(toDto), total, page: params.page, limit: params.limit };
}

async function countAlerts(auth, branchId) {
  const rows = await repo.counts(await scope(auth, branchId));
  const byType = { EXPIRED: 0, EXPIRING_SOON: 0, OUT_OF_STOCK: 0, LOW_STOCK: 0 };
  const bySeverity = { CRITICAL: 0, HIGH: 0, WARNING: 0 };
  for (const row of rows) {
    byType[row.type] += row.count;
    bySeverity[row.severity] += row.count;
  }
  return { total: Object.values(byType).reduce((a, b) => a + b, 0), byType, bySeverity };
}

async function getAlert(auth, id) {
  const alert = await repo.findById(id, await scope(auth, null));
  // Missing means resolved, unknown, or outside the user's branches.
  if (!alert) throw AppError.notFound('This alert is no longer active.');
  return toDto(alert);
}

module.exports = { listAlerts, countAlerts, getAlert };
