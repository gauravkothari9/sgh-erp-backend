const mongoose = require('mongoose');
const { z } = require('zod');
const QRCode = require('qrcode');
const { ProductInstance, StockLedger } = require('../../models');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const { upload, publicUrl } = require('../../lib/upload');
const { PREFIX, nextNumber } = require('../../lib/voucher');
const { scopedLocationIds } = require('../../middleware/auth');

const daysOnDisplay = (arrivalDate) => {
  if (!arrivalDate) return null;
  return Math.floor((Date.now() - new Date(arrivalDate).getTime()) / 86_400_000);
};

const hydrate = (inst) => {
  const o = inst.toObject ? inst.toObject() : inst;
  return {
    ...o,
    id: o._id.toString(),
    productId: o.product?._id ? o.product._id.toString() : (o.product ? o.product.toString() : null),
    currentLocationId: o.currentLocation?._id
      ? o.currentLocation._id.toString()
      : (o.currentLocation ? o.currentLocation.toString() : null),
    product: o.product && o.product._id
      ? { ...o.product, id: o.product._id.toString() }
      : o.product,
    currentLocation: o.currentLocation && o.currentLocation._id
      ? { ...o.currentLocation, id: o.currentLocation._id.toString() }
      : o.currentLocation,
    daysOnDisplay: daysOnDisplay(o.arrivalDate),
  };
};

const list = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 24));
  const q = (req.query.q || '').toString().trim();
  const { locationId, stage, productId, material, minPrice, maxPrice, agingMin } = req.query;

  const where = { isActive: true };
  if (locationId && mongoose.isValidObjectId(locationId)) where.currentLocation = locationId;
  if (stage) where.currentStage = stage;
  if (productId && mongoose.isValidObjectId(productId)) where.product = productId;
  if (minPrice || maxPrice) {
    where.listedPrice = {};
    if (minPrice) where.listedPrice.$gte = Number(minPrice);
    if (maxPrice) where.listedPrice.$lte = Number(maxPrice);
  }
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    where.instanceCode = re;
  }

  // Scope to user's locations unless admin.
  const allowed = await scopedLocationIds(req.user);
  if (allowed !== null) {
    const ids = allowed.map((x) => x.toString());
    if (where.currentLocation) {
      if (!ids.includes(where.currentLocation.toString())) where.currentLocation = null;
    } else {
      where.currentLocation = { $in: ids };
    }
  }

  let query = ProductInstance.find(where)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('product')
    .populate('currentLocation');

  let [rows, total] = await Promise.all([query, ProductInstance.countDocuments(where)]);

  if (material) {
    rows = rows.filter((r) => r.product?.materialType === material);
  }
  let items = rows.map(hydrate);
  if (agingMin) items = items.filter((r) => (r.daysOnDisplay || 0) >= Number(agingMin));

  ok(res, { items, page, limit, total });
};

const getOne = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Instance not found');
  const instance = await ProductInstance.findById(req.params.id)
    .populate('product')
    .populate('currentLocation');
  if (!instance) return fail(res, 404, 'Instance not found');
  ok(res, { instance: hydrate(instance) });
};

const getByCode = async (req, res) => {
  const instance = await ProductInstance.findOne({ instanceCode: req.params.code })
    .populate('product')
    .populate('currentLocation');
  if (!instance) return fail(res, 404, 'Instance not found');
  ok(res, { instance: hydrate(instance) });
};

const getHistory = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Instance not found');
  const entries = await StockLedger.find({ instance: req.params.id })
    .sort({ postingDate: -1 })
    .populate('location')
    .populate('createdBy', 'fullName');
  const hydrated = entries.map((e) => {
    const o = e.toObject();
    return {
      ...o,
      id: o._id.toString(),
      locationId: o.location?._id ? o.location._id.toString() : null,
      location: o.location && o.location._id ? { ...o.location, id: o.location._id.toString() } : null,
      createdBy: o.createdBy
        ? { id: o.createdBy._id.toString(), fullName: o.createdBy.fullName }
        : null,
    };
  });
  ok(res, { entries: hydrated });
};

const getQR = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Instance not found');
  const instance = await ProductInstance.findById(req.params.id);
  if (!instance) return fail(res, 404, 'Instance not found');
  const png = await QRCode.toBuffer(instance.instanceCode, { width: 512, margin: 1 });
  res.setHeader('Content-Type', 'image/png');
  res.send(png);
};

const createSchema = {
  body: z.object({
    productId: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid productId'),
    locationId: z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid locationId'),
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

  const instanceCode = await nextNumber(PREFIX.INSTANCE);
  const inst = await ProductInstance.create({
    instanceCode,
    product: productId,
    currentLocation: locationId,
    currentStage: 'IN_SHOWROOM',
    listedPrice,
    arrivalDate: arrivalDate || new Date(),
    actualDimensions,
    qualityNotes,
    photos,
  });
  const voucherNo = await nextNumber(PREFIX.RECEIPT);
  await StockLedger.create({
    voucherNo,
    voucherType: 'RECEIPT',
    instance: inst._id,
    product: productId,
    location: locationId,
    quantity: 1,
    remarks: 'Initial receipt into showroom',
    createdBy: req.user._id,
  });

  created(res, { instance: hydrate(inst) }, 'Piece received');
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
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Instance not found');
  const data = { ...req.body };
  if (req.files && req.files.length > 0) {
    const existing = await ProductInstance.findById(req.params.id);
    data.photos = [...(existing?.photos || []), ...req.files.map((f) => publicUrl(f.filename))];
  }
  const instance = await ProductInstance.findByIdAndUpdate(req.params.id, data, { new: true })
    .populate('product')
    .populate('currentLocation');
  if (!instance) return fail(res, 404, 'Instance not found');
  ok(res, { instance: hydrate(instance) });
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
