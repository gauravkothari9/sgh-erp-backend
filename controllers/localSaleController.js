const LocalSale = require('../models/LocalSale');
const LocalCustomer = require('../models/LocalCustomer');
const { AppError } = require('../middleware/errorHandler');
const { successResponse, createdResponse } = require('../utils/apiResponse');
const { deductShowroomStock, restoreShowroomStock } = require('../utils/showroomStock');
const { notify, showroomModule } = require('../utils/notify');

// SGH-LS-2026-0001
const generateSaleNumber = async () => {
  const year = new Date().getFullYear();
  const latest = await LocalSale.findOne(
    { saleNumber: new RegExp(`^SGH-LS-${year}-`) },
    { saleNumber: 1 },
    { sort: { saleNumber: -1 }, lean: true }
  );
  const lastSeq = latest ? parseInt(latest.saleNumber.split('-').pop(), 10) : 0;
  return `SGH-LS-${year}-${String(lastSeq + 1).padStart(4, '0')}`;
};

// ─── @GET /api/v1/local/sales?search=&customer=&paymentStatus= ───────────────
exports.getSales = async (req, res) => {
  const { search, customer, paymentStatus, limit = 50, page = 1 } = req.query;

  const filter = {};
  if (customer) filter.customer = customer;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ saleNumber: rx }, { customerName: rx }, { customerPhone: rx }];
  }

  const perPage = Math.min(parseInt(limit, 10) || 50, 200);
  const skip = (Math.max(parseInt(page, 10) || 1, 1) - 1) * perPage;

  const [sales, total] = await Promise.all([
    LocalSale.find(filter).sort({ saleDate: -1 }).skip(skip).limit(perPage).lean(),
    LocalSale.countDocuments(filter),
  ]);

  successResponse(res, { sales, total, page: Number(page), limit: perPage });
};

// ─── @GET /api/v1/local/sales/:id ────────────────────────────────────────────
exports.getSale = async (req, res) => {
  const sale = await LocalSale.findById(req.params.id).populate('customer').lean();
  if (!sale) throw new AppError('Local order not found', 404);
  successResponse(res, { sale });
};

// ─── @POST /api/v1/local/sales ───────────────────────────────────────────────
// Body: { customer, items: [{ product, sku, name, size, image, comments,
//         branch, zone, quantity, unitPrice }], discount, paymentMode,
//         amountPaid, saleDate, notes }
//
// Confirming the sale deducts the units from showroom stock — across zones when
// one zone can't cover the quantity.
exports.createSale = async (req, res) => {
  const { customer: customerId, items, discount, paymentMode, amountPaid, saleDate, notes } = req.body;

  const customer = await LocalCustomer.findById(customerId);
  if (!customer) throw new AppError('Pick a local customer for this order.', 404);
  if (!Array.isArray(items) || items.length === 0) throw new AppError('Add at least one item.', 400);

  const lines = items.map((it) => {
    const quantity = Math.max(parseInt(it.quantity, 10) || 0, 0);
    if (!it.name?.trim()) throw new AppError('Every item needs a name.', 400);
    if (quantity < 1) throw new AppError(`Quantity for "${it.name}" must be at least 1.`, 400);
    return {
      product: it.product || undefined,
      sku: (it.sku || '').trim(),
      name: it.name.trim(),
      size: (it.size || '').trim(),
      image: it.image || '',
      comments: (it.comments || '').trim(),
      branch: it.branch || '',
      zone: it.zone || '',
      quantity,
      unitPrice: Math.max(parseFloat(it.unitPrice) || 0, 0),
    };
  });

  // Deduct stock first — if the showroom is short, no sale is written at all.
  const stockEntries = lines
    .filter((l) => l.product)
    .map((l) => ({ id: l.product, qty: l.quantity, branch: l.branch, zone: l.zone }));
  if (stockEntries.length) await deductShowroomStock(stockEntries, req.user);

  const sale = new LocalSale({
    saleNumber: await generateSaleNumber(),
    customer: customer._id,
    customerName: customer.name,
    customerPhone: customer.phone,
    items: lines,
    discount: Math.max(parseFloat(discount) || 0, 0),
    paymentMode: paymentMode || 'Cash',
    amountPaid: Math.max(parseFloat(amountPaid) || 0, 0),
    saleDate: saleDate ? new Date(saleDate) : new Date(),
    notes: (notes || '').trim(),
    createdBy: req.user._id,
  });
  await sale.save(); // pre-save computes subtotal / total / balance / status

  await notify(['localSales'], {
    type: 'local-sale-created',
    title: 'Local order created',
    message: `${sale.saleNumber} — ${customer.name}, ₹${sale.totalAmount.toLocaleString('en-IN')} (${sale.paymentStatus}).`,
    link: `/local/orders/${sale._id}`,
  }, { exclude: req.user._id });

  // Money still outstanding — that's someone's follow-up.
  if (sale.balanceDue > 0) {
    await notify(['localSales'], {
      type: 'local-sale-balance-due',
      title: 'Payment pending',
      message: `${sale.saleNumber} (${customer.name}) has ₹${sale.balanceDue.toLocaleString('en-IN')} outstanding.`,
      link: `/local/orders/${sale._id}`,
    });
  }

  createdResponse(res, { sale }, 'Local order created');
};

// ─── @PATCH /api/v1/local/sales/:id/payment ──────────────────────────────────
// Record a payment against an existing order: { amountPaid, paymentMode }
exports.updatePayment = async (req, res) => {
  const sale = await LocalSale.findById(req.params.id);
  if (!sale) throw new AppError('Local order not found', 404);

  if (req.body.amountPaid !== undefined) {
    sale.amountPaid = Math.max(parseFloat(req.body.amountPaid) || 0, 0);
  }
  if (req.body.paymentMode) sale.paymentMode = req.body.paymentMode;

  await sale.save(); // recomputes balanceDue / paymentStatus

  await notify(['localSales'], {
    type: 'local-sale-payment',
    title: sale.paymentStatus === 'Paid' ? 'Local order fully paid' : 'Payment recorded',
    message: `${sale.saleNumber} (${sale.customerName}) — paid ₹${sale.amountPaid.toLocaleString('en-IN')} of ₹${sale.totalAmount.toLocaleString('en-IN')}. ${
      sale.balanceDue > 0 ? `₹${sale.balanceDue.toLocaleString('en-IN')} still due.` : 'Settled.'
    }`,
    link: `/local/orders/${sale._id}`,
  }, { exclude: req.user._id });

  successResponse(res, { sale }, 'Payment updated');
};

// ─── @POST /api/v1/local/sales/:id/return ────────────────────────────────────
// Take items back: { items: [{ index, qty, branch?, zone? }], reason }
// The units go back onto the showroom floor (into the zone they were sold from
// unless another is named) and drop out of the billed amount. If the customer
// had already paid more than the new total, the bill flips to "Refund Due".
exports.returnItems = async (req, res) => {
  const sale = await LocalSale.findById(req.params.id);
  if (!sale) throw new AppError('Local order not found', 404);

  const rows = Array.isArray(req.body.items) ? req.body.items : [];
  if (!rows.length) throw new AppError('Pick at least one item to return.', 400);

  const restoreEntries = [];
  const logged = [];

  for (const row of rows) {
    const idx = parseInt(row.index, 10);
    const qty = Math.max(parseInt(row.qty, 10) || 0, 0);
    if (!qty) continue;

    const item = sale.items[idx];
    if (!item) throw new AppError('Item not found on this order.', 400);

    const remaining = (item.quantity || 0) - (item.returnedQty || 0);
    if (qty > remaining) {
      throw new AppError(`Only ${remaining} unit(s) of "${item.name}" can still be returned.`, 400);
    }

    const branch = row.branch || item.branch;
    const zone = row.zone || item.zone;
    item.returnedQty = (item.returnedQty || 0) + qty;

    if (item.product) restoreEntries.push({ id: item.product, qty, branch, zone });
    logged.push({
      index: idx,
      name: item.name,
      qty,
      branch: branch || '',
      zone: zone || '',
      refundValue: qty * (item.unitPrice || 0),
    });
  }

  if (!logged.length) throw new AppError('Nothing to return.', 400);

  // Put the units back before the bill is rewritten — if the restore fails, the
  // order stays exactly as it was.
  if (restoreEntries.length) await restoreShowroomStock(restoreEntries, req.user);

  sale.returns.push({
    items: logged,
    refundValue: logged.reduce((s, l) => s + l.refundValue, 0),
    reason: (req.body.reason || '').trim(),
    byName: req.user.fullName || '',
  });

  await sale.save(); // recomputes subtotal / total / balance / refundDue / status

  const returnedUnits = logged.reduce((s, l) => s + l.qty, 0);
  const backTo = [...new Set(logged.map((l) => l.branch).filter(Boolean))];

  // Local staff care about the bill; showroom staff care that stock came back.
  await notify(
    ['localSales', ...backTo.map(showroomModule)],
    {
      type: 'local-sale-returned',
      title: 'Items returned',
      message: `${returnedUnits} unit(s) returned on ${sale.saleNumber} (${sale.customerName}) — back in ${
        logged.map((l) => `${l.branch} ${l.zone}`).join(', ') || 'the showroom'
      }.`,
      link: `/local/orders/${sale._id}`,
    },
    { exclude: req.user._id }
  );

  if (sale.refundDue > 0) {
    await notify(['localSales'], {
      type: 'local-sale-refund-due',
      title: 'Refund due',
      message: `${sale.saleNumber} (${sale.customerName}) — ₹${sale.refundDue.toLocaleString('en-IN')} owed back to the customer.`,
      link: `/local/orders/${sale._id}`,
    });
  }

  successResponse(res, { sale }, 'Items returned');
};

// ─── @DELETE /api/v1/local/sales/:id ─────────────────────────────────────────
// Deleting a bill does NOT put the units back on the showroom floor — they
// already left the building. Adjust stock by hand if the goods come back.
exports.deleteSale = async (req, res) => {
  const sale = await LocalSale.findById(req.params.id);
  if (!sale) throw new AppError('Local order not found', 404);
  await sale.deleteOne();
  successResponse(res, {}, 'Local order deleted');
};
