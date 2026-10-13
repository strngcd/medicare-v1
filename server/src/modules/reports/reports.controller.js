const service = require('./reports.service');
const analytics = require('./analytics.service');
const { toCsv, toPdf } = require('./exporter');
const { recordAudit, actorFromRequest } = require('../audit/audit.recorder');
const repo = require('./reports.repository');
const { sendData } = require('../../utils/response');

const REPORTS = {
  sales: service.salesReport,
  profit: service.profitReport,
  inventory: service.inventoryReport,
  losses: service.lossReport,
  purchases: service.purchaseReport,
  suppliers: service.supplierReport,
};

function sendReport(res, report) {
  const { pagination, ...data } = report;
  res.json({ success: true, data, pagination: pagination && { ...pagination, totalPages: Math.max(1, Math.ceil(pagination.total / pagination.limit)) } });
}

/** Builds an export handler that reuses the report service with all rows. */
function exportHandler(name) {
  return async (req, res) => {
    const { format, ...filters } = req.valid.query;
    const report = await REPORTS[name](req.auth, filters, { exportAll: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${name}-report-${stamp}.${format}`;

    // Exports are logged in the audit trail (who exported what, with which filters).
    await recordAudit(undefined, actorFromRequest(req), {
      action: 'REPORT_EXPORTED',
      entityType: 'REPORT',
      branchId: filters.branchId || null,
      description: `${report.title} exported as ${format.toUpperCase()} (${report.rows.length} rows)`,
      newValues: { report: name, format, filters },
    });

    if (format === 'csv') {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(toCsv(report));
    }
    const pdf = await toPdf(report, {
      pharmacyName: await repo.pharmacyName(),
      generatedBy: req.auth.fullName,
    });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdf);
  };
}

module.exports = {
  sales: async (req, res) => sendReport(res, await service.salesReport(req.auth, req.valid.query)),
  profit: async (req, res) => sendReport(res, await service.profitReport(req.auth, req.valid.query)),
  inventory: async (req, res) => sendReport(res, await service.inventoryReport(req.auth, req.valid.query)),
  movements: async (req, res) => sendReport(res, await service.movementReport(req.auth, req.valid.query)),
  losses: async (req, res) => sendReport(res, await service.lossReport(req.auth, req.valid.query)),
  purchases: async (req, res) => sendReport(res, await service.purchaseReport(req.auth, req.valid.query)),
  suppliers: async (req, res) => sendReport(res, await service.supplierReport(req.auth, req.valid.query)),
  exportSales: exportHandler('sales'),
  exportLosses: exportHandler('losses'),
  exportProfit: exportHandler('profit'),
  exportInventory: exportHandler('inventory'),
  exportPurchases: exportHandler('purchases'),
  exportSuppliers: exportHandler('suppliers'),

  dashboard: async (req, res) => sendData(res, await analytics.dashboard(req.auth, req.valid.query)),
  salesTrend: async (req, res) => sendData(res, await analytics.salesTrend(req.auth, req.valid.query)),
  topMedicines: async (req, res) => sendData(res, await analytics.topMedicines(req.auth, req.valid.query)),
  salesByCategory: async (req, res) => sendData(res, await analytics.salesByCategory(req.auth, req.valid.query)),
  inventoryAnalytics: async (req, res) => sendData(res, await analytics.inventoryAnalytics(req.auth, req.valid.query)),
  branchComparison: async (req, res) => sendData(res, await analytics.branchComparison(req.auth, req.valid.query)),
};
