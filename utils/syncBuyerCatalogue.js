// Synchronize an order's items into the corresponding BuyerCatalogue
// (Prisma version). Idempotent — safe to call repeatedly: existing products
// get updated, new products get inserted, priceHistory tracks every
// price/quantity change per order.

const prisma = require('../src/lib/prisma');

// Normalize a stored media path so the frontend can render it from origin root.
const normalizePath = (p) => {
  if (!p || typeof p !== 'string') return p;
  const forward = p.replace(/\\/g, '/').trim();
  if (!forward) return forward;
  if (/^https?:\/\//i.test(forward)) return forward;
  return forward.startsWith('/') ? forward : `/${forward}`;
};
const normalizePaths = (arr) =>
  Array.isArray(arr) ? arr.map(normalizePath).filter(Boolean) : arr;

// Coerce a value that may be a Prisma Decimal / string / number to Number.
const num = (v, d = 0) => {
  if (v === null || v === undefined) return d;
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/**
 * @param {Object} order — Prisma Order with items included.
 * @param {Object} user — req.user (Prisma user).
 */
const syncBuyerCatalogue = async (order, user) => {
  if (!order?.customerId || !order?.fileNumber) return;
  if (!Array.isArray(order.items) || order.items.length === 0) return;

  const buyerId = order.customerId;
  const fileNumber = order.fileNumber;

  // Find or create the folder.
  let folder = await prisma.buyerCatalogueFolder.findUnique({
    where: { buyerId_fileNumber: { buyerId, fileNumber } },
    include: { products: true },
  });
  if (!folder) {
    folder = await prisma.buyerCatalogueFolder.create({
      data: { buyerId, fileNumber },
      include: { products: true },
    });
  }

  await prisma.buyerCatalogueFolder.update({
    where: { id: folder.id },
    data: { lastUpdated: new Date() },
  });

  for (const item of order.items) {
    if (!item.companySKU) continue;
    const sku = String(item.companySKU).trim().toUpperCase();
    const qty = parseInt(item.quantity || 1, 10);
    const price = num(item.unitPrice);

    const priceEntry = {
      price,
      currency: order.currency || 'USD',
      quantity: qty,
      orderNumber: order.orderNumber,
      orderId: order.id,
      date: (order.finalizedAt || order.orderDate || new Date()).toISOString(),
      recordedBy: user ? user.id : null,
    };
    const revisionEntry = { ...priceEntry, date: new Date().toISOString() };

    const existing = folder.products.find((p) => p.sku === sku);

    // Build the canonical product payload from the order item.
    const productBase = {
      buyerSKU: item.buyerSKU ?? undefined,
      itemDescription: item.itemDescription ?? undefined,
      buyerDescription: item.buyerDescription ?? undefined,
      itemCategory: item.itemCategory ?? undefined,
      collectionName: item.collectionName ?? undefined,
      materials: Array.isArray(item.materials) && item.materials.length > 0 ? item.materials : undefined,
      finishes: Array.isArray(item.finishes) && item.finishes.length > 0 ? item.finishes : undefined,
      itemCondition: item.itemCondition ?? undefined,
      hsnCode: item.hsnCode ?? undefined,
      barcodeText: item.barcodeText ?? undefined,
      barcodeImage: item.barcodeImage ? normalizePath(item.barcodeImage) : undefined,
      dimensions:
        item.dimensions && (item.dimensions.length || item.dimensions.width || item.dimensions.height)
          ? item.dimensions
          : undefined,
      cbm: item.cbm ?? undefined,
      weight: item.weight ?? undefined,
      productionNotes: item.productionNotes ?? undefined,
      qcNotes: item.qcNotes ?? undefined,
      polishNotes: item.polishNotes ?? undefined,
      packagingNotes: item.packagingNotes ?? undefined,
    };

    const normalizedImages = normalizePaths(item.images) || [];
    const normalizedPrimary =
      normalizePath(item.primaryImage) || (normalizedImages.length > 0 ? normalizedImages[0] : null);

    if (existing) {
      // Update path — copy over non-empty fields, refresh images / primaryImage
      // when present, and append/update priceHistory.
      const data = {};
      for (const [k, v] of Object.entries(productBase)) {
        if (v !== undefined) data[k] = v;
      }
      if (normalizedImages.length > 0) data.images = normalizedImages;
      if (normalizedPrimary) data.primaryImage = normalizedPrimary;

      const history = Array.isArray(existing.priceHistory) ? [...existing.priceHistory] : [];
      const ownHistory = history.filter((h) => h && h.orderId === order.id);
      const latestOwn = ownHistory.length > 0 ? ownHistory[ownHistory.length - 1] : null;

      let totalTimesOrdered = existing.totalTimesOrdered || 0;
      let totalQuantityOrdered = existing.totalQuantityOrdered || 0;
      let lastOrderedAt = existing.lastOrderedAt;

      if (!latestOwn) {
        history.push(priceEntry);
        totalTimesOrdered += 1;
        totalQuantityOrdered += qty;
        lastOrderedAt = new Date(priceEntry.date);
      } else {
        const prevPrice = num(latestOwn.price);
        const prevQty = num(latestOwn.quantity);
        if (prevPrice !== price || prevQty !== qty) {
          history.push(revisionEntry);
          totalQuantityOrdered = totalQuantityOrdered - prevQty + qty;
          lastOrderedAt = new Date(revisionEntry.date);
        }
      }

      data.priceHistory = history;
      data.currentPrice = price;
      data.totalTimesOrdered = totalTimesOrdered;
      data.totalQuantityOrdered = totalQuantityOrdered;
      data.lastOrderedAt = lastOrderedAt;

      await prisma.buyerCatalogueProduct.update({ where: { id: existing.id }, data });
    } else {
      // Create path
      await prisma.buyerCatalogueProduct.create({
        data: {
          folderId: folder.id,
          sku,
          ...Object.fromEntries(
            Object.entries(productBase).filter(([, v]) => v !== undefined)
          ),
          images: normalizedImages,
          primaryImage: normalizedPrimary,
          firstOrderedAt: new Date(priceEntry.date),
          lastOrderedAt: new Date(priceEntry.date),
          totalTimesOrdered: 1,
          totalQuantityOrdered: qty,
          currentPrice: price,
          priceHistory: [priceEntry],
        },
      });
    }
  }
};

module.exports = { syncBuyerCatalogue };
