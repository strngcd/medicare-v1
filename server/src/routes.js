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

module.exports = router;
