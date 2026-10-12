const express = require('express');
const authenticate = require('../../middleware/authenticate');
const validate = require('../../middleware/validate');
const { z } = require('../../validators/common');
const { CATEGORY_LABELS } = require('./help.service');
const controller = require('./help.controller');

const router = express.Router();
// Help is available to every signed-in user.
router.use(authenticate);

router.get('/', validate({ query: z.object({ category: z.enum(Object.keys(CATEGORY_LABELS)).optional() }) }), controller.list);
router.get('/search', validate({ query: z.object({ q: z.string().trim().min(2, 'Type at least 2 characters.').max(100) }) }), controller.search);
router.get('/:id', validate({ params: z.object({ id: z.string().regex(/^[a-z0-9-]{1,80}$/i) }) }), controller.get);

module.exports = router;
