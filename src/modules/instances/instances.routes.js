const router = require('express').Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const c = require('./instances.controller');

router.use(authenticate);
router.get('/', c.list);
router.get('/by-code/:code', c.getByCode);
router.get('/:id', c.getOne);
router.get('/:id/history', c.getHistory);
router.get('/:id/qr', c.getQR);
router.post('/', requireRole('ADMIN', 'MANAGER', 'SHOWROOM_STAFF'), c.createOne);
router.patch('/:id', requireRole('ADMIN', 'MANAGER', 'SHOWROOM_STAFF'), c.updateOne);

module.exports = router;
