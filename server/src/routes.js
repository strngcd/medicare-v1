const express = require('express');
const requireJson = require('./middleware/requireJson');
const { invalidateOnWrite } = require('./utils/cache');

const router = express.Router();

router.use(requireJson);
router.use(invalidateOnWrite);

router.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' }, message: 'Service is healthy.' });
});

// Public: the sign-in page shows the pharmacy name and logo (nothing else).
router.get('/branding', require('./modules/settings/settings.controller').branding);

router.use('/auth', require('./modules/auth/auth.routes'));
router.use('/users', require('./modules/users/users.routes'));
router.use('/branches', require('./modules/branches/branches.routes'));
router.use('/medicine-categories', require('./modules/categories/categories.routes'));
router.use('/medicines', require('./modules/medicines/medicines.routes'));
router.use('/suppliers', require('./modules/suppliers/suppliers.routes'));

const { inventoryRouter, batchesRouter } = require('./modules/inventory/inventory.routes');
router.use('/inventory', inventoryRouter);
router.use('/batches', batchesRouter);

const { purchasesRouter, receivingsRouter } = require('./modules/purchases/purchases.routes');
router.use('/purchases', purchasesRouter);
router.use('/purchase-receivings', receivingsRouter);
router.use('/supplier-payments', require('./modules/supplierPayments/supplierPayments.routes'));
router.use('/sales', require('./modules/sales/sales.routes'));
router.use('/refunds', require('./modules/refunds/refunds.routes'));
router.use('/transfers', require('./modules/transfers/transfers.routes'));
router.use('/alerts', require('./modules/alerts/alerts.routes'));
router.use('/notifications', require('./modules/notifications/notifications.routes'));

const { reportsRouter, analyticsRouter } = require('./modules/reports/reports.routes');
router.use('/reports', reportsRouter);
router.use('/analytics', analyticsRouter);

const { auditRouter, loginHistoryRouter } = require('./modules/audit/audit.routes');
router.use('/audit-logs', auditRouter);
router.use('/login-history', loginHistoryRouter);

const { settingsRouter, systemRouter } = require('./modules/settings/settings.routes');
router.use('/settings', settingsRouter);
router.use('/system', systemRouter);
router.use('/help', require('./modules/help/help.routes'));
router.use('/search', require('./modules/search/search.routes'));

module.exports = router;
