// Allocate sequential, year-resetting, zero-padded voucher numbers using an
// atomic findOneAndUpdate on the Counter collection — concurrent writers
// never collide on the same number.

const Counter = require('../models/Counter');

const PREFIX = {
  RECEIPT: 'RCT',
  TRANSFER: 'TRF',
  SALE: 'SAL',
  RESERVATION: 'RSV',
  RETURN: 'RTN',
  ADJUSTMENT: 'ADJ',
  INSTANCE: 'INS',
};

async function nextNumber(prefix, year = new Date().getFullYear()) {
  const _id = `${prefix}:${year}`;
  const doc = await Counter.findOneAndUpdate(
    { _id },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `${prefix}-${year}-${String(doc.seq).padStart(5, '0')}`;
}

module.exports = { PREFIX, nextNumber };
