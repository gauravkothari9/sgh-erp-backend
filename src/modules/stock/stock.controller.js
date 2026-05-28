const mongoose = require('mongoose');
const { z } = require('zod');
const { StockLedger, ProductInstance } = require('../../models');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const { PREFIX, nextNumber } = require('../../lib/voucher');

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

const receiveSchema = {
  body: z.object({
    instanceId: objectId,
    locationId: objectId,
    remarks: z.string().optional(),
    postingDate: z.coerce.date().optional(),
  }),
};

const receive = async (req, res) => {
  const { instanceId, locationId, remarks, postingDate } = req.body;
  const voucherNo = await nextNumber(PREFIX.RECEIPT);
  const entry = await StockLedger.create({
    voucherNo,
    voucherType: 'RECEIPT',
    instance: instanceId,
    location: locationId,
    quantity: 1,
    postingDate: postingDate || new Date(),
    remarks,
    createdBy: req.user._id,
  });
  await ProductInstance.findByIdAndUpdate(instanceId, {
    currentLocation: locationId,
    currentStage: 'IN_SHOWROOM',
  });
  created(res, { entry }, 'Receipt posted');
};

const transferSchema = {
  body: z.object({
    instanceId: objectId,
    fromLocationId: objectId,
    toLocationId: objectId,
    remarks: z.string().optional(),
  }),
};

// Move a piece between locations. Posts TWO ledger lines (out/in) and flips
// the instance's currentLocation. Source of truth = ledger.
const transfer = async (req, res) => {
  const { instanceId, fromLocationId, toLocationId, remarks } = req.body;
  if (fromLocationId === toLocationId) return fail(res, 400, 'Source and destination cannot match');

  const voucherNo = await nextNumber(PREFIX.TRANSFER);
  const entries = await StockLedger.insertMany([
    {
      voucherNo,
      voucherType: 'TRANSFER',
      instance: instanceId,
      location: fromLocationId,
      quantity: -1,
      remarks,
      createdBy: req.user._id,
    },
    {
      voucherNo,
      voucherType: 'TRANSFER',
      instance: instanceId,
      location: toLocationId,
      quantity: 1,
      remarks,
      createdBy: req.user._id,
    },
  ]);
  await ProductInstance.findByIdAndUpdate(instanceId, {
    currentLocation: toLocationId,
    currentStage: 'IN_SHOWROOM',
  });
  created(res, { voucherNo, count: entries.length }, 'Transfer posted');
};

const balance = async (req, res) => {
  const match = {};
  if (req.query.locationId && mongoose.isValidObjectId(req.query.locationId))
    match.location = new mongoose.Types.ObjectId(req.query.locationId);
  if (req.query.productId && mongoose.isValidObjectId(req.query.productId))
    match.product = new mongoose.Types.ObjectId(req.query.productId);

  const rows = await StockLedger.aggregate([
    { $match: match },
    {
      $group: {
        _id: { location: '$location', product: '$product' },
        quantity: { $sum: '$quantity' },
      },
    },
    {
      $project: {
        _id: 0,
        locationId: { $toString: '$_id.location' },
        productId: { $toString: '$_id.product' },
        _sum: { quantity: '$quantity' },
      },
    },
  ]);
  ok(res, { rows });
};

const ledger = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const where = {};
  if (req.query.locationId && mongoose.isValidObjectId(req.query.locationId))
    where.location = req.query.locationId;
  if (req.query.instanceId && mongoose.isValidObjectId(req.query.instanceId))
    where.instance = req.query.instanceId;
  if (req.query.voucherType) where.voucherType = req.query.voucherType;
  if (req.query.from || req.query.to) {
    where.postingDate = {};
    if (req.query.from) where.postingDate.$gte = new Date(req.query.from);
    if (req.query.to) where.postingDate.$lte = new Date(req.query.to);
  }

  const [items, total] = await Promise.all([
    StockLedger.find(where)
      .sort({ postingDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('location')
      .populate({ path: 'instance', populate: { path: 'product' } }),
    StockLedger.countDocuments(where),
  ]);

  const safe = items.map((i) => {
    const o = i.toObject();
    return { ...o, id: o._id.toString() };
  });
  ok(res, { items: safe, page, limit, total });
};

module.exports = {
  receive: [validate(receiveSchema), receive],
  transfer: [validate(transferSchema), transfer],
  balance,
  ledger,
};
