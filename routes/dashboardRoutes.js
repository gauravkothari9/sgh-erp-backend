const express = require('express');
const { protect } = require('../middleware/auth');
const { getDashboard } = require('../controllers/dashboardController');

const router = express.Router();

// No module gate: the controller assembles the payload from whatever modules
// the signed-in user actually holds, so everyone can call it safely.
router.use(protect);
router.get('/', getDashboard);

module.exports = router;
