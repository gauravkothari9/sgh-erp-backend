const { z } = require('zod');
const QRCode = require('qrcode');
const prisma = require('../../lib/prisma');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const { upload, publicUrl } = require('../../lib/upload');
const { PREFIX, nextNumber } = require('../../lib/voucher');
const { scopedLocationIds } = require('../../middleware/auth');

const daysOnDisplay = (arrivalDate) => {
  if (!arrivalDate) return null;
  return Math.floor((Date.now() - new Date(arrivalDate).getTime()) / 86_400_000);
};

const list = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
  const q = (req.query.q || '').toString().trim();
  const { locationId, stage, productId, material, minPrice, maxPrice, agingMin } = req.query;

  const where = { isActive: true };
  if (locationId) where.currentLocationId = Number(locationId);
  if (stage) where.currentStage = stage;
  if (productId) where.productId = Number(productId);
  if (minPrice || maxPrice) {
    where.listedPrice = {};
    if (minPrice) where.listedPrice.gte = Number(minPrice);
    if (maxPrice) where.listedPrice.lte = Number(maxPrice);
  }
  if (q) {
    where.OR = [
      { instanceCode: { contains: q, mode: 'insensitive' } },
      { product: { name: { contains: q, mode: 'insensitive' } } },
      { product: { code: { contains: q, mode: 'insensitive' } } },
    ];
  }
  if (material) where.product = { ...(where.product || {}), materialType: material };

  // Scope to the user's assigned locations unless admin.
  const allowed = await scopedLocationIds(req.user);
  if (allowed !== null) {
    where.currentLocationId = where.currentLocationId
      ? (allowed.includes(where.currentLocationId) ? where.currentLocationId : -1)
      : { in: allowed };
  }

  const [rows, total] = await prisma.$transaction([
    prisma.productInstance.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { product: true, currentLocation: true },
    }),
    prisma.productInstance.count({ where }),
  ]);

  let items = rows.map((r) => ({ ...r, daysOnDisplay: daysOnDisplay(r.arrivalDate) }));
  if (agingMin) items = items.filter((r) => (r.daysOnDisplay || 0) >= Number(agingMin));

  ok(res, { items, page, limit, total });
};

const getOne = async (req, res) => {
  const id = Number(req.params.id);
  const instance = await prisma.productInstance.findUnique({
    where: { id },
    include: {
      product: true,
      currentLocation: true,
      reservations: { orderBy: { createdAt: 'desc' } },
      sales: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!instance) return fail(res, 404, 'Instance not found');
  ok(res, { instance: { ...instance, daysOnDisplay: daysOnDisplay(instance.arrivalDate) } });
};

const getByCode = async (req, res) => {
  const instance = await prisma.productInstance.findUnique({
    where: { instanceCode: req.params.code },
    include: { product: true, currentLocation: true },
  });
  if (!instance) return fail(res, 404, 'Instance not found');
  ok(res, { instance });
};

const getHistory = async (req, res) => {
  const id = Number(req.params.id);
  const entries = await prisma.stockLedger.findMany({
    where: { instanceId: id },
    orderBy: { postingDate: 'desc' },
    include: { location: true, createdBy: { select: { id: true, fullName: true } } },
  });
  ok(res, { entries });
};

const getQR = async (req, res) => {
  const id = Number(req.params.id);
  const instance = await prisma.productInstance.findUnique({ where: { id } });
  if (!instance) return fail(res, 404, 'Instance not found');
  const png = await QRCode.toBuffer(instance.instanceCode, { width: 512, margin: 1 });
  res.setHeader('Content-Type', 'image/png');
  res.send(png);
};

const createSchema = {
  body: z.object({
    productId: z.coerce.number().int(),
    locationId: z.coerce.number().int(),
    listedPrice: z.coerce.number().nonnegative().optional(),
    arrivalDate: z.coerce.date().optional(),
    actualDimensions: z
      .preprocess(
        (v) => (typeof v === 'string' ? JSON.parse(v) : v),
        z.object({
          length: z.coerce.number().optional(),
          width: z.coerce.number().optional(),
          height: z.coerce.number().optional(),
          weight: z.coerce.number().optional(),
          unit: z.string().optional(),
        })
      )
      .optional(),
    qualityNotes: z.string().optional(),
  }),
};

const createOne = async (req, res) => {
  const photos = (req.files || []).map((f) => publicUrl(f.filename));
  const { productId, locationId, listedPrice, arrivalDate, actualDimensions, qualityNotes } = req.body;

  const result = await prisma.$transaction(async (tx) => {
    const instanceCode = await nextNumber(PREFIX.INSTANCE, undefined, tx);
    const inst = await tx.productInstance.create({
      data: {
        instanceCode,
        productId,
        currentLocationId: locationId,
        currentStage: 'IN_SHOWROOM',
        listedPrice,
        arrivalDate: arrivalDate || new Date(),
        actualDimensions,
        qualityNotes,
        photos,
      },
    });
    const voucherNo = await nextNumber(PREFIX.RECEIPT, undefined, tx);
    await tx.stockLedger.create({
      data: {
        voucherNo,
        voucherType: 'RECEIPT',
        instanceId: inst.id,
        productId,
        locationId,
        quantity: 1,
        remarks: 'Initial receipt into showroom',
        createdById: req.user.id,
      },
    });
    return inst;
  });

  created(res, { instance: result }, 'Piece received');
};

const updateSchema = {
  body: z.object({
    listedPrice: z.coerce.number().nonnegative().optional(),
    actualDimensions: z
      .preprocess((v) => (typeof v === 'string' ? JSON.parse(v) : v), z.any())
      .optional(),
    qualityNotes: z.string().optional(),
    currentStage: z
      .enum(['AVAILABLE', 'IN_SHOWROOM', 'RESERVED', 'SOLD', 'DISPATCHED', 'IN_TRANSIT', 'RETURNED'])
      .optional(),
  }),
};

const updateOne = async (req, res) => {
  const id = Number(req.params.id);
  const data = { ...req.body };
  if (req.files && req.files.length > 0) {
    const existing = await prisma.productInstance.findUnique({ where: { id } });
    data.photos = [...(existing?.photos || []), ...req.files.map((f) => publicUrl(f.filename))];
  }
  const instance = await prisma.productInstance.update({ where: { id }, data });
  ok(res, { instance });
};

module.exports = {
  list,
  getOne,
  getByCode,
  getHistory,
  getQR,
  createOne: [upload.array('photos', 10), validate(createSchema), createOne],
  updateOne: [upload.array('photos', 10), validate(updateSchema), updateOne],
};
