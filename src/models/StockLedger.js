const mongoose = require('mongoose');

const VOUCHER_TYPES = ['RECEIPT', 'TRANSFER', 'SALE', 'RESERVATION', 'RETURN', 'ADJUSTMENT'];

const stockLedgerSchema = new mongoose.Schema(
  {
    voucherNo: { type: String, required: true, index: true },
    voucherType: { type: String, enum: VOUCHER_TYPES, required: true },
    instance: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductInstance', default: null, index: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
    location: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    quantity: { type: Number, required: true },
    postingDate: { type: Date, default: Date.now, index: true },
    remarks: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

stockLedgerSchema.statics.VOUCHER_TYPES = VOUCHER_TYPES;

module.exports = mongoose.model('StockLedger', stockLedgerSchema);
