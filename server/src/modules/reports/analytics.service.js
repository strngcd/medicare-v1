const config = require('../../config');
const { camelize } = require('../../utils/camelize');
const { money, toMoneyString } = require('../../utils/money');
const { businessToday } = require('../../utils/time');
const { cached } = require('../../utils/cache');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const { resolveBranchScope } = require('../../permissions/branchAccess');
const { filterFinancialFields, omitFields } = require('../../permissions/financialVisibility');
const { getExpiryWarningDays } = require('../inventory/inventoryStatus');
const alertsService = require('../alerts/alerts.service');
const { resolveDateRange } = require('./dateRange');
const { shapeSalesSummary, cacheScope } = require('./reports.service');
const repo = require('./reports.repository');

// stockLosses is also a cost field, so it additionally needs FINANCIAL_VIEW_PURCHASE_COST.
const FINANCIAL_KPIS = ['revenue', 'discounts', 'tax', 'netSales', 'inventoryValue', 'refunds', 'stockLosses', 'stockLossUnits'];
const PROFIT_KPIS = ['cogs', 'grossProfit', 'grossMargin'];

/**
 * Dashboard visibility: financial KPIs need DASHBOARD_VIEW_FINANCIALS,
 * profit KPIs need DASHBOARD_VIEW_PROFIT, and the global financial filter
 * (purchase cost / profit permissions) is applied on top.
 */
function applyDashboardVisibility(auth, data) {
  let result = data;
  if (!auth.permissions.has(P.DASHBOARD_VIEW_FINANCIALS)) result = omitFields(result, FINANCIAL_KPIS);
  if (!auth.permissions.has(P.DASHBOARD_VIEW_PROFIT)) result = omitFields(result, PROFIT_KPIS);
  return filterFinancialFields(result, auth);
}

function baseFilters(auth, query) {
  const range = resolveDateRange(query);
  return {
    range,
    filters: {
      timezone: config.businessTimezone,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      branchIds: resolveBranchScope(auth, query.branchId),
    },
  };
}

async function dashboard(auth, query) {
  const { range, filters } = baseFilters(auth, query);
  const data = await cached(['dashboard', cacheScope(auth, filters.branchIds), filters], async () => {
    const today = businessToday();
    const warningDays = await getExpiryWarningDays();
    const [summaryRaw, totals, totalMedicines, alertCounts, losses] = await Promise.all([
      repo.salesSummary(filters),
      repo.inventoryTotals({ today, warningDays, branchIds: filters.branchIds }),
      repo.countActiveMedicines(),
      alertsService.countAlerts(auth, query.branchId),
      repo.stockLossSummary(filters),
    ]);
    const s = shapeSalesSummary(summaryRaw);
    return {
      period: range,
      sales: {
        totalSales: s.totalSales,
        transactionCount: s.transactionCount,
        itemsSold: s.itemsSold,
        averageTransactionValue: s.averageTransactionValue,
      },
      inventory: {
        totalMedicines,
        lowStock: alertCounts.byType.LOW_STOCK,
        outOfStock: alertCounts.byType.OUT_OF_STOCK,
        expiringSoon: alertCounts.byType.EXPIRING_SOON,
        expired: alertCounts.byType.EXPIRED,
      },
      financials: {
        revenue: s.revenue,
        discounts: s.discounts,
        tax: s.tax,
        refunds: s.refunds,
        netSales: s.netSales,
        inventoryValue: totals.inventory_value,
        // Expired, damaged, lost and disposed stock in the period, at purchase cost.
        stockLosses: losses.total_loss_value,
        stockLossUnits: losses.units_lost,
        cogs: s.cogs,
        grossProfit: s.grossProfit,
        grossMargin: s.grossMargin,
      },
    };
  });
  return applyDashboardVisibility(auth, data);
}

async function salesTrend(auth, query) {
  const { range, filters } = baseFilters(auth, query);
  const series = await cached(['trend', cacheScope(auth, filters.branchIds), filters], () => repo.salesSeries(filters, range.granularity));
  return { period: range, granularity: range.granularity, series: camelize(series) };
}

async function topMedicines(auth, query) {
  const { range, filters } = baseFilters(auth, query);
  const orderBy = query.by === 'revenue' ? 'net_revenue' : 'net_quantity';
  const rows = await cached(['top', cacheScope(auth, filters.branchIds), filters, orderBy, query.limit], () =>
    repo.medicinePerformance(filters, { orderBy, limit: query.limit || 10 }));
  return applyDashboardVisibility(auth, {
    period: range,
    items: camelize(rows).map(({ netRevenue, ...rest }) => ({ ...rest, revenue: netRevenue })),
  });
}

async function salesByCategory(auth, query) {
  const { range, filters } = baseFilters(auth, query);
  const rows = await cached(['by-category', cacheScope(auth, filters.branchIds), filters], () => repo.categoryPerformance(filters));
  return applyDashboardVisibility(auth, {
    period: range,
    categories: camelize(rows).map(({ netRevenue, ...rest }) => ({ ...rest, revenue: netRevenue })),
  });
}

async function inventoryAnalytics(auth, query) {
  const branchIds = resolveBranchScope(auth, query.branchId);
  const today = businessToday();
  const data = await cached(['inventory-analytics', cacheScope(auth, branchIds), today], async () => {
    const warningDays = await getExpiryWarningDays();
    const [distribution, totals, alertCounts] = await Promise.all([
      repo.inventoryDistribution({ today, branchIds }),
      repo.inventoryTotals({ today, warningDays, branchIds }),
      alertsService.countAlerts(auth, query.branchId),
    ]);
    return {
      asOf: today,
      statusCounts: alertCounts.byType,
      totals: camelize(totals),
      expiryBuckets: camelize(distribution.expiry),
      categories: camelize(distribution.categories),
    };
  });
  return applyDashboardVisibility(auth, data);
}

async function branchComparison(auth, query) {
  const { range, filters } = baseFilters(auth, { ...query, branchId: undefined });
  const rows = await cached(['branches', cacheScope(auth, filters.branchIds), filters], () => repo.branchComparison(filters));
  return applyDashboardVisibility(auth, {
    period: range,
    branches: rows.map((r) => {
      const b = camelize(r);
      const revenue = money(b.salesRevenue).minus(b.refundedRevenue);
      const cogs = money(b.salesCogs).minus(b.refundedCogs);
      return {
        branchId: b.branchId,
        branchName: b.branchName,
        branchCode: b.branchCode,
        status: b.status,
        transactionCount: b.transactionCount,
        totalSales: b.grossSales,
        refunds: b.refunds,
        netSales: toMoneyString(money(b.grossSales).minus(b.refunds)),
        averageTransactionValue: b.transactionCount ? toMoneyString(money(b.grossSales).dividedBy(b.transactionCount)) : '0.00',
        revenue: toMoneyString(revenue),
        cogs: toMoneyString(cogs),
        grossProfit: toMoneyString(revenue.minus(cogs)),
      };
    }),
  });
}

module.exports = { dashboard, salesTrend, topMedicines, salesByCategory, inventoryAnalytics, branchComparison };
