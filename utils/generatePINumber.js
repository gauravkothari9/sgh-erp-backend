// PI-YYYY-XXXX, allocated atomically via VoucherSequence.

const prisma = require('../src/lib/prisma');

const generatePINumber = async () => {
  const year = new Date().getFullYear();
  const seq = await prisma.voucherSequence.upsert({
    where: { prefix_year: { prefix: 'PI', year } },
    update: { last: { increment: 1 } },
    create: { prefix: 'PI', year, last: 1 },
  });
  return `PI-${year}-${String(seq.last).padStart(4, '0')}`;
};

module.exports = generatePINumber;
