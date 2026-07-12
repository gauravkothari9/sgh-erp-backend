/**
 * A local order — items sold straight off the showroom floor to a walk-in
 * customer. Separate from the export `Order` model: no file number, no
 * production pipeline. Confirming a sale deducts the units from showroom stock.
 */
const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema(
  {
    // Snapshot of the showroom product at the time of sale — the product itself
    // may later be edited or sold out entirely.
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'ShowroomProduct' },
    sku: { type: String, trim: true, uppercase: true, default: '' },
    name: { type: String, required: true, trim: true },
    size: { type: String, trim: true, default: '' }, // formatted "120 × 45 × 90 cm"
    image: { type: String, default: '' },
    comments: { type: String, trim: true, default: '' },

    // Where the units were picked from — informational; stock may be drawn from
    // several zones when one zone can't cover the quantity.
    branch: { type: String, default: '' },
    zone: { type: String, default: '' },

    quantity: { type: Number, required: true, min: 1, default: 1 },
    // Units the customer brought back. Billed quantity is (quantity - returnedQty).
    returnedQty: { type: Number, default: 0, min: 0 },
    unitPrice: { type: Number, required: true, min: 0, default: 0 },
    totalPrice: { type: Number, default: 0 }, // net of returns
  },
  { _id: false }
);

// One return event — what came back, when, and why.
const returnEntrySchema = new mongoose.Schema(
  {
    items: [
      {
        _id: false,
        index: Number,        // position in sale.items
        name: String,
        qty: Number,
        branch: String,       // zone the units went back to
        zone: String,
        refundValue: Number,  // qty × unitPrice
      },
    ],
    refundValue: { type: Number, default: 0 },
    reason: { type: String, trim: true, default: '' },
    at: { type: Date, default: Date.now },
    byName: { type: String, default: '' },
  },
  { _id: false }
);

const localSaleSchema = new mongoose.Schema(
  {
    saleNumber: { type: String, unique: true, index: true },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'LocalCustomer', required: true },
    // Snapshot so an old bill still prints correctly if the customer is edited.
    customerName: { type: String, trim: true, default: '' },
    customerPhone: { type: String, trim: true, default: '' },

    items: { type: [saleItemSchema], default: [] },

    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, default: 0 },

    paymentMode: {
      type: String,
      enum: ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit'],
      default: 'Cash',
    },
    amountPaid: { type: Number, default: 0, min: 0 },
    balanceDue: { type: Number, default: 0 },
    // Owed back to the customer when returns drop the bill below what they paid.
    refundDue: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['Paid', 'Partial', 'Unpaid', 'Refund Due'], default: 'Unpaid', index: true },

    returns: { type: [returnEntrySchema], default: [] },
    returnedValue: { type: Number, default: 0 }, // total value of returned units

    saleDate: { type: Date, default: Date.now, index: true },
    notes: { type: String, trim: true, default: '' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'V1User' },
  },
  { timestamps: true }
);

// Totals and payment status are always derived — never trusted from the client.
// Totals and payment status are always derived — never trusted from the client.
// Returned units drop straight out of the billed amount.
localSaleSchema.pre('save', function computeTotals(next) {
  this.items.forEach((it) => {
    const billed = Math.max((it.quantity || 0) - (it.returnedQty || 0), 0);
    it.totalPrice = billed * (it.unitPrice || 0);
  });
  this.subtotal = this.items.reduce((s, it) => s + (it.totalPrice || 0), 0);
  this.returnedValue = this.items.reduce(
    (s, it) => s + (it.returnedQty || 0) * (it.unitPrice || 0),
    0
  );
  this.totalAmount = Math.max(this.subtotal - (this.discount || 0), 0);

  const paid = this.amountPaid || 0;
  this.balanceDue = Math.max(this.totalAmount - paid, 0);
  this.refundDue = Math.max(paid - this.totalAmount, 0);

  this.paymentStatus =
    this.refundDue > 0 ? 'Refund Due'
    : this.balanceDue <= 0 ? 'Paid'
    : paid > 0 ? 'Partial'
    : 'Unpaid';
  next();
});

module.exports = mongoose.model('LocalSale', localSaleSchema);
