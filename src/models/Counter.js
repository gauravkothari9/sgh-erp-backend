// Atomic counter for voucher numbers (RCT-YYYY-00001, etc.) and any other
// sequential id we need to hand out without race conditions.

const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g. "RCT:2026" or "user:ALL"
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('Counter', counterSchema);
