// SGH-ORD-YYYY-XXXX, allocated atomically via VoucherSequence so two
// concurrent writers never collide.

const prisma = require('../src/lib/prisma');

const generateOrderNumber = async () => {
  const year = new Date().getFullYear();
  const seq = await prisma.voucherSequence.upsert({
    where: { prefix_year: { prefix: 'SGH-ORD', year } },
    update: { last: { increment: 1 } },
    create: { prefix: 'SGH-ORD', year, last: 1 },
  });
  return `SGH-ORD-${year}-${String(seq.last).padStart(4, '0')}`;
};

module.exports = generateOrderNumber;
