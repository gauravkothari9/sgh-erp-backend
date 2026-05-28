const mongoose = require('mongoose');

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE'];
const PAYMENT_STATUSES = ['PENDING', 'PARTIAL', 'PAID'];
const DISPATCH_STATUSES = ['PENDING', 'DISPATCHED', 'DELIVERED'];

const showroomSaleSchema = new mongoose.Schema(
  {
    saleNo: { type: String, required: true, unique: true, index: true }, // SAL-YYYY-00001
    instance: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductInstance', required: true, index: true },
    showroom: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, default: null },
    customerAddress: { type: String, default: null },
    salePrice: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    paymentMode: { type: String, enum: PAYMENT_MODES, default: null },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: 'PENDING' },
    saleDate: { type: Date, default: Date.now, index: true },
    dispatchStatus: { type: String, enum: DISPATCH_STATUSES, default: 'PENDING' },
    soldBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

showroomSaleSchema.index({ showroom: 1, saleDate: -1 });
showroomSaleSchema.statics.PAYMENT_MODES = PAYMENT_MODES;
showroomSaleSchema.statics.PAYMENT_STATUSES = PAYMENT_STATUSES;
showroomSaleSchema.statics.DISPATCH_STATUSES = DISPATCH_STATUSES;

module.exports = mongoose.model('ShowroomSale', showroomSaleSchema);
