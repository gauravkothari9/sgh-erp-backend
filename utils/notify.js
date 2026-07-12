const Notification = require('../models/Notification');
const User = require('../models/User');
const Settings = require('../models/Settings');
const { pushNotification } = require('./realtime');

/**
 * Fan a notification out to the people it concerns.
 *
 * Recipients = every active Admin (Admins see everything) + every active
 * Employee who holds `read` on one of `modules` — i.e. the staff actually
 * assigned to that part of the platform. A Factory employee gets production
 * alerts, showroom staff get stock alerts, Office gets order alerts.
 *
 * Never throws: a notification failing must not roll back the business action
 * that produced it.
 *
 * @param {string[]} modules  module keys, e.g. ['orders'] or ['showroomKakani']
 * @param {Object} payload    { type, title, message, link?, fileNumber?, orderId? }
 * @param {Object} [opts]     { exclude?: userId — usually the actor themselves,
 *                              onlyUsers?: [userId] — bypass module routing,
 *                              dedupeKey?: { type, fileNumber } — fire once }
 */
// Which settings switch governs each notification type. A group switched off in
// Settings stops dispatching; everything else carries on.
const GROUP_OF = (type) => {
  if (type.startsWith('order-') || type === 'container-complete') return 'orders';
  if (type.startsWith('stage-')) return 'production';
  if (type.startsWith('showroom-')) return 'showroom';
  if (type.startsWith('local-')) return 'local';
  if (type === 'user-created' || type === 'permissions-changed') return 'admin';
  return null;
};

const notify = async (modules, payload, opts = {}) => {
  try {
    const group = GROUP_OF(payload?.type || '');
    if (group) {
      const settings = await Settings.getSingleton();
      if (settings.notifications?.[group] === false) return;
    }

    if (opts.dedupeKey) {
      const already = await Notification.exists(opts.dedupeKey);
      if (already) return;
    }

    let recipients;
    if (opts.onlyUsers?.length) {
      recipients = opts.onlyUsers.map((id) => ({ _id: id }));
    } else {
      const or = [{ role: 'Admin' }];
      (modules || []).forEach((m) => or.push({ [`permissions.${m}.read`]: true }));
      recipients = await User.find({ isActive: true, $or: or }).select('_id').lean();
    }

    const exclude = opts.exclude ? String(opts.exclude) : null;
    const docs = recipients
      .filter((u) => String(u._id) !== exclude)
      .map((u) => ({ user: u._id, ...payload }));

    if (!docs.length) return;

    const saved = await Notification.insertMany(docs);
    // Push to anyone who's online right now; the bell's poll is the fallback.
    saved.forEach((n) => pushNotification(n.user, n.toObject ? n.toObject() : n));
  } catch (err) {
    console.error('Notification dispatch failed', payload?.type, err.message);
  }
};

// Showroom branch → the module that governs it.
const showroomModule = (branch) =>
  branch === 'Kakani' ? 'showroomKakani' : 'showroomJhalamand';

module.exports = { notify, showroomModule };
