// Sequential SGH-U-XXXX user IDs allocated via the shared VoucherSequence
// table. One row per year — but for user IDs we use a constant "ALL" year so
// the sequence never resets.

const prisma = require('../src/lib/prisma');

const generateUserId = async () => {
  const seq = await prisma.voucherSequence.upsert({
    where: { prefix_year: { prefix: 'SGH-U', year: 0 } },
    update: { last: { increment: 1 } },
    create: { prefix: 'SGH-U', year: 0, last: 1 },
  });
  return `SGH-U-${String(seq.last).padStart(4, '0')}`;
};

module.exports = generateUserId;
