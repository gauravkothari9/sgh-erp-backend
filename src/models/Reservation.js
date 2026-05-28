const mongoose = require('mongoose');

const RESERVATION_STATUSES = ['ACTIVE', 'CONVERTED_TO_SALE', 'CANCELLED', 'EXPIRED'];

const reservationSchema = new mongoose.Schema(
  {
    reservationNo: { type: String, required: true, unique: true, index: true }, // RSV-YYYY-00001
    instance: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductInstance', required: true, index: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, default: null },
    customerEmail: { type: String, default: null },
    reservedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reservedAt: { type: Date, default: Date.now },
    holdUntil: { type: Date, default: null },
    advancePaid: { type: Number, default: 0 },
    status: { type: String, enum: RESERVATION_STATUSES, default: 'ACTIVE', index: true },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

reservationSchema.statics.STATUSES = RESERVATION_STATUSES;

module.exports = mongoose.model('Reservation', reservationSchema);
