const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/authorize');
const { PERMISSIONS: P } = require('../../permissions/catalog');
const controller = require('./reports.controller');
const v = require('./reports.validators');

/** /api/v1/reports — exports require REPORT_EXPORT plus the report's own permissions. */
const reportsRouter = express.Router();
reportsRouter.use(authenticate);

const PROFIT = [P.REPORT_PROFIT_VIEW, P.FINANCIAL_VIEW_PROFIT];

reportsRouter.get('/sales', requirePermission(P.REPORT_SALES_VIEW), validate({ query: v.salesReportQuery }), controller.sales);
reportsRouter.get('/profit', requirePermission(...PROFIT), validate({ query: v.salesReportQuery }), controller.profit);
reportsRouter.get('/inventory', requirePermission(P.REPORT_INVENTORY_VIEW), validate({ query: v.inventoryReportQuery }), controller.inventory);
reportsRouter.get('/inventory/movements', requirePermission(P.REPORT_INVENTORY_VIEW), validate({ query: v.movementReportQuery }), controller.movements);
reportsRouter.get('/purchases', requirePermission(P.REPORT_PURCHASE_VIEW), validate({ query: v.purchaseReportQuery }), controller.purchases);
reportsRouter.get('/suppliers', requirePermission(P.REPORT_SUPPLIER_VIEW), validate({ query: v.supplierReportQuery }), controller.suppliers);

reportsRouter.get('/sales/export', requirePermission(P.REPORT_EXPORT, P.REPORT_SALES_VIEW),
  validate({ query: v.salesReportQuery.extend(v.exportFormat) }), controller.exportSales);
reportsRouter.get('/profit/export', requirePermission(P.REPORT_EXPORT, ...PROFIT),
  validate({ query: v.salesReportQuery.extend(v.exportFormat) }), controller.exportProfit);
reportsRouter.get('/inventory/export', requirePermission(P.REPORT_EXPORT, P.REPORT_INVENTORY_VIEW),
  validate({ query: v.inventoryReportQuery.extend(v.exportFormat) }), controller.exportInventory);
reportsRouter.get('/purchases/export', requirePermission(P.REPORT_EXPORT, P.REPORT_PURCHASE_VIEW),
  validate({ query: v.purchaseReportQuery.extend(v.exportFormat) }), controller.exportPurchases);
reportsRouter.get('/suppliers/export', requirePermission(P.REPORT_EXPORT, P.REPORT_SUPPLIER_VIEW),
  validate({ query: v.supplierReportQuery.extend(v.exportFormat) }), controller.exportSuppliers);

/** /api/v1/analytics */
const analyticsRouter = express.Router();
analyticsRouter.use(authenticate, requirePermission(P.DASHBOARD_VIEW));
analyticsRouter.get('/dashboard', validate({ query: v.analyticsQuery }), controller.dashboard);
analyticsRouter.get('/sales-trend', validate({ query: v.analyticsQuery }), controller.salesTrend);
analyticsRouter.get('/top-medicines', validate({ query: v.analyticsQuery }), controller.topMedicines);
analyticsRouter.get('/sales-by-category', validate({ query: v.analyticsQuery }), controller.salesByCategory);
analyticsRouter.get('/inventory', validate({ query: v.analyticsQuery }), controller.inventoryAnalytics);
analyticsRouter.get('/branch-comparison', validate({ query: v.analyticsQuery }), controller.branchComparison);

module.exports = { reportsRouter, analyticsRouter };
