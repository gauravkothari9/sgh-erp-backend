/**
 * A product on display in the showrooms.
 *
 * One document per real item. The same item can sit in several zones at once,
 * so its stock lives in `locations` — e.g. 5 in Jhalamand A, 10 in Jhalamand C,
 * 5 in Kakani A ⇒ totalQty 20. `totalQty` is derived, never set by hand.
 *
 * `branch` / `zone` / `quantity` at the top level are legacy fields from the
 * one-doc-per-zone era; they are kept in sync with the first location so old
 * reads don't break, but `locations` is the source of truth.
 */
const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    branch: { type: String, enum: ['Kakani', 'Jhalamand'], required: true },
    zone: { type: String, required: true, trim: true, uppercase: true },
    qty: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false }
);

const showroomProductSchema = new mongoose.Schema(
  {
    // Company SKU. Optional — older showroom items have none, and the order
    // handoff falls back to a generated code when it's blank.
    sku: { type: String, trim: true, uppercase: true, default: '', index: true },
    name: { type: String, required: [true, 'Product name is required'], trim: true },
    // Product category — Chairs, Almirahs, Consoles, … Free text so the list can
    // grow; backend/config/showroom.js only supplies the suggestions.
    collectionName: { type: String, trim: true, default: "", index: true },
    // Legacy free-text size, kept for products created before dimensions existed.
    size: { type: String, trim: true, default: '' },
    // Same shape as Order.items[].dimensions so a showroom pick maps 1:1 onto
    // an order line item.
    dimensions: {
      length: { type: Number, default: 0, min: 0 },
      width: { type: Number, default: 0, min: 0 },
      height: { type: Number, default: 0, min: 0 },
      unit: { type: String, enum: ['cm', 'inch'], default: 'cm' },
    },
    // Reference cost — never billed directly.
    basePrice: { type: Number, default: 0, min: 0 },
    // Selling price for walk-in (local) customers. Prefills the local order
    // form. Export orders have no stored price — that's quoted on the spot.
    localPrice: { type: Number, default: 0, min: 0 },
    image: { type: String, default: '' }, // public URL

    locations: { type: [locationSchema], default: [] },
    totalQty: { type: Number, default: 0, min: 0 }, // derived from locations

    // ── Legacy mirrors (first location) ──────────────────────────────────
    branch: { type: String, enum: ['Kakani', 'Jhalamand'], index: true },
    zone: { type: String, trim: true, uppercase: true, index: true },
    quantity: { type: Number, default: 0, min: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'V1User' },
  },
  { timestamps: true }
);

// Zone lookups: "which items are on display in Kakani zone A?"
showroomProductSchema.index({ 'locations.branch': 1, 'locations.zone': 1 });

showroomProductSchema.pre('save', function syncStock(next) {
  this.locations = (this.locations || []).filter((l) => l.qty > 0);
  this.totalQty = this.locations.reduce((sum, l) => sum + (l.qty || 0), 0);
  const first = this.locations[0];
  this.branch = first ? first.branch : this.branch;
  this.zone = first ? first.zone : this.zone;
  this.quantity = this.totalQty;
  next();
});

module.exports = mongoose.model('ShowroomProduct', showroomProductSchema);
