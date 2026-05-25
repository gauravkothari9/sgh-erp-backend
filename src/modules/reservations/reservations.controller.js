const { z } = require('zod');
const prisma = require('../../lib/prisma');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const { PREFIX, nextNumber } = require('../../lib/voucher');

const list = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.instanceId) where.instanceId = Number(req.query.instanceId);

  const [items, total] = await prisma.$transaction([
    prisma.reservation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { instance: { include: { product: true, currentLocation: true } } },
    }),
    prisma.reservation.count({ where }),
  ]);
  ok(res, { items, page, limit, total });
};

const createSchema = {
  body: z.object({
    instanceId: z.coerce.number().int(),
    customerName: z.string().min(1),
    customerPhone: z.string().optional(),
    customerEmail: z.string().email().optional(),
    holdUntil: z.coerce.date().optional(),
    advancePaid: z.coerce.number().nonnegative().optional(),
    notes: z.string().optional(),
  }),
};

const createOne = async (req, res) => {
  const body = req.body;
  const out = await prisma.$transaction(async (tx) => {
    const reservationNo = await nextNumber(PREFIX.RESERVATION, undefined, tx);
    const reservation = await tx.reservation.create({
      data: {
        ...body,
        reservationNo,
        reservedById: req.user.id,
        holdUntil: body.holdUntil || new Date(Date.now() + 7 * 86_400_000),
      },
    });
    await tx.productInstance.update({
      where: { id: body.instanceId },
      data: { currentStage: 'RESERVED' },
    });
    const inst = await tx.productInstance.findUnique({ where: { id: body.instanceId } });
    await tx.stockLedger.create({
      data: {
        voucherNo: reservationNo,
        voucherType: 'RESERVATION',
        instanceId: body.instanceId,
        locationId: inst.currentLocationId,
        quantity: 0,
        remarks: `Reserved for ${body.customerName}`,
        createdById: req.user.id,
      },
    });
    return reservation;
  });
  created(res, { reservation: out }, 'Reservation created');
};

const cancel = async (req, res) => {
  const id = Number(req.params.id);
  const out = await prisma.$transaction(async (tx) => {
    const r = await tx.reservation.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    await tx.productInstance.update({
      where: { id: r.instanceId },
      data: { currentStage: 'IN_SHOWROOM' },
    });
    return r;
  });
  ok(res, { reservation: out }, 'Reservation cancelled');
};

const convert = async (req, res) => {
  const id = Number(req.params.id);
  const r = await prisma.reservation.findUnique({ where: { id }, include: { instance: true } });
  if (!r) return fail(res, 404, 'Reservation not found');
  await prisma.reservation.update({ where: { id }, data: { status: 'CONVERTED_TO_SALE' } });
  ok(res, { reservation: r, instance: r.instance }, 'Marked for sale — call POST /sales to finalise');
};

module.exports = {
  list,
  createOne: [validate(createSchema), createOne],
  cancel,
  convert,
};
