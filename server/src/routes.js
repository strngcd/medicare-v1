const express = require('express');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' }, message: 'Service is healthy.' });
});

module.exports = router;
