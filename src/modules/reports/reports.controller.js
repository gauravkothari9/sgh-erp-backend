const mongoose = require('mongoose');
const { Location, ProductInstance, ShowroomSale } = require('../../models');
const { ok } = require('../../lib/response');

const showroomSummary = async (_req, res) => {
  // One row per showroom: count + total listed value + active reservations.
  const showrooms = await Location.find({ type: 'SHOWROOM', isActive: true }).sort({ code: 1 });
  const rows = await Promise.all(
    showrooms.map(async (s) => {
      const [pieces, sumAgg, reserved, sold30] = await Promise.all([
        ProductInstance.countDocuments({
          currentLocation: s._id,
          isActive: true,
          currentStage: { $in: ['IN_SHOWROOM', 'AVAILABLE'] },
        }),
        ProductInstance.aggregate([
          {
            $match: {
              currentLocation: s._id,
              isActive: true,
              currentStage: { $in: ['IN_SHOWROOM', 'AVAILABLE'] },
            },
          },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$listedPrice', 0] } } } },
        ]),
        ProductInstance.countDocuments({
          currentLocation: s._id,
          isActive: true,
          currentStage: 'RESERVED',
        }),
        ShowroomSale.countDocuments({
          showroom: s._id,
          saleDate: { $gte: new Date(Date.now() - 30 * 86_400_000) },
        }),
      ]);
      return {
        showroom: { id: s._id.toString(), code: s.code, name: s.name, type: s.type },
        pieces,
        totalValue: sumAgg[0]?.total || 0,
        reserved,
        soldLast30Days: sold30,
      };
    })
  );
  ok(res, { rows });
};

const aging = async (_req, res) => {
  const items = await ProductInstance.find({
    isActive: true,
    currentStage: { $in: ['IN_SHOWROOM', 'AVAILABLE'] },
    arrivalDate: { $ne: null },
  })
    .sort({ arrivalDate: 1 })
    .populate('product')
    .populate('currentLocation');
  const now = Date.now();
  const rows = items.map((i) => ({
    id: i._id.toString(),
    instanceCode: i.instanceCode,
    productName: i.product?.name,
    showroom: i.currentLocation?.code,
    listedPrice: i.listedPrice,
    daysOnDisplay: Math.floor((now - new Date(i.arrivalDate).getTime()) / 86_400_000),
  }));
  ok(res, { rows });
};

const salesSummary = async (req, res) => {
  const where = {};
  if (req.query.from || req.query.to) {
    where.saleDate = {};
    if (req.query.from) where.saleDate.$gte = new Date(req.query.from);
    if (req.query.to) where.saleDate.$lte = new Date(req.query.to);
  }
  if (req.query.showroomId && mongoose.isValidObjectId(req.query.showroomId))
    where.showroom = req.query.showroomId;

  const [items, agg] = await Promise.all([
    ShowroomSale.find(where)
      .sort({ saleDate: -1 })
      .populate({ path: 'instance', populate: { path: 'product' } })
      .populate('showroom'),
    ShowroomSale.aggregate([
      { $match: where },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          revenue: { $sum: '$salePrice' },
          discount: { $sum: '$discount' },
        },
      },
    ]),
  ]);
  const totals = agg[0] || { count: 0, revenue: 0, discount: 0 };
  ok(res, {
    items,
    totals: {
      count: totals.count,
      revenue: totals.revenue || 0,
      discount: totals.discount || 0,
      avgSalePrice: totals.count ? Number(totals.revenue || 0) / totals.count : 0,
    },
  });
};

const crossShowroomSearch = async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const where = { isActive: true };
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    where.instanceCode = re;
  }
  if (req.query.stage) where.currentStage = req.query.stage;

  let items = await ProductInstance.find(where)
    .populate('product')
    .populate('currentLocation')
    .sort({ createdAt: -1 })
    .limit(200);
  if (req.query.material) items = items.filter((i) => i.product?.materialType === req.query.material);

  const groups = {};
  for (const i of items) {
    const key = i.currentLocation?.code || 'UNKNOWN';
    (groups[key] ||= { showroom: i.currentLocation, items: [] }).items.push(i);
  }
  ok(res, { groups });
};

module.exports = { showroomSummary, aging, salesSummary, crossShowroomSearch };
