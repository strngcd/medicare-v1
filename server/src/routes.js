const express = require('express');
const requireJson = require('./middleware/requireJson');

const router = express.Router();

router.use(requireJson);

router.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' }, message: 'Service is healthy.' });
});

router.use('/auth', require('./modules/auth/auth.routes'));

module.exports = router;
