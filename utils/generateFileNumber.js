// Generate a unique SGH File Number in format: SGH-YYYY-XXXX.
// Backed by the shared VoucherSequence counter so two concurrent writers
// never collide on the same number.

const prisma = require('../src/lib/prisma');

const generateFileNumber = async () => {
  const year = new Date().getFullYear();
  const seq = await prisma.voucherSequence.upsert({
    where: { prefix_year: { prefix: 'SGH-FILE', year } },
    update: { last: { increment: 1 } },
    create: { prefix: 'SGH-FILE', year, last: 1 },
  });
  return `SGH-${year}-${String(seq.last).padStart(4, '0')}`;
};

module.exports = generateFileNumber;
