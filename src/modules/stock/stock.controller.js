const { z } = require('zod');
const prisma = require('../../lib/prisma');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const { PREFIX, nextNumber } = require('../../lib/voucher');

const receiveSchema = {
  body: z.object({
    instanceId: z.coerce.number().int(),
    locationId: z.coerce.number().int(),
    remarks: z.string().optional(),
    postingDate: z.coerce.date().optional(),
  }),
};

const receive = async (req, res) => {
  const { instanceId, locationId, remarks, postingDate } = req.body;
  const out = await prisma.$transaction(async (tx) => {
    const voucherNo = await nextNumber(PREFIX.RECEIPT, undefined, tx);
    const entry = await tx.stockLedger.create({
      data: {
        voucherNo,
        voucherType: 'RECEIPT',
        instanceId,
        locationId,
        quantity: 1,
        postingDate: postingDate || new Date(),
        remarks,
        createdById: req.user.id,
      },
    });
    await tx.productInstance.update({
      where: { id: instanceId },
      data: { currentLocationId: locationId, currentStage: 'IN_SHOWROOM' },
    });
    return entry;
  });
  created(res, { entry: out }, 'Receipt posted');
};

const transferSchema = {
  body: z.object({
    instanceId: z.coerce.number().int(),
    fromLocationId: z.coerce.number().int(),
    toLocationId: z.coerce.number().int(),
    remarks: z.string().optional(),
  }),
};

// Move a piece between locations. Posts TWO ledger lines (out/in) atomically
// and flips the instance's currentLocationId. Source of truth = ledger.
const transfer = async (req, res) => {
  const { instanceId, fromLocationId, toLocationId, remarks } = req.body;
  if (fromLocationId === toLocationId) return fail(res, 400, 'Source and destination cannot match');

  const out = await prisma.$transaction(async (tx) => {
    const voucherNo = await nextNumber(PREFIX.TRANSFER, undefined, tx);
    const entries = await tx.stockLedger.createMany({
      data: [
        {
          voucherNo,
          voucherType: 'TRANSFER',
          instanceId,
          locationId: fromLocationId,
          quantity: -1,
          remarks,
          createdById: req.user.id,
        },
        {
          voucherNo,
          voucherType: 'TRANSFER',
          instanceId,
          locationId: toLocationId,
          quantity: 1,
          remarks,
          createdById: req.user.id,
        },
      ],
    });
    await tx.productInstance.update({
      where: { id: instanceId },
      data: { currentLocationId: toLocationId, currentStage: 'IN_SHOWROOM' },
    });
    return { voucherNo, count: entries.count };
  });
  created(res, out, 'Transfer posted');
};

const balance = async (req, res) => {
  const { locationId, productId } = req.query;
  const where = {};
  if (locationId) where.locationId = Number(locationId);
  if (productId) where.productId = Number(productId);

  const sums = await prisma.stockLedger.groupBy({
    by: ['locationId', 'productId'],
    where,
    _sum: { quantity: true },
  });
  ok(res, { rows: sums });
};

const ledger = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const where = {};
  if (req.query.locationId) where.locationId = Number(req.query.locationId);
  if (req.query.instanceId) where.instanceId = Number(req.query.instanceId);
  if (req.query.voucherType) where.voucherType = req.query.voucherType;
  if (req.query.from || req.query.to) {
    where.postingDate = {};
    if (req.query.from) where.postingDate.gte = new Date(req.query.from);
    if (req.query.to) where.postingDate.lte = new Date(req.query.to);
  }

  const [items, total] = await prisma.$transaction([
    prisma.stockLedger.findMany({
      where,
      orderBy: { postingDate: 'desc' },
      include: { location: true, instance: { include: { product: true } } },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.stockLedger.count({ where }),
  ]);
  // BigInt ids → string so JSON.stringify doesn't blow up.
  const safe = items.map((i) => ({ ...i, id: i.id.toString() }));
  ok(res, { items: safe, page, limit, total });
};

module.exports = {
  receive: [validate(receiveSchema), receive],
  transfer: [validate(transferSchema), transfer],
  balance,
  ledger,
};
