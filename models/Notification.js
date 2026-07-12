/**
 * In-app notification — one document per recipient user.
 *
 * Produced by server-side events (currently: a file's container becoming
 * complete — every item Ready for Container) and consumed by the navbar bell
 * via GET /notifications. Kept deliberately simple: no channels/websockets,
 * the client polls.
 */
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'V1User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      default: 'general',
      index: true,
    },
    title: { type: String, trim: true },
    message: { type: String, trim: true },
    // Optional context so the client can deep-link.
    fileNumber: { type: String, trim: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    link: { type: String, trim: true },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
