const mongoose = require('mongoose');

const MATERIAL_TYPES = ['WOOD', 'IRON', 'WOOD_IRON', 'IRON_MARBLE', 'WOOD_MARBLE', 'OTHER'];

const productSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    category: { type: String, default: null },
    materialType: { type: String, enum: MATERIAL_TYPES, required: true },
    defaultUnit: { type: String, default: 'piece' },
    description: { type: String, default: null },
    basePrice: { type: Number, default: null },
    baseImages: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.statics.MATERIAL_TYPES = MATERIAL_TYPES;

module.exports = mongoose.model('Product', productSchema);
