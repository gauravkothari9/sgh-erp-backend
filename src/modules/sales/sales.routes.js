const router = require('express').Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const c = require('./sales.controller');

router.use(authenticate);
router.get('/', c.list);
router.post('/', requireRole('ADMIN', 'MANAGER', 'SHOWROOM_STAFF'), c.createOne);
router.patch('/:id', requireRole('ADMIN', 'MANAGER'), c.updateOne);
router.get('/:id/invoice', c.invoice);

module.exports = router;
