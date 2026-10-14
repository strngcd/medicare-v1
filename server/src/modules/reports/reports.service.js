const config = require('../../config');
const AppError = require('../../errors/AppError');
const { camelize } = require('../../utils/camelize');
const { money, round2, toMoneyString } = require('../../utils/money');
const { businessToday } = require('../../utils/time');
const { cached } = require('../../utils/cache');
const { parseListParams } = require('../../utils/pagination');
const { resolveBranchScope } = require('../../permissions/branchAccess');
const { filterFinancialFields, omitFields, canViewCost } = require('../../permissions/financialVisibility');
const { getExpiryWarningDays } = require('../inventory/inventoryStatus');
const salesService = require('../sales/sales.service');
const inventoryService = require('../inventory/inventory.service');
const purchasesService = require('../purchases/purchases.service');
const refundsService = require('../refunds/refunds.service');
const { resolveDateRange } = require('./dateRange');
const repo = require('./reports.repository');

// Amounts on purchase/supplier reports are acquisition cost.
const PURCHASE_AMOUNTS = [
  'orderedValue', 'receivedValue', 'totalPaid', 'outstanding', 'totalPurchased', 'balance',
  'subtotal', 'discount', 'tax', 'total', 'amountPaid',
];

/**
 * Removes column definitions for fields the user may not see. A column is
 * kept only if a probe row with that key survives the same visibility rules
 * applied to the data.
 */
function restrictColumns(report, auth, extraHidden = []) {
  const hidden = new Set(extraHidden);
  const visible = report.columns.filter((column) => {
    if (hidden.has(column.key)) return false;
    const probe = filterFinancialFields({ [column.key]: 1 }, auth);
    return Object.prototype.hasOwnProperty.call(probe, column.key);
  });
  return { ...report, columns: visible };
}

/** Purchase/supplier amounts are acquisition cost: strip them from data and columns. */
function hidePurchaseAmounts(report, auth) {
  return restrictColumns({
    ...report,
    summary: report.summary && omitFields(report.summary, PURCHASE_AMOUNTS),
    rows: omitFields(report.rows, PURCHASE_AMOUNTS),
  }, auth, PURCHASE_AMOUNTS);
}

/** Cache key parts that capture everything affecting the response. */
function cacheScope(auth, branchIds) {
  return {
    branches: branchIds ? [...branchIds].sort() : 'ALL',
    permissions: [...auth.permissions].sort(),
  };
}

function salesFilters(auth, query) {
  const range = resolveDateRange(query);
  return {
    range,
    filters: {
      timezone: config.businessTimezone,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      branchIds: resolveBranchScope(auth, query.branchId),
      staffId: query.staffId,
      medicineId: query.medicineId,
      categoryId: query.categoryId,
      productType: query.productType,
      paymentMethod: query.paymentMethod,
      receiptNumber: query.receiptNumber,
      minAmount: query.minAmount,
      maxAmount: query.maxAmount,
    },
  };
}

/** Turns raw aggregates into the documented KPI set (decimal math). */
function shapeSalesSummary(raw) {
  const s = camelize(raw);
  const revenue = money(s.salesRevenue).minus(s.refundedRevenue);
  const cogs = money(s.salesCogs).minus(s.refundedCogs);
  const grossProfit = revenue.minus(cogs);
  return {
    totalSales: s.grossSales,
    transactionCount: s.transactionCount,
    itemsSold: s.itemsSold,
    averageTransactionValue: s.transactionCount ? toMoneyString(money(s.grossSales).dividedBy(s.transactionCount)) : '0.00',
    cashSales: s.cashSales,
    bankTransferSales: s.bankTransferSales,
    subtotal: s.subtotal,
    discounts: s.discounts,
    tax: s.tax,
    refunds: s.refunds,
    refundCount: s.refundCount,
    itemsRefunded: s.itemsRefunded,
    netSales: toMoneyString(money(s.grossSales).minus(s.refunds)),
    voidedCount: s.voidedCount,
    voidedTotal: s.voidedTotal,
    // Profit figures (removed for users without FINANCIAL_VIEW_PROFIT).
    revenue: toMoneyString(revenue),
    cogs: toMoneyString(cogs),
    grossProfit: toMoneyString(grossProfit),
    grossMargin: revenue.isZero() ? '0.00' : toMoneyString(round2(grossProfit.dividedBy(revenue).times(100))),
  };
}

// Exports contain every matching row in one query. Past this size a file is
// refused with a clear message rather than silently cut short.
const MAX_EXPORT_ROWS = config.exportMaxRows;
const EXPORT_FETCH_LIMIT = MAX_EXPORT_ROWS + 1;
const EXPORT_PARAMS = Object.freeze({ page: 1, limit: EXPORT_FETCH_LIMIT, offset: 0 });

function exportRows(rows) {
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new AppError(
      'EXPORT_TOO_LARGE',
      `This export has more than ${MAX_EXPORT_ROWS.toLocaleString('en-US')} rows. Narrow the date range or filters and export in parts.`,
      422,
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

async function salesReport(auth, query, { exportAll = false } = {}) {
  const { range, filters } = salesFilters(auth, query);
  const summary = await cached(['sales-summary', cacheScope(auth, filters.branchIds), filters], async () => {
    const raw = await repo.salesSummary(filters);
    return { ...shapeSalesSummary(raw), series: camelize(await repo.salesSeries(filters, range.granularity)) };
  });
  const { series, ...kpis } = summary;
  // The sales report shows sales KPIs only; profit lives in the profit report.
  const salesKpis = omitFields(kpis, ['revenue', 'cogs', 'grossProfit', 'grossMargin']);

  const listQuery = { ...query, dateFrom: range.dateFrom, dateTo: range.dateTo };
  const list = exportAll ? null : await salesService.listSales(auth, listQuery);
  const rows = exportAll
    ? exportRows((await salesService.listSales(auth, listQuery, { exportLimit: EXPORT_FETCH_LIMIT })).rows)
    : list.rows;

  return restrictColumns({
    title: 'Sales report',
    period: range,
    summary: salesKpis,
    series,
    columns: [
      { key: 'receiptNumber', label: 'Receipt' },
      { key: 'completedAt', label: 'Date' },
      { key: 'branchName', label: 'Branch' },
      { key: 'soldByName', label: 'Staff' },
      { key: 'status', label: 'Status' },
      { key: 'paymentMethod', label: 'Payment' },
      { key: 'itemCount', label: 'Items' },
      { key: 'subtotal', label: 'Subtotal' },
      { key: 'discount', label: 'Discount' },
      { key: 'tax', label: 'Tax' },
      { key: 'total', label: 'Total' },
      { key: 'refundedTotal', label: 'Refunded' },
    ],
    rows,
    pagination: exportAll ? undefined : { page: list.page, limit: list.limit, total: list.total },
  }, auth);
}

async function profitReport(auth, query) {
  const { range, filters } = salesFilters(auth, query);
  const data = await cached(['profit', cacheScope(auth, filters.branchIds), filters], async () => {
    const summary = shapeSalesSummary(await repo.salesSummary(filters));
    const [byMedicine, byCategory, losses] = await Promise.all([
      repo.medicinePerformance(filters, { orderBy: 'gross_profit', limit: 1000 }),
      repo.categoryPerformance(filters),
      repo.stockLossSummary(filters),
    ]);
    return { summary, byMedicine: camelize(byMedicine), byCategory: camelize(byCategory), stockLosses: losses.total_loss_value };
  });
  return restrictColumns(filterFinancialFields({
    title: 'Profit report',
    period: range,
    summary: {
      revenue: data.summary.revenue,
      cogs: data.summary.cogs,
      grossProfit: data.summary.grossProfit,
      grossMargin: data.summary.grossMargin,
      stockLosses: toMoneyString(data.stockLosses),
      netProfit: toMoneyString(money(data.summary.grossProfit).minus(data.stockLosses)),
      discounts: data.summary.discounts,
      tax: data.summary.tax,
      refunds: data.summary.refunds,
      netSales: data.summary.netSales,
    },
    byCategory: data.byCategory,
    columns: [
      { key: 'medicineName', label: 'Medicine' },
      { key: 'categoryName', label: 'Category' },
      { key: 'quantitySold', label: 'Sold' },
      { key: 'quantityRefunded', label: 'Refunded' },
      { key: 'netQuantity', label: 'Net qty' },
      { key: 'netRevenue', label: 'Revenue' },
      { key: 'cogs', label: 'COGS' },
      { key: 'grossProfit', label: 'Gross profit' },
    ],
    rows: data.byMedicine,
  }, auth), auth);
}

async function inventoryReport(auth, query, { exportAll = false } = {}) {
  const branchIds = resolveBranchScope(auth, query.branchId);
  const today = businessToday();
  const warningDays = await getExpiryWarningDays();
  const params = exportAll ? EXPORT_PARAMS : parseListParams(query, { sortable: { d: '1' }, defaultSort: 'd' });
  const [positions, totals] = await Promise.all([
    repo.inventoryPositions({ today, warningDays, branchIds, categoryId: query.categoryId, productType: query.productType, status: query.status, limit: params.limit, offset: params.offset }),
    cached(['inventory-totals', cacheScope(auth, branchIds), today], () => repo.inventoryTotals({ today, warningDays, branchIds })),
  ]);
  return restrictColumns(filterFinancialFields({
    title: 'Inventory report',
    asOf: today,
    summary: camelize(totals),
    columns: [
      { key: 'medicineName', label: 'Medicine' },
      { key: 'categoryName', label: 'Category' },
      { key: 'branchName', label: 'Branch' },
      { key: 'sellableQuantity', label: 'Sellable' },
      { key: 'expiredQuantity', label: 'Expired' },
      { key: 'minimumStock', label: 'Minimum' },
      { key: 'nearestExpiry', label: 'Nearest expiry' },
      { key: 'status', label: 'Status' },
      { key: 'inventoryValue', label: 'Value (cost)' },
    ],
    rows: (exportAll ? exportRows(positions.rows) : positions.rows).map((r) => {
      const dto = camelize(r);
      delete dto.totalCount;
      return dto;
    }),
    pagination: exportAll ? undefined : { page: params.page, limit: params.limit, total: positions.total },
  }, auth), auth);
}

async function movementReport(auth, query) {
  const range = resolveDateRange(query);
  const branchIds = resolveBranchScope(auth, query.branchId);
  const [summary, list] = await Promise.all([
    repo.movementSummary({ timezone: config.businessTimezone, dateFrom: range.dateFrom, dateTo: range.dateTo, branchIds }),
    inventoryService.listMovements(auth, { ...query, dateFrom: range.dateFrom, dateTo: range.dateTo }),
  ]);
  return restrictColumns({
    title: 'Inventory movements report',
    period: range,
    summary: camelize(summary),
    columns: [
      { key: 'createdAt', label: 'Date' },
      { key: 'branchName', label: 'Branch' },
      { key: 'medicineName', label: 'Medicine' },
      { key: 'batchNumber', label: 'Batch' },
      { key: 'movementType', label: 'Type' },
      { key: 'quantityChange', label: 'Change' },
      { key: 'quantityAfter', label: 'After' },
      { key: 'createdByName', label: 'By' },
      { key: 'reason', label: 'Reason' },
    ],
    rows: list.rows,
    pagination: { page: list.page, limit: list.limit, total: list.total },
  }, auth);
}

/**
 * Refunds with the Refunds page filters. A named range (or no dates at all,
 * meaning all time) is supported so the page can export exactly what it shows.
 */
async function refundReport(auth, query, { exportAll = false } = {}) {
  const range = query.range ? resolveDateRange(query) : null;
  const listQuery = range ? { ...query, dateFrom: range.dateFrom, dateTo: range.dateTo } : query;
  const [summary, rows, list] = await Promise.all([
    refundsService.refundSummary(auth, listQuery),
    exportAll ? refundsService.listRefunds(auth, listQuery, { exportLimit: EXPORT_FETCH_LIMIT }).then((r) => exportRows(r.rows)) : null,
    exportAll ? null : refundsService.listRefunds(auth, listQuery),
  ]);
  return {
    title: 'Refund report',
    period: range || (query.dateFrom || query.dateTo ? { dateFrom: query.dateFrom || null, dateTo: query.dateTo || null } : undefined),
    summary,
    columns: [
      { key: 'refundNumber', label: 'Refund' },
      { key: 'createdAt', label: 'Date' },
      { key: 'receiptNumber', label: 'Sale' },
      { key: 'branchName', label: 'Branch' },
      { key: 'reason', label: 'Reason' },
      { key: 'paymentMethod', label: 'Method' },
      { key: 'refundTotal', label: 'Amount' },
      { key: 'processedByName', label: 'Processed by' },
    ],
    rows: exportAll ? rows : list.rows,
    pagination: exportAll ? undefined : { page: list.page, limit: list.limit, total: list.total },
  };
}

/** Stock written off (expired, disposed, damaged, lost), valued at purchase cost. */
async function lossReport(auth, query, { exportAll = false } = {}) {
  const range = resolveDateRange({ range: query.range || (query.dateFrom ? 'CUSTOM' : 'MONTH'), ...query });
  const filters = {
    timezone: config.businessTimezone,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    branchIds: resolveBranchScope(auth, query.branchId),
    movementType: query.movementType,
  };
  const params = exportAll ? EXPORT_PARAMS : parseListParams(query, { sortable: { d: '1' }, defaultSort: 'd' });
  const [summary, list] = await Promise.all([
    repo.stockLossSummary(filters),
    repo.stockLosses(filters, { limit: params.limit, offset: params.offset }),
  ]);
  return restrictColumns(filterFinancialFields({
    title: 'Stock loss report',
    period: range,
    summary: camelize(summary),
    columns: [
      { key: 'createdAt', label: 'Date' },
      { key: 'branchName', label: 'Branch' },
      { key: 'medicineName', label: 'Medicine' },
      { key: 'batchNumber', label: 'Batch' },
      { key: 'expiryDate', label: 'Expiry' },
      { key: 'movementType', label: 'Type' },
      { key: 'quantity', label: 'Units' },
      { key: 'unitCost', label: 'Unit cost' },
      { key: 'lossValue', label: 'Loss' },
      { key: 'createdByName', label: 'By' },
      { key: 'reason', label: 'Reason' },
    ],
    rows: (exportAll ? exportRows(list.rows) : list.rows).map((r) => {
      const dto = camelize(r);
      delete dto.totalCount;
      return dto;
    }),
    pagination: exportAll ? undefined : { page: params.page, limit: params.limit, total: list.total },
  }, auth), auth);
}

async function purchaseReport(auth, query, { exportAll = false } = {}) {
  const range = resolveDateRange({ range: query.range || (query.dateFrom ? 'CUSTOM' : 'MONTH'), ...query });
  const branchIds = resolveBranchScope(auth, query.branchId);
  const summary = await repo.purchaseSummary({
    dateFrom: range.dateFrom, dateTo: range.dateTo, branchIds, supplierId: query.supplierId, status: query.status,
  });
  const listQuery = { ...query, dateFrom: range.dateFrom, dateTo: range.dateTo };
  const rows = exportAll
    ? exportRows((await purchasesService.listPurchases(auth, listQuery, {}, { exportLimit: EXPORT_FETCH_LIMIT })).rows)
    : null;
  const list = exportAll ? null : await purchasesService.listPurchases(auth, listQuery);
  const report = {
    title: 'Purchase report',
    period: range,
    summary: camelize(summary),
    columns: [
      { key: 'purchaseNumber', label: 'Purchase' },
      { key: 'purchaseDate', label: 'Date' },
      { key: 'supplierName', label: 'Supplier' },
      { key: 'branchName', label: 'Branch' },
      { key: 'status', label: 'Status' },
      { key: 'paymentStatus', label: 'Payment' },
      { key: 'total', label: 'Total' },
      { key: 'amountPaid', label: 'Paid' },
      { key: 'balance', label: 'Balance' },
    ],
    rows: exportAll ? rows : list.rows,
    pagination: exportAll ? undefined : { page: list.page, limit: list.limit, total: list.total },
  };
  return canViewCost(auth) ? report : hidePurchaseAmounts(report, auth);
}

async function supplierReport(auth, query, { exportAll = false } = {}) {
  const range = resolveDateRange({ range: query.range || (query.dateFrom ? 'CUSTOM' : 'YEAR'), ...query });
  const branchIds = resolveBranchScope(auth, query.branchId);
  const params = exportAll ? EXPORT_PARAMS : parseListParams(query, { sortable: { d: '1' }, defaultSort: 'd' });
  const { rows, total } = await repo.supplierSummary({
    dateFrom: range.dateFrom, dateTo: range.dateTo, branchIds, search: query.search, limit: params.limit, offset: params.offset,
  });
  const report = {
    title: 'Supplier report',
    period: range,
    columns: [
      { key: 'companyName', label: 'Supplier' },
      { key: 'phone', label: 'Phone' },
      { key: 'status', label: 'Status' },
      { key: 'purchaseCount', label: 'Purchases' },
      { key: 'totalPurchased', label: 'Purchased' },
      { key: 'totalPaid', label: 'Paid' },
      { key: 'balance', label: 'Balance' },
      { key: 'lastPurchaseDate', label: 'Last purchase' },
    ],
    rows: (exportAll ? exportRows(rows) : rows).map((r) => {
      const dto = camelize(r);
      delete dto.totalCount;
      return dto;
    }),
    pagination: exportAll ? undefined : { page: params.page, limit: params.limit, total },
  };
  return canViewCost(auth) ? report : hidePurchaseAmounts(report, auth);
}


module.exports = {
  salesReport,
  profitReport,
  inventoryReport,
  movementReport,
  lossReport,
  refundReport,
  purchaseReport,
  supplierReport,
  shapeSalesSummary,
  salesFilters,
  cacheScope,
};
