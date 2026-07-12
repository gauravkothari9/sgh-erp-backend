const ShowroomProduct = require('../models/ShowroomProduct');
const { AppError } = require('../middleware/errorHandler');
const { isValidLocation } = require('../config/showroom');
const { notify, showroomModule } = require('./notify');

// The permission module a given branch maps to.
const moduleFor = (branch) => (branch === 'Kakani' ? 'showroomKakani' : 'showroomJhalamand');

// A product can span both branches, so touching its stock requires the update
// permission on every branch it currently sits in.
const assertStockPermission = (user, product) => {
  const branches = [
    ...new Set((product.locations || []).map((l) => l.branch).filter(Boolean)),
  ];
  const list = branches.length ? branches : [product.branch].filter(Boolean);
  if (!list.length) throw new AppError('Product has no showroom location.', 400);
  list.forEach((b) => {
    if (!user.hasPermission(moduleFor(b), 'update')) {
      throw new AppError(`Access denied. Missing 'update' permission on ${b} showroom.`, 403);
    }
  });
};

/**
 * Deduct sold/ordered units from showroom stock.
 *
 * Units come out of the zone the item was picked in first, then out of the
 * remaining zones (fullest first) until the quantity is covered — an item with
 * 5 in Jhalamand A and 10 in Jhalamand C can satisfy an order for 12.
 *
 * @param {Array} entries  [{ id, qty, branch?, zone? }]
 * @param {Object} user    req.user — needs `hasPermission`
 * @returns {Promise<Array>} [{ id, totalQty }] — remaining stock per product
 */
const deductShowroomStock = async (entries, user) => {
  const results = [];

  for (const entry of entries || []) {
    const qty = Math.max(parseInt(entry?.qty, 10) || 0, 0);
    if (!qty) continue;

    const product = await ShowroomProduct.findById(entry.id);
    if (!product) throw new AppError('Product not found while updating showroom stock.', 404);
    assertStockPermission(user, product);

    if (product.totalQty < qty) {
      throw new AppError(
        `Only ${product.totalQty} unit(s) of "${product.name}" left in the showrooms.`,
        400
      );
    }

    const preferredZone = String(entry.zone || '').toUpperCase();
    const ordered = [...product.locations].sort((a, b) => {
      const aPref = a.branch === entry.branch && a.zone === preferredZone ? 1 : 0;
      const bPref = b.branch === entry.branch && b.zone === preferredZone ? 1 : 0;
      if (aPref !== bPref) return bPref - aPref;
      return b.qty - a.qty;
    });

    let left = qty;
    for (const loc of ordered) {
      if (left <= 0) break;
      const take = Math.min(loc.qty, left);
      loc.qty -= take;
      left -= take;
    }

    // Capture the branches before the save — emptied zones get dropped by the
    // pre-save hook, so afterwards we can't tell whose showroom it left.
    const heldBranches = [...new Set((product.locations || []).map((l) => l.branch))];
    await product.save(); // pre-save drops emptied zones and recomputes totalQty

    // Sold out — nothing of this product is left on any showroom floor.
    if (product.totalQty === 0) {
      await notify(
        [...new Set(heldBranches.map(showroomModule))],
        {
          type: 'showroom-sold-out',
          title: 'Showroom stock exhausted',
          message: `"${product.name}"${product.sku ? ` (${product.sku})` : ''} is sold out — no units left in any zone.`,
          link: '/showroom/collections',
        },
        { exclude: user._id }
      );
    }

    results.push({ id: String(product._id), totalQty: product.totalQty });
  }

  return results;
};

/**
 * Put units back on the showroom floor — a local return.
 *
 * Units go back into the zone they were sold from (or the zone the user names
 * on the return). If the product has no row for that zone yet — it may have
 * sold out completely — one is created.
 *
 * @param {Array} entries  [{ id, qty, branch, zone }]
 * @param {Object} user    req.user — needs `hasPermission`
 * @returns {Promise<Array>} [{ id, totalQty }]
 */
const restoreShowroomStock = async (entries, user) => {
  const results = [];

  for (const entry of entries || []) {
    const qty = Math.max(parseInt(entry?.qty, 10) || 0, 0);
    if (!qty) continue;

    const product = await ShowroomProduct.findById(entry.id);
    if (!product) throw new AppError('Product not found while returning showroom stock.', 404);

    const branch = entry.branch || product.branch;
    const zone = String(entry.zone || product.zone || '').toUpperCase();
    if (!isValidLocation(branch, zone)) {
      throw new AppError(`Invalid return location: ${branch || '?'} zone ${zone || '?'}.`, 400);
    }
    if (!user.hasPermission(moduleFor(branch), 'update')) {
      throw new AppError(`Access denied. Missing 'update' permission on ${branch} showroom.`, 403);
    }

    const loc = product.locations.find((l) => l.branch === branch && l.zone === zone);
    if (loc) loc.qty += qty;
    else product.locations.push({ branch, zone, qty });

    await product.save(); // recomputes totalQty
    results.push({ id: String(product._id), totalQty: product.totalQty });
  }

  return results;
};

module.exports = { deductShowroomStock, restoreShowroomStock, assertStockPermission };
