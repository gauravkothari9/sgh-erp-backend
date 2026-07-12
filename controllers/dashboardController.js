const Order = require('../models/Order');
const Customer = require('../models/Customer');
const ShowroomProduct = require('../models/ShowroomProduct');
const LocalSale = require('../models/LocalSale');
const LocalCustomer = require('../models/LocalCustomer');
const User = require('../models/User');
const { successResponse } = require('../utils/apiResponse');
const { STAGE, BOARD_COLUMNS } = require('../config/production');

// Statuses that mean "live work in the building".
const PROCESSING = ['Pending', 'In Production', 'QC', 'Polish', 'Packaging', 'Ready to Ship'];

/**
 * ─── @GET /api/v1/dashboard ─────────────────────────────────────────────────
 *
 * One payload for the whole dashboard, assembled per-viewer: a section is only
 * computed and returned if the user holds `read` on the module behind it. An
 * Admin gets everything; a showroom employee gets showroom + local only. The
 * frontend renders whatever sections it receives, so permissions drive the
 * layout instead of the frontend guessing.
 */
exports.getDashboard = async (req, res) => {
  const user = req.user;
  const can = (m) => user.hasPermission(m, 'read');

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const data = { sections: [] };

  // ── Orders (Office) ───────────────────────────────────────────────────────
  if (can('orders')) {
    const [byStatus, thisMonth, revenue, recent, drafts] = await Promise.all([
      Order.aggregate([
        { $match: { orderStatus: { $ne: 'Cancelled' } } },
        { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
      ]),
      Order.countDocuments({ createdAt: { $gte: startOfMonth }, orderStatus: { $ne: 'Cancelled' } }),
      Order.aggregate([
        { $match: { orderStatus: { $nin: ['Cancelled', 'Draft'] } } },
        { $group: { _id: null, total: { $sum: '$finalAmount' } } },
      ]),
      Order.find({ orderStatus: { $ne: 'Cancelled' } })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('orderNumber fileNumber orderStatus finalAmount currency createdAt')
        .populate('customer', 'companyName')
        .lean(),
      Order.countDocuments({ orderStatus: 'Draft' }),
    ]);

    const statusMap = Object.fromEntries(byStatus.map((s) => [s._id, s.count]));
    const total = byStatus.reduce((s, x) => s + x.count, 0);

    data.orders = {
      total,
      thisMonth,
      drafts,
      finalized: statusMap.Finalized || 0,
      inProcess: PROCESSING.reduce((s, k) => s + (statusMap[k] || 0), 0),
      completed: statusMap.Completed || 0,
      revenue: revenue[0]?.total || 0,
      byStatus: statusMap,
      recent,
    };
    data.sections.push('orders');
  }

  // ── Customers (Office) ────────────────────────────────────────────────────
  if (can('customers')) {
    const [total, thisMonth] = await Promise.all([
      Customer.countDocuments({}),
      Customer.countDocuments({ createdAt: { $gte: startOfMonth } }),
    ]);
    data.customers = { total, thisMonth };
    data.sections.push('customers');
  }

  // ── Production (Factory) ──────────────────────────────────────────────────
  if (can('production')) {
    const orders = await Order.find({ orderStatus: { $in: PROCESSING } })
      .select('items')
      .lean();

    const byStage = {};
    let needsSetup = 0;
    let itemsInPlay = 0;

    orders.forEach((o) => {
      (o.items || []).forEach((item) => {
        const p = item.production || {};
        itemsInPlay += 1;
        if (!p.currentStage) { needsSetup += 1; return; }
        (p.stageQty || []).forEach((sq) => {
          if (!sq.qty) return;
          byStage[sq.stage] = (byStage[sq.stage] || 0) + sq.qty;
        });
      });
    });

    data.production = {
      itemsInPlay,
      needsSetup,
      readyForContainer: byStage[STAGE.READY] || 0,
      byStage: BOARD_COLUMNS.filter((c) => byStage[c]).map((c) => ({ stage: c, units: byStage[c] })),
    };
    data.sections.push('production');
  }

  // ── Showroom (per branch the user can read) ───────────────────────────────
  const showroomBranches = [
    can('showroomKakani') && 'Kakani',
    can('showroomJhalamand') && 'Jhalamand',
  ].filter(Boolean);

  if (showroomBranches.length) {
    const products = await ShowroomProduct.find({
      'locations.branch': { $in: showroomBranches },
    })
      .select('name sku localPrice locations totalQty collectionName')
      .lean();

    let units = 0;
    let noLocalPrice = 0;
    const perBranch = Object.fromEntries(showroomBranches.map((b) => [b, { items: 0, units: 0 }]));

    products.forEach((p) => {
      const visible = (p.locations || []).filter((l) => showroomBranches.includes(l.branch));
      const u = visible.reduce((s, l) => s + (l.qty || 0), 0);
      units += u;
      if (!p.localPrice) noLocalPrice += 1;
      [...new Set(visible.map((l) => l.branch))].forEach((b) => {
        perBranch[b].items += 1;
        perBranch[b].units += visible.filter((l) => l.branch === b).reduce((s, l) => s + l.qty, 0);
      });
    });

    data.showroom = {
      branches: showroomBranches,
      items: products.length,
      units,
      noLocalPrice,
      perBranch: Object.entries(perBranch).map(([branch, v]) => ({ branch, ...v })),
    };
    data.sections.push('showroom');
  }

  // ── Local sales ───────────────────────────────────────────────────────────
  if (can('localSales')) {
    const [sales, todaySales, customers] = await Promise.all([
      LocalSale.find({}).select('totalAmount balanceDue refundDue paymentStatus saleDate saleNumber customerName').lean(),
      LocalSale.countDocuments({ saleDate: { $gte: startOfToday } }),
      can('localCustomers') ? LocalCustomer.countDocuments({}) : Promise.resolve(null),
    ]);

    const thisMonth = sales.filter((s) => new Date(s.saleDate) >= startOfMonth);

    data.local = {
      orders: sales.length,
      today: todaySales,
      monthRevenue: thisMonth.reduce((s, x) => s + (x.totalAmount || 0), 0),
      revenue: sales.reduce((s, x) => s + (x.totalAmount || 0), 0),
      balanceDue: sales.reduce((s, x) => s + (x.balanceDue || 0), 0),
      refundDue: sales.reduce((s, x) => s + (x.refundDue || 0), 0),
      unpaid: sales.filter((s) => s.paymentStatus !== 'Paid').length,
      customers,
      recent: sales
        .sort((a, b) => new Date(b.saleDate) - new Date(a.saleDate))
        .slice(0, 5),
    };
    data.sections.push('local');
  }

  // ── Team (Admin) ──────────────────────────────────────────────────────────
  if (can('users')) {
    const [total, active, admins] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      User.countDocuments({ role: 'Admin' }),
    ]);
    data.team = { total, active, admins, employees: total - admins };
    data.sections.push('team');
  }

  successResponse(res, data);
};
