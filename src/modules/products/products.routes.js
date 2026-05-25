const router = require('express').Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const c = require('./products.controller');

router.use(authenticate);
router.get('/', c.list);
router.get('/:id', c.getOne);
router.post('/', requireRole('ADMIN', 'MANAGER'), c.createOne);
router.patch('/:id', requireRole('ADMIN', 'MANAGER'), c.updateOne);
router.delete('/:id', requireRole('ADMIN'), c.removeOne);

module.exports = router;
