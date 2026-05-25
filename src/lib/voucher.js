// Allocate sequential, year-resetting, zero-padded voucher numbers
// transactionally so two concurrent writers never collide on the same number.

const prisma = require('./prisma');

const PREFIX = {
  RECEIPT: 'RCT',
  TRANSFER: 'TRF',
  SALE: 'SAL',
  RESERVATION: 'RSV',
  RETURN: 'RTN',
  ADJUSTMENT: 'ADJ',
  INSTANCE: 'INS',
};

async function nextNumber(prefix, year = new Date().getFullYear(), tx = prisma) {
  const seq = await tx.voucherSequence.upsert({
    where: { prefix_year: { prefix, year } },
    update: { last: { increment: 1 } },
    create: { prefix, year, last: 1 },
  });
  return `${prefix}-${year}-${String(seq.last).padStart(5, '0')}`;
}

module.exports = { PREFIX, nextNumber };
