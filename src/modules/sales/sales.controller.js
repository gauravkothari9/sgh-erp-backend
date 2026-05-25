const { z } = require('zod');
const prisma = require('../../lib/prisma');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const { PREFIX, nextNumber } = require('../../lib/voucher');

const list = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const where = {};
  if (req.query.showroomId) where.showroomId = Number(req.query.showroomId);
  if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
  if (req.query.from || req.query.to) {
    where.saleDate = {};
    if (req.query.from) where.saleDate.gte = new Date(req.query.from);
    if (req.query.to) where.saleDate.lte = new Date(req.query.to);
  }

  const [items, total] = await prisma.$transaction([
    prisma.showroomSale.findMany({
      where,
      orderBy: { saleDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { instance: { include: { product: true } }, showroom: true },
    }),
    prisma.showroomSale.count({ where }),
  ]);
  ok(res, { items, page, limit, total });
};

const createSchema = {
  body: z.object({
    instanceId: z.coerce.number().int(),
    showroomId: z.coerce.number().int(),
    customerName: z.string().min(1),
    customerPhone: z.string().optional(),
    customerAddress: z.string().optional(),
    salePrice: z.coerce.number().nonnegative(),
    discount: z.coerce.number().nonnegative().optional(),
    paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE']).optional(),
    paymentStatus: z.enum(['PENDING', 'PARTIAL', 'PAID']).optional(),
    notes: z.string().optional(),
  }),
};

const createOne = async (req, res) => {
  const body = req.body;
  const out = await prisma.$transaction(async (tx) => {
    const saleNo = await nextNumber(PREFIX.SALE, undefined, tx);
    const sale = await tx.showroomSale.create({
      data: { ...body, saleNo, soldById: req.user.id },
    });
    // Ledger: -1 from showroom, +1 to DISPATCHED virtual location.
    const dispatched = await tx.location.findUnique({ where: { code: 'DISPATCHED' } });
    if (!dispatched) throw new Error('DISPATCHED virtual location missing — run db:seed');
    await tx.stockLedger.createMany({
      data: [
        {
          voucherNo: saleNo,
          voucherType: 'SALE',
          instanceId: body.instanceId,
          locationId: body.showroomId,
          quantity: -1,
          remarks: `Sold to ${body.customerName}`,
          createdById: req.user.id,
        },
        {
          voucherNo: saleNo,
          voucherType: 'SALE',
          instanceId: body.instanceId,
          locationId: dispatched.id,
          quantity: 1,
          remarks: `Sold to ${body.customerName}`,
          createdById: req.user.id,
        },
      ],
    });
    await tx.productInstance.update({
      where: { id: body.instanceId },
      data: { currentLocationId: dispatched.id, currentStage: 'DISPATCHED' },
    });
    return sale;
  });
  created(res, { sale: out }, 'Sale recorded');
};

const updateSchema = {
  body: z.object({
    paymentStatus: z.enum(['PENDING', 'PARTIAL', 'PAID']).optional(),
    dispatchStatus: z.enum(['PENDING', 'DISPATCHED', 'DELIVERED']).optional(),
    notes: z.string().optional(),
  }),
};

const updateOne = async (req, res) => {
  const id = Number(req.params.id);
  const sale = await prisma.showroomSale.update({ where: { id }, data: req.body });
  ok(res, { sale });
};

const invoice = async (req, res) => {
  // Placeholder invoice — returns a simple JSON for now; real PDF generation
  // is a separate concern (left for a follow-up commit).
  const id = Number(req.params.id);
  const sale = await prisma.showroomSale.findUnique({
    where: { id },
    include: { instance: { include: { product: true } }, showroom: true, soldBy: { select: { id: true, fullName: true } } },
  });
  if (!sale) return fail(res, 404, 'Sale not found');
  ok(res, { invoice: sale });
};

module.exports = {
  list,
  createOne: [validate(createSchema), createOne],
  updateOne: [validate(updateSchema), updateOne],
  invoice,
};
