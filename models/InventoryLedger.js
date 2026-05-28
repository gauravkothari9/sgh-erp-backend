const mongoose = require('mongoose');

const inventoryLedgerSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InventoryProduct',
      required: true,
    },
    productName: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
      enum: ['created', 'sold', 'sample_taken', 'sample_returned', 'transfer_started', 'transfer_received'],
    },
    fromLocation: {
      type: String,
      default: null,
    },
    fromZone: {
      type: String,
      default: null,
    },
    toLocation: {
      type: String,
      default: null,
    },
    toZone: {
      type: String,
      default: null,
    },
    qty: {
      type: Number,
      required: true,
      default: 1,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'V1User',
      required: true,
    },
  },
  { timestamps: true }
);

inventoryLedgerSchema.index({ productId: 1 });
inventoryLedgerSchema.index({ createdAt: -1 });

const InventoryLedger = mongoose.model('InventoryLedger', inventoryLedgerSchema);
module.exports = InventoryLedger;
