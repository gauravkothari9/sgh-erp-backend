const router = require('express').Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const c = require('./stock.controller');

router.use(authenticate);
router.post('/receive', requireRole('ADMIN', 'MANAGER', 'SHOWROOM_STAFF'), c.receive);
router.post('/transfer', requireRole('ADMIN', 'MANAGER'), c.transfer);
router.get('/balance', c.balance);
router.get('/ledger', c.ledger);

module.exports = router;
