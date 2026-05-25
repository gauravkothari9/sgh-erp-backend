const prisma = require('../src/lib/prisma');
const { AppError } = require('../middleware/errorHandler');
const {
  successResponse,
  paginatedResponse,
  buildPagination,
} = require('../utils/apiResponse');

// Shape a catalogue product for the wire — exposes _id and a `barcode`
// object the legacy frontend reads (Prisma stores barcodeText/barcodeImage
// as separate columns).
const shapeProduct = (p) => ({
  ...p,
  _id: p.id,
  barcode: { text: p.barcodeText || '', image: p.barcodeImage || '' },
});

// ─── @GET /api/v1/buyer-catalogue ───────────────────────────────────────────
// Folder list with pagination. `?search=` matches fileNumber OR the customer's
// companyName.
exports.getBuyerFolders = async (req, res) => {
  const { page = 1, limit = 20, search } = req.query;
  const pg = parseInt(page, 10);
  const lim = parseInt(limit, 10);

  // We need each folder + the related customer + product count. Pull a
  // generous slice, do the optional search filter in JS, then paginate. For
  // very large catalogues this should grow into a SQL view, but the volume
  // here is modest.
  const all = await prisma.buyerCatalogueFolder.findMany({
    orderBy: { lastUpdated: 'desc' },
    include: {
      _count: { select: { products: true } },
    },
  });

  // Hydrate the customers in one query.
  const buyerIds = [...new Set(all.map((f) => f.buyerId))];
  const buyers = buyerIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: buyerIds } },
        select: { id: true, companyName: true },
      })
    : [];
  const buyerMap = Object.fromEntries(buyers.map((b) => [b.id, b]));

  let folders = all.map((f) => ({
    _id: f.id,
    fileNumber: f.fileNumber,
    lastUpdated: f.lastUpdated,
    buyerName: buyerMap[f.buyerId]?.companyName || null,
    productCount: f._count.products,
  }));

  if (search) {
    const s = String(search).toLowerCase();
    folders = folders.filter(
      (f) =>
        (f.fileNumber || '').toLowerCase().includes(s) ||
        (f.buyerName || '').toLowerCase().includes(s)
    );
  }

  const total = folders.length;
  const start = (pg - 1) * lim;
  const slice = folders.slice(start, start + lim);

  paginatedResponse(res, slice, buildPagination(total, pg, lim), 'Buyer folders retrieved');
};

// ─── @GET /api/v1/buyer-catalogue/:fileNumber ─────────────────────────────────
exports.getCatalogueDetail = async (req, res) => {
  const { fileNumber } = req.params;
  // fileNumber isn't unique on its own (the unique key is buyerId+fileNumber),
  // but in practice it's unique per customer file — first match is fine.
  const folder = await prisma.buyerCatalogueFolder.findFirst({
    where: { fileNumber },
    include: { products: { orderBy: { sku: 'asc' } } },
  });
  if (!folder) throw new AppError('Catalogue not found for this file number', 404);

  const buyer = await prisma.customer.findUnique({
    where: { id: folder.buyerId },
    select: { id: true, companyName: true },
  });

  let products = folder.products || [];
  if (req.query.search) {
    const s = String(req.query.search).toLowerCase();
    products = products.filter(
      (p) =>
        (p.sku || '').toLowerCase().includes(s) ||
        (p.itemDescription || '').toLowerCase().includes(s)
    );
  }

  successResponse(
    res,
    {
      buyer: buyer ? { _id: buyer.id, companyName: buyer.companyName } : null,
      fileNumber: folder.fileNumber,
      lastUpdated: folder.lastUpdated,
      products: products.map(shapeProduct),
    },
    'Catalogue detail retrieved'
  );
};

// ─── @GET /api/v1/buyer-catalogue/:fileNumber/sku/:sku ──────────────────────
// Single-product lookup for the Order Autofill flow.
exports.getSkuLookup = async (req, res) => {
  const { fileNumber, sku } = req.params;
  const upper = String(sku).toUpperCase();

  const product = await prisma.buyerCatalogueProduct.findFirst({
    where: {
      sku: upper,
      folder: { fileNumber },
    },
  });

  if (!product) {
    return res.status(200).json({
      success: true,
      data: null,
      message: 'SKU not found in catalogue',
    });
  }

  successResponse(res, shapeProduct(product), 'SKU logic retrieved');
};
