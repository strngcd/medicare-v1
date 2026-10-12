const express = require('express');
const requireJson = require('./middleware/requireJson');

const router = express.Router();

router.use(requireJson);

router.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' }, message: 'Service is healthy.' });
});

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

module.exports = router;
