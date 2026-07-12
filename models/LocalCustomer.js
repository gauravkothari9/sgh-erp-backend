/**
 * A walk-in / local customer — someone who buys straight off the showroom
 * floor. Deliberately lighter than the export `Customer` model: no file number,
 * no currency, no buyer catalogue.
 */
const mongoose = require('mongoose');

const localCustomerSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Customer name is required'], trim: true, index: true },
    phone: { type: String, required: [true, 'Phone is required'], trim: true, index: true },
    altPhone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, lowercase: true, default: '' },

    address: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },

    // Only for customers who need a GST bill.
    companyName: { type: String, trim: true, default: '' },
    gstin: { type: String, trim: true, uppercase: true, default: '' },

    notes: { type: String, trim: true, default: '' },
    tags: { type: [String], default: [] }, // e.g. VIP, Dealer, Architect

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'V1User' },
  },
  { timestamps: true }
);

// Search by name / phone / company from the customer list and the sale form.
localCustomerSchema.index({ name: 'text', phone: 'text', companyName: 'text' });

module.exports = mongoose.model('LocalCustomer', localCustomerSchema);
