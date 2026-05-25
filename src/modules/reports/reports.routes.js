const router = require('express').Router();
const { authenticate } = require('../../middleware/auth');
const c = require('./reports.controller');

router.use(authenticate);
router.get('/showroom-summary', c.showroomSummary);
router.get('/aging', c.aging);
router.get('/sales-summary', c.salesSummary);
router.get('/cross-showroom-search', c.crossShowroomSearch);

module.exports = router;
