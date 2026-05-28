const mongoose = require('mongoose');

const inventoryProductSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    companySKU: {
      type: String,
      required: [true, 'Company SKU is required'],
      trim: true,
      uppercase: true,
    },
    size: {
      type: String,
      trim: true,
      default: null,
    },
    price: {
      type: Number,
      default: 0,
    },
    currency: {
      type: String,
      default: 'INR',
      trim: true,
    },
    qty: {
      type: Number,
      required: [true, 'Quantity is required'],
      default: 1,
      min: [0, 'Quantity cannot be negative'],
    },
    location: {
      type: String,
      required: [true, 'Location is required'],
      enum: ['jhalamand', 'kakani'],
      trim: true,
    },
    zone: {
      type: String,
      required: [true, 'Zone is required'],
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      required: [true, 'Status is required'],
      enum: ['on_floor', 'sold', 'sample', 'transferring'],
      default: 'on_floor',
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    photos: [{ type: String }],
    primaryImage: {
      type: String,
      default: null,
    },
    saleDetails: {
      customerName: { type: String, default: null },
      customerEmail: { type: String, default: null },
      customerPhone: { type: String, default: null },
      customerAddress: { type: String, default: null },
      soldAt: { type: Date, default: null },
    },
    sampleDetails: {
      personName: { type: String, default: null },
      personMobile: { type: String, default: null },
      sampleQty: { type: Number, default: null },
      takenAt: { type: Date, default: null },
    },
    transferDetails: {
      targetLocation: { type: String, default: null },
      targetZone: { type: String, default: null },
      customerFile: { type: String, default: null },
      purpose: { type: String, default: null },
      incharge: { type: String, default: null },
      employee: { type: String, default: null },
      driver: { type: String, default: null },
      transferTime: { type: Date, default: null },
      receivedTime: { type: Date, default: null },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'V1User',
    },
    modifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'V1User',
    },
  },
  { timestamps: true }
);

inventoryProductSchema.index({ name: 'text', companySKU: 'text', description: 'text' });
inventoryProductSchema.index({ location: 1, zone: 1 });
inventoryProductSchema.index({ status: 1 });

const InventoryProduct = mongoose.model('InventoryProduct', inventoryProductSchema);
module.exports = InventoryProduct;
