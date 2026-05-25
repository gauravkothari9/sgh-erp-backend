const router = require('express').Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const c = require('./reservations.controller');

router.use(authenticate);
router.get('/', c.list);
router.post('/', requireRole('ADMIN', 'MANAGER', 'SHOWROOM_STAFF'), c.createOne);
router.patch('/:id/cancel', requireRole('ADMIN', 'MANAGER', 'SHOWROOM_STAFF'), c.cancel);
router.patch('/:id/convert', requireRole('ADMIN', 'MANAGER', 'SHOWROOM_STAFF'), c.convert);

module.exports = router;
