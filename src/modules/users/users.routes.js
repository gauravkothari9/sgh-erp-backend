const router = require('express').Router();
const { authenticate, requireRole } = require('../../middleware/auth');
const c = require('./users.controller');

router.use(authenticate, requireRole('ADMIN'));
router.get('/', c.list);
router.get('/:id', c.getOne);
router.post('/', c.createOne);
router.patch('/:id', c.updateOne);
router.delete('/:id', c.remove);

module.exports = router;
