const mongoose = require('mongoose');

const PIECE_STAGES = ['AVAILABLE', 'IN_SHOWROOM', 'RESERVED', 'SOLD', 'DISPATCHED', 'IN_TRANSIT', 'RETURNED'];

const productInstanceSchema = new mongoose.Schema(
  {
    instanceCode: { type: String, required: true, unique: true, index: true }, // INS-YYYY-00001
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    currentLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null, index: true },
    currentStage: { type: String, enum: PIECE_STAGES, default: 'IN_SHOWROOM', index: true },

    arrivalDate: { type: Date, default: null },
    listedPrice: { type: Number, default: null },
    actualDimensions: { type: mongoose.Schema.Types.Mixed, default: null },
    photos: { type: [String], default: [] },
    qualityNotes: { type: String, default: null },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productInstanceSchema.index({ currentLocation: 1, currentStage: 1 });
productInstanceSchema.statics.STAGES = PIECE_STAGES;

module.exports = mongoose.model('ProductInstance', productInstanceSchema);
