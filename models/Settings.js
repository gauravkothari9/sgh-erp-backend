/**
 * Platform settings — a singleton. One document, fetched by anyone signed in
 * (the company block prints on bills) and edited only by holders of the
 * `settings` module.
 */
const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema(
  {
    // Prints on local bills / invoices.
    company: {
      name: { type: String, trim: true, default: 'SGH Crafts' },
      legalName: { type: String, trim: true, default: '' },
      address: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      phone: { type: String, trim: true, default: '' },
      email: { type: String, trim: true, default: '' },
      gstin: { type: String, trim: true, uppercase: true, default: '' },
    },

    // Local (walk-in) sales.
    local: {
      defaultPaymentMode: {
        type: String,
        enum: ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Credit'],
        default: 'Cash',
      },
      billFooter: { type: String, trim: true, default: 'Thank you for your purchase.' },
      billTerms: { type: String, trim: true, default: '' },
    },

    // Which server-side events actually dispatch notifications. Off = the hook
    // still runs, it just doesn't create anything.
    notifications: {
      orders: { type: Boolean, default: true },
      production: { type: Boolean, default: true },
      showroom: { type: Boolean, default: true },
      local: { type: Boolean, default: true },
      admin: { type: Boolean, default: true },
    },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'V1User' },
  },
  { timestamps: true }
);

// Always work with the same document.
settingsSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({});
  return doc;
};

module.exports = mongoose.model('Settings', settingsSchema);
