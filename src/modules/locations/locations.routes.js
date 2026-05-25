const router = require('express').Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const c = require('./locations.controller');

router.use(authenticate);
router.get('/', c.list);
router.get('/:id', c.getOne);
router.post('/', requireRole('ADMIN'), c.createOne);
router.patch('/:id', requireRole('ADMIN'), c.updateOne);

module.exports = router;
