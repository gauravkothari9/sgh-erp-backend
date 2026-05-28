const mongoose = require('mongoose');
const { z } = require('zod');
const { ShowroomSale, ProductInstance, StockLedger, Location } = require('../../models');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const { PREFIX, nextNumber } = require('../../lib/voucher');

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

const list = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const where = {};
  if (req.query.showroomId && mongoose.isValidObjectId(req.query.showroomId))
    where.showroom = req.query.showroomId;
  if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus;
  if (req.query.from || req.query.to) {
    where.saleDate = {};
    if (req.query.from) where.saleDate.$gte = new Date(req.query.from);
    if (req.query.to) where.saleDate.$lte = new Date(req.query.to);
  }

  const [items, total] = await Promise.all([
    ShowroomSale.find(where)
      .sort({ saleDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'instance', populate: { path: 'product' } })
      .populate('showroom'),
    ShowroomSale.countDocuments(where),
  ]);
  ok(res, { items, page, limit, total });
};

const createSchema = {
  body: z.object({
    instanceId: objectId,
    showroomId: objectId,
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
  const dispatched = await Location.findOne({ code: 'DISPATCHED' });
  if (!dispatched) return fail(res, 500, 'DISPATCHED virtual location missing — run db:seed');

  const saleNo = await nextNumber(PREFIX.SALE);
  const sale = await ShowroomSale.create({
    saleNo,
    instance: body.instanceId,
    showroom: body.showroomId,
    customerName: body.customerName,
    customerPhone: body.customerPhone,
    customerAddress: body.customerAddress,
    salePrice: body.salePrice,
    discount: body.discount || 0,
    paymentMode: body.paymentMode,
    paymentStatus: body.paymentStatus || 'PENDING',
    notes: body.notes,
    soldBy: req.user._id,
  });
  await StockLedger.insertMany([
    {
      voucherNo: saleNo,
      voucherType: 'SALE',
      instance: body.instanceId,
      location: body.showroomId,
      quantity: -1,
      remarks: `Sold to ${body.customerName}`,
      createdBy: req.user._id,
    },
    {
      voucherNo: saleNo,
      voucherType: 'SALE',
      instance: body.instanceId,
      location: dispatched._id,
      quantity: 1,
      remarks: `Sold to ${body.customerName}`,
      createdBy: req.user._id,
    },
  ]);
  await ProductInstance.findByIdAndUpdate(body.instanceId, {
    currentLocation: dispatched._id,
    currentStage: 'DISPATCHED',
  });
  created(res, { sale }, 'Sale recorded');
};

const updateSchema = {
  body: z.object({
    paymentStatus: z.enum(['PENDING', 'PARTIAL', 'PAID']).optional(),
    dispatchStatus: z.enum(['PENDING', 'DISPATCHED', 'DELIVERED']).optional(),
    notes: z.string().optional(),
  }),
};

const updateOne = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Sale not found');
  const sale = await ShowroomSale.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!sale) return fail(res, 404, 'Sale not found');
  ok(res, { sale });
};

const invoice = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Sale not found');
  const sale = await ShowroomSale.findById(req.params.id)
    .populate({ path: 'instance', populate: { path: 'product' } })
    .populate('showroom')
    .populate('soldBy', 'fullName');
  if (!sale) return fail(res, 404, 'Sale not found');
  ok(res, { invoice: sale });
};

module.exports = {
  list,
  createOne: [validate(createSchema), createOne],
  updateOne: [validate(updateSchema), updateOne],
  invoice,
};
