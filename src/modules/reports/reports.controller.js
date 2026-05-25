const prisma = require('../../lib/prisma');
const { ok } = require('../../lib/response');

const showroomSummary = async (req, res) => {
  // One row per showroom: count + total listed value + active reservations.
  const showrooms = await prisma.location.findMany({
    where: { type: 'SHOWROOM', isActive: true },
    orderBy: { code: 'asc' },
  });
  const rows = await Promise.all(
    showrooms.map(async (s) => {
      const [pieces, agg, reserved, sold30] = await Promise.all([
        prisma.productInstance.count({
          where: { currentLocationId: s.id, isActive: true, currentStage: { in: ['IN_SHOWROOM', 'AVAILABLE'] } },
        }),
        prisma.productInstance.aggregate({
          where: { currentLocationId: s.id, isActive: true, currentStage: { in: ['IN_SHOWROOM', 'AVAILABLE'] } },
          _sum: { listedPrice: true },
        }),
        prisma.productInstance.count({
          where: { currentLocationId: s.id, isActive: true, currentStage: 'RESERVED' },
        }),
        prisma.showroomSale.count({
          where: { showroomId: s.id, saleDate: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        }),
      ]);
      return {
        showroom: s,
        pieces,
        totalValue: agg._sum.listedPrice || 0,
        reserved,
        soldLast30Days: sold30,
      };
    })
  );
  ok(res, { rows });
};

const aging = async (req, res) => {
  // Pieces still on display, with days-on-display. Sorted oldest-first.
  const items = await prisma.productInstance.findMany({
    where: { isActive: true, currentStage: { in: ['IN_SHOWROOM', 'AVAILABLE'] }, arrivalDate: { not: null } },
    orderBy: { arrivalDate: 'asc' },
    include: { product: true, currentLocation: true },
  });
  const now = Date.now();
  const rows = items.map((i) => ({
    id: i.id,
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
    if (req.query.from) where.saleDate.gte = new Date(req.query.from);
    if (req.query.to) where.saleDate.lte = new Date(req.query.to);
  }
  if (req.query.showroomId) where.showroomId = Number(req.query.showroomId);

  const [items, totals] = await prisma.$transaction([
    prisma.showroomSale.findMany({
      where,
      orderBy: { saleDate: 'desc' },
      include: { instance: { include: { product: true } }, showroom: true },
    }),
    prisma.showroomSale.aggregate({ where, _sum: { salePrice: true, discount: true }, _count: true }),
  ]);
  ok(res, {
    items,
    totals: {
      count: totals._count,
      revenue: totals._sum.salePrice || 0,
      discount: totals._sum.discount || 0,
      avgSalePrice: totals._count ? Number(totals._sum.salePrice || 0) / totals._count : 0,
    },
  });
};

const crossShowroomSearch = async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const where = { isActive: true };
  if (q) {
    where.OR = [
      { instanceCode: { contains: q, mode: 'insensitive' } },
      { product: { name: { contains: q, mode: 'insensitive' } } },
      { product: { code: { contains: q, mode: 'insensitive' } } },
    ];
  }
  if (req.query.material) where.product = { ...(where.product || {}), materialType: req.query.material };
  if (req.query.stage) where.currentStage = req.query.stage;

  const items = await prisma.productInstance.findMany({
    where,
    include: { product: true, currentLocation: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  // Group by showroom code.
  const groups = {};
  for (const i of items) {
    const key = i.currentLocation?.code || 'UNKNOWN';
    (groups[key] ||= { showroom: i.currentLocation, items: [] }).items.push(i);
  }
  ok(res, { groups });
};

module.exports = { showroomSummary, aging, salesSummary, crossShowroomSearch };
