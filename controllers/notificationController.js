const Notification = require('../models/Notification');
const { AppError } = require('../middleware/errorHandler');
const { successResponse } = require('../utils/apiResponse');

// ─── @GET /api/v1/notifications ──────────────────────────────────────────────
// The current user's notifications (newest first) + unread count. Powers the
// navbar bell, which polls this on an interval.
exports.list = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);

  // The bell asks for unread only — once you've opened a notification it drops
  // out of the bell and lives on in the history page (GET without the flag).
  const filter = { user: req.user._id };
  if (req.query.unreadOnly === '1' || req.query.unreadOnly === 'true') filter.isRead = false;

  const [items, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ user: req.user._id, isRead: false }),
  ]);
  successResponse(res, { notifications: items, unreadCount });
};

// ─── @PATCH /api/v1/notifications/:id/read ───────────────────────────────────
exports.markRead = async (req, res) => {
  const n = await Notification.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { isRead: true },
    { new: true }
  );
  if (!n) throw new AppError('Notification not found', 404);
  successResponse(res, { notification: n }, 'Marked as read');
};

// ─── @PATCH /api/v1/notifications/read-all ───────────────────────────────────
exports.markAllRead = async (req, res) => {
  await Notification.updateMany({ user: req.user._id, isRead: false }, { isRead: true });
  successResponse(res, {}, 'All notifications marked as read');
};
