const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const c = require('./auth.controller');

router.get('/admin-exists', c.adminExists);
router.post('/setup-admin', c.setupAdmin);
router.post('/login', c.login);
router.post('/refresh', c.refresh);
router.post('/logout', authenticate, c.logout);
router.get('/me', authenticate, c.me);

module.exports = router;
