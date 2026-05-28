const mongoose = require('mongoose');

const LOCATION_TYPES = ['LOCATION', 'SHOWROOM', 'VIRTUAL'];

const locationSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: LOCATION_TYPES, required: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null, index: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

locationSchema.statics.TYPES = LOCATION_TYPES;

module.exports = mongoose.model('Location', locationSchema);
