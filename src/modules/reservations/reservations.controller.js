const mongoose = require('mongoose');
const { z } = require('zod');
const { Reservation, ProductInstance, StockLedger } = require('../../models');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const { PREFIX, nextNumber } = require('../../lib/voucher');

const objectId = z.string().refine((v) => mongoose.isValidObjectId(v), 'Invalid id');

const list = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const where = {};
  if (req.query.status) where.status = req.query.status;
  if (req.query.instanceId && mongoose.isValidObjectId(req.query.instanceId))
    where.instance = req.query.instanceId;

  const [items, total] = await Promise.all([
    Reservation.find(where)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({
        path: 'instance',
        populate: [{ path: 'product' }, { path: 'currentLocation' }],
      }),
    Reservation.countDocuments(where),
  ]);
  ok(res, { items, page, limit, total });
};

const createSchema = {
  body: z.object({
    instanceId: objectId,
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
  const reservationNo = await nextNumber(PREFIX.RESERVATION);

  const reservation = await Reservation.create({
    reservationNo,
    instance: body.instanceId,
    customerName: body.customerName,
    customerPhone: body.customerPhone,
    customerEmail: body.customerEmail,
    holdUntil: body.holdUntil || new Date(Date.now() + 7 * 86_400_000),
    advancePaid: body.advancePaid || 0,
    notes: body.notes,
    reservedBy: req.user._id,
  });
  const inst = await ProductInstance.findByIdAndUpdate(
    body.instanceId,
    { currentStage: 'RESERVED' },
    { new: true }
  );
  if (inst && inst.currentLocation) {
    await StockLedger.create({
      voucherNo: reservationNo,
      voucherType: 'RESERVATION',
      instance: body.instanceId,
      location: inst.currentLocation,
      quantity: 0,
      remarks: `Reserved for ${body.customerName}`,
      createdBy: req.user._id,
    });
  }
  created(res, { reservation }, 'Reservation created');
};

const cancel = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Reservation not found');
  const r = await Reservation.findByIdAndUpdate(req.params.id, { status: 'CANCELLED' }, { new: true });
  if (!r) return fail(res, 404, 'Reservation not found');
  await ProductInstance.findByIdAndUpdate(r.instance, { currentStage: 'IN_SHOWROOM' });
  ok(res, { reservation: r }, 'Reservation cancelled');
};

const convert = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Reservation not found');
  const r = await Reservation.findById(req.params.id).populate('instance');
  if (!r) return fail(res, 404, 'Reservation not found');
  r.status = 'CONVERTED_TO_SALE';
  await r.save();
  ok(res, { reservation: r, instance: r.instance }, 'Marked for sale — call POST /sales to finalise');
};

module.exports = {
  list,
  createOne: [validate(createSchema), createOne],
  cancel,
  convert,
};
