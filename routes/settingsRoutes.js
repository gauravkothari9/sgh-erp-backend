const express = require('express');
const { protect, requirePermission } = require('../middleware/auth');
const { getSettings, updateSettings } = require('../controllers/settingsController');

const router = express.Router();

router.use(protect);

// Everyone can read (bills carry the company block); only `settings` can write.
router.get('/', getSettings);
router.put('/', requirePermission('settings', 'update'), updateSettings);

module.exports = router;
