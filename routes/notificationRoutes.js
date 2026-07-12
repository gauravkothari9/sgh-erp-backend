const express = require('express');
const { protect } = require('../middleware/auth');
const { list, markRead, markAllRead } = require('../controllers/notificationController');

const router = express.Router();

// Every route requires a signed-in user; each user only ever sees their own
// notifications (no module permission — notifications are personal).
router.use(protect);

router.get('/', list);
router.patch('/read-all', markAllRead);
router.patch('/:id/read', markRead);

module.exports = router;
