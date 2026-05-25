const path = require('path');
const prisma = require('../src/lib/prisma');
const generateOrderNumber = require('../utils/generateOrderNumber');
const generatePINumber = require('../utils/generatePINumber');
const { syncBuyerCatalogue } = require('../utils/syncBuyerCatalogue');
const { AppError } = require('../middleware/errorHandler');
const {
  uploadToGitHub,
  uploadMultipleToGitHub,
  deleteFromGitHub,
  renameOnGitHub,
  isGitHubUrl,
} = require('../utils/localStorage');
const {
  successResponse,
  createdResponse,
  paginatedResponse,
  buildPagination,
} = require('../utils/apiResponse');
const {
  toDbOrderStatus,
  toFrontendOrderStatus,
  toDbOrderType,
  toFrontendOrderType,
} = require('../utils/enumMaps');

// ─── Filename helper (same rules as the legacy Mongo version) ────────────────
const STRUCTURED_NAME = /_(Pro|Bar|Cmt)(-\d+)?$/i;

const uniqueName = (prefix, originalname) => {
  const ext = path.extname(originalname);
  const baseRaw = path.basename(originalname, ext);
  const base = (baseRaw || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (base && STRUCTURED_NAME.test(base)) return `${base}${ext}`;
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return base ? `${base}-${stamp}${ext}` : `${prefix}-${stamp}${ext}`;
};

const uploadFilesToGitHub = async (files, prefix, folder) => {
  const items = files.map((f) => ({ buffer: f.buffer, filename: uniqueName(prefix, f.originalname) }));
  return uploadMultipleToGitHub(items, folder);
};

// ─── Item shape translation ──────────────────────────────────────────────────
// Frontend sends item.barcode = { text, image }. Prisma stores barcodeText +
// barcodeImage. Translate at the wire boundary in both directions.
const itemFromFrontend = (it) => {
  const out = { ...it };
  if (it.barcode) {
    out.barcodeText = it.barcode.text ?? out.barcodeText;
    out.barcodeImage = it.barcode.image ?? out.barcodeImage;
    delete out.barcode;
  }
  // Strip fields the schema doesn't know about (id, _id, timestamps).
  delete out.id;
  delete out._id;
  delete out.createdAt;
  delete out.updatedAt;
  delete out.linkedJobOrderId;
  return out;
};
const itemToFrontend = (it) => ({
  ...it,
  _id: it.id,
  barcode: { text: it.barcodeText || '', image: it.barcodeImage || '' },
});

// Shape an order for the wire — exposes _id and turns enums back into the
// PascalCase strings the React app reads.
const shape = (o) => {
  if (!o) return o;
  return {
    ...o,
    _id: o.id,
    orderStatus: toFrontendOrderStatus(o.orderStatus),
    orderType: toFrontendOrderType(o.orderType),
    items: Array.isArray(o.items) ? o.items.map(itemToFrontend) : o.items,
    customer: o.customer
      ? { ...o.customer, _id: o.customer.id }
      : o.customer,
    createdBy: o.createdBy
      ? { _id: o.createdBy.id, fullName: o.createdBy.fullName, email: o.createdBy.email }
      : o.createdBy,
  };
};

// Sanitize the order item payload: drop unknown fields, coerce numbers.
const itemDataForWrite = (item) => {
  const t = itemFromFrontend(item);
  const data = {
    companySKU: t.companySKU,
    buyerSKU: t.buyerSKU || null,
    buyerDescription: t.buyerDescription || null,
    itemDescription: t.itemDescription || null,
    itemCategory: t.itemCategory || null,
    collectionName: t.collectionName || null,
    materials: Array.isArray(t.materials) ? t.materials : [],
    finishes: Array.isArray(t.finishes) ? t.finishes : [],
    itemCondition: t.itemCondition || null,
    hsnCode: t.hsnCode || null,
    barcodeText: t.barcodeText || null,
    barcodeImage: t.barcodeImage || null,
    dimensions: t.dimensions || null,
    cbm: Number(t.cbm || 0),
    totalCBM: Number(t.totalCBM || (Number(t.cbm || 0) * Number(t.quantity || 0))),
    weight: Number(t.weight || 0),
    quantity: parseInt(t.quantity || 0, 10),
    unitPrice: Number(t.unitPrice || 0),
    totalPrice: Number(t.totalPrice || (Number(t.unitPrice || 0) * parseInt(t.quantity || 0, 10))),
    images: Array.isArray(t.images) ? t.images : [],
    primaryImage: t.primaryImage || null,
    comments: Array.isArray(t.comments) ? t.comments : [],
    productionNotes: t.productionNotes || null,
    qcNotes: t.qcNotes || null,
    polishNotes: t.polishNotes || null,
    packagingNotes: t.packagingNotes || null,
    sortOrder: parseInt(t.sortOrder || 0, 10),
  };
  return data;
};

// ─── @GET /api/v1/orders ─────────────────────────────────────────────────────
exports.getOrders = async (req, res) => {
  const {
    page = 1,
    limit = 20,
    status,
    orderType,
    country,
    containerSize,
    dateFrom,
    dateTo,
    search,
    fileNumber,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = req.query;

  const where = {};
  if (status) {
    const statuses = status.split(',').map(toDbOrderStatus);
    where.orderStatus = statuses.length === 1 ? statuses[0] : { in: statuses };
  }
  if (orderType) where.orderType = toDbOrderType(orderType);
  if (containerSize) where.containerSize = containerSize;
  if (fileNumber) where.fileNumber = fileNumber;

  if (dateFrom || dateTo) {
    where.orderDate = {};
    if (dateFrom) where.orderDate.gte = new Date(dateFrom);
    if (dateTo) where.orderDate.lte = new Date(dateTo);
  }

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { fileNumber: { contains: search, mode: 'insensitive' } },
      { buyerPONumber: { contains: search, mode: 'insensitive' } },
      { items: { some: { companySKU: { contains: search, mode: 'insensitive' } } } },
      { items: { some: { buyerSKU: { contains: search, mode: 'insensitive' } } } },
    ];
  }

  if (country) {
    where.customer = { country };
  }

  const take = parseInt(limit, 10);
  const skip = (parseInt(page, 10) - 1) * take;
  const orderBy = { [sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy,
      skip,
      take,
      include: {
        customer: { select: { id: true, companyName: true, country: true, fileNumber: true, agent: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  paginatedResponse(
    res,
    orders.map(shape),
    buildPagination(total, page, limit),
    'Orders fetched successfully'
  );
};

// ─── @GET /api/v1/orders/:id ─────────────────────────────────────────────────
exports.getOrder = async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      createdBy: { select: { id: true, fullName: true, email: true } },
      items: { orderBy: { sortOrder: 'asc' } },
    },
  });
  if (!order) throw new AppError('Order not found', 404);
  successResponse(res, { order: shape(order) });
};

// ─── @POST /api/v1/orders ────────────────────────────────────────────────────
exports.createOrder = async (req, res) => {
  const { fileNumber, customer: customerId, customerId: explicitCustomerId, items, ...orderData } = req.body;

  // Resolve the customer either by id or by fileNumber.
  let customer = null;
  const cid = Number(explicitCustomerId ?? customerId);
  if (Number.isFinite(cid)) {
    customer = await prisma.customer.findUnique({ where: { id: cid } });
  } else if (fileNumber) {
    customer = await prisma.customer.findUnique({ where: { fileNumber } });
  }
  if (!customer) throw new AppError('Customer not found. Please select a valid customer.', 404);

  // Duplicate Buyer PO check
  if (orderData.buyerPONumber) {
    const duplicate = await prisma.order.findFirst({
      where: {
        customerId: customer.id,
        buyerPONumber: orderData.buyerPONumber,
        orderStatus: { not: 'CANCELLED' },
      },
    });
    if (duplicate) {
      throw new AppError(
        `Warning: Buyer PO Number "${orderData.buyerPONumber}" already exists for this customer (Order: ${duplicate.orderNumber}). Use a different PO number or proceed intentionally.`,
        409
      );
    }
  }

  const orderNumber = await generateOrderNumber();
  const proformaInvoiceNumber = await generatePINumber();

  const data = {
    ...orderData,
    orderNumber,
    proformaInvoiceNumber,
    customerId: customer.id,
    fileNumber: customer.fileNumber,
    currency: orderData.currency || customer.currency || 'USD',
    orderStatus: toDbOrderStatus(orderData.orderStatus || 'Draft'),
    orderType: toDbOrderType(orderData.orderType || 'Regular Order'),
    orderDate: orderData.orderDate ? new Date(orderData.orderDate) : new Date(),
    expectedDeliveryDate: orderData.expectedDeliveryDate ? new Date(orderData.expectedDeliveryDate) : null,
    createdById: req.user.id,
  };
  // Strip fields the schema doesn't have
  delete data.lastModifiedBy;
  delete data.finalizedBy;
  delete data.cancelledBy;
  delete data.revisionHistory;
  delete data.revisionNumber;
  delete data.changeNote;

  if (Array.isArray(items) && items.length > 0) {
    data.items = { create: items.map(itemDataForWrite) };
  }

  const order = await prisma.order.create({
    data,
    include: {
      customer: { select: { id: true, companyName: true, country: true, fileNumber: true } },
      createdBy: { select: { id: true, fullName: true } },
      items: true,
    },
  });

  createdResponse(res, { order: shape(order) }, 'Order created successfully');
};

// ─── @PUT /api/v1/orders/:id ─────────────────────────────────────────────────
exports.updateOrder = async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw new AppError('Order not found', 404);
  if (existing.orderStatus === 'CANCELLED') {
    throw new AppError('Cannot edit a cancelled order.', 400);
  }

  // Strip immutable + unknown fields.
  const {
    orderNumber: _on, fileNumber: _fn, customer: _c, customerId: _cid,
    createdBy: _cb, createdById: _cbi, proformaInvoiceNumber: _pi,
    lastModifiedBy: _lmb, finalizedBy: _fb, cancelledBy: _cancB,
    revisionHistory: _rh, revisionNumber: _rn, changeNote: _chn,
    items, ...rest
  } = req.body;

  const data = { ...rest };
  if (rest.orderStatus) data.orderStatus = toDbOrderStatus(rest.orderStatus);
  if (rest.orderType) data.orderType = toDbOrderType(rest.orderType);
  if (rest.orderDate) data.orderDate = new Date(rest.orderDate);
  if (rest.expectedDeliveryDate) data.expectedDeliveryDate = new Date(rest.expectedDeliveryDate);

  // Items: full replace. Frontend always sends the complete items array.
  if (Array.isArray(items)) {
    data.items = {
      deleteMany: {},
      create: items.map(itemDataForWrite),
    };
  }

  const updated = await prisma.order.update({
    where: { id },
    data,
    include: {
      customer: { select: { id: true, companyName: true, country: true, fileNumber: true } },
      createdBy: { select: { id: true, fullName: true } },
      items: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (updated.orderStatus !== 'DRAFT') {
    try { await syncBuyerCatalogue(updated, req.user); }
    catch (err) { console.error('Error syncing buyer catalogue during update:', err); }
  }

  successResponse(res, { order: shape(updated) }, 'Order updated successfully');
};

// ─── @PATCH /api/v1/orders/:id/finalize ─────────────────────────────────────
exports.finalizeOrder = async (req, res) => {
  const id = Number(req.params.id);
  const { advanceReceived, advanceAmount } = req.body;

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw new AppError('Order not found', 404);
  if (existing.orderStatus !== 'DRAFT') {
    throw new AppError('Only Draft orders can be finalized.', 400);
  }

  const data = {
    orderStatus: 'FINALIZED',
    finalizedAt: new Date(),
  };

  if (advanceReceived && Number(advanceAmount) > 0) {
    data.advanceReceived = true;
    data.advanceAmount = Number(advanceAmount);
    data.advanceReceivedAt = new Date();
  }

  const updated = await prisma.order.update({
    where: { id },
    data,
    include: {
      customer: true,
      items: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (advanceReceived && Number(advanceAmount) > 0) {
    // Append to the customer's advancePayments JSON array.
    const customer = await prisma.customer.findUnique({ where: { id: updated.customerId } });
    const advances = Array.isArray(customer?.advancePayments) ? [...customer.advancePayments] : [];
    advances.push({
      orderId: updated.id,
      orderNumber: updated.orderNumber,
      amount: Number(advanceAmount),
      date: new Date().toISOString(),
      notes: `Advance for order ${updated.orderNumber}`,
    });
    await prisma.customer.update({ where: { id: updated.customerId }, data: { advancePayments: advances } });
  }

  try { await syncBuyerCatalogue(updated, req.user); }
  catch (err) { console.error('Error syncing buyer catalogue during finalize:', err); }

  successResponse(res, { order: shape(updated) }, 'Order finalized successfully');
};

// ─── @PATCH /api/v1/orders/:id/start-processing ─────────────────────────────
exports.startProcessing = async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw new AppError('Order not found', 404);
  if (existing.orderStatus !== 'FINALIZED') {
    throw new AppError('Only Finalized orders can start processing.', 400);
  }
  const updated = await prisma.order.update({
    where: { id },
    data: { orderStatus: 'PENDING' },
    include: { customer: true, items: { orderBy: { sortOrder: 'asc' } } },
  });
  successResponse(res, { order: shape(updated) }, 'Order processing started');
};

// ─── @PATCH /api/v1/orders/:id/status ───────────────────────────────────────
const STATUS_ORDER = [
  'DRAFT', 'FINALIZED', 'PENDING', 'IN_PRODUCTION', 'QC',
  'POLISH', 'PACKAGING', 'READY_TO_SHIP', 'SHIPPED', 'COMPLETED',
];

exports.updateOrderStatus = async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  const dbStatus = toDbOrderStatus(status);

  const VALID = new Set([
    'PENDING', 'IN_PRODUCTION', 'QC', 'POLISH',
    'PACKAGING', 'READY_TO_SHIP', 'SHIPPED', 'COMPLETED', 'CANCELLED',
  ]);
  if (!VALID.has(dbStatus)) throw new AppError(`Invalid status: ${status}`, 400);

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw new AppError('Order not found', 404);

  const isAdmin = req.user?.role === 'ADMIN';

  if (existing.orderStatus === 'CANCELLED' && !isAdmin) {
    throw new AppError('Cannot change status of a cancelled order.', 400);
  }
  if (existing.orderStatus === 'COMPLETED' && !isAdmin) {
    throw new AppError('Cannot change status of a completed order.', 400);
  }

  if (!isAdmin) {
    const currentIdx = STATUS_ORDER.indexOf(existing.orderStatus);
    const targetIdx = STATUS_ORDER.indexOf(dbStatus);
    if (currentIdx >= 0 && targetIdx >= 0 && targetIdx <= currentIdx) {
      throw new AppError(
        `Cannot move order backward from "${toFrontendOrderStatus(existing.orderStatus)}" to "${status}". Only an Admin can reverse status.`,
        403
      );
    }
  }

  const updated = await prisma.order.update({
    where: { id },
    data: { orderStatus: dbStatus },
    include: { customer: true, items: { orderBy: { sortOrder: 'asc' } } },
  });
  successResponse(res, { order: shape(updated) }, `Order status updated to ${status}`);
};

// ─── @PATCH /api/v1/orders/:id/cancel ───────────────────────────────────────
exports.cancelOrder = async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body;
  if (!reason) throw new AppError('Cancellation reason is required', 400);

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw new AppError('Order not found', 404);
  if (existing.orderStatus === 'CANCELLED') {
    throw new AppError('Order is already cancelled.', 400);
  }

  const updated = await prisma.order.update({
    where: { id },
    data: {
      orderStatus: 'CANCELLED',
      cancellationReason: reason,
      cancelledAt: new Date(),
      cancelledById: req.user.id,
    },
    include: { customer: true, items: { orderBy: { sortOrder: 'asc' } } },
  });
  successResponse(res, { order: shape(updated) }, 'Order cancelled successfully');
};

// ─── @POST /api/v1/orders/:id/comments ──────────────────────────────────────
exports.addComment = async (req, res) => {
  const id = Number(req.params.id);
  const { text } = req.body;

  let images = [];
  if (req.files && req.files.length > 0) {
    images = await uploadFilesToGitHub(req.files, 'doc', 'documents');
  }
  if (!text && images.length === 0) {
    throw new AppError('Comment must have text or images', 400);
  }

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw new AppError('Order not found', 404);

  const comments = Array.isArray(existing.comments) ? [...existing.comments] : [];
  comments.push({
    text,
    images,
    createdBy: req.user.id,
    createdByName: req.user.fullName,
    createdAt: new Date().toISOString(),
  });

  await prisma.order.update({ where: { id }, data: { comments } });
  successResponse(res, { comments }, 'Comment added');
};

// ─── @POST /api/v1/orders/upload-media ──────────────────────────────────────
exports.uploadMedia = async (req, res) => {
  if (!req.files || req.files.length === 0) throw new AppError('No files uploaded', 400);
  const urls = await uploadFilesToGitHub(req.files, 'img', 'images');
  successResponse(res, { urls }, 'Media uploaded');
};

// ─── @POST /api/v1/orders/rename-media ──────────────────────────────────────
exports.renameMediaToSku = async (req, res) => {
  const { urls = [], sku = '' } = req.body || {};
  const safeSku = String(sku || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safeSku) throw new AppError('A non-empty SKU is required', 400);
  if (!Array.isArray(urls) || urls.length === 0) {
    return successResponse(res, { mapping: {}, renamed: 0, skipped: 0 }, 'Nothing to rename');
  }

  const STRUCTURED = /_(Pro|Bar|Cmt)(-\d+)?$/i;
  const mapping = {};
  let renamed = 0, skipped = 0;

  for (const url of urls) {
    if (!url || typeof url !== 'string') { skipped++; continue; }
    const filename = url.split('/').pop().split('?')[0];
    const dot = filename.lastIndexOf('.');
    const base = dot > -1 ? filename.slice(0, dot) : filename;
    const ext = dot > -1 ? filename.slice(dot) : '';

    const match = base.match(STRUCTURED);
    if (!match) { mapping[url] = url; skipped++; continue; }

    const role = match[1];
    const index = match[2] || '';
    const newBase = `${safeSku}_${role}${index}`;
    if (newBase === base) { mapping[url] = url; skipped++; continue; }

    const newName = `${newBase}${ext}`;
    const newUrl = await renameOnGitHub(url, newName, 'images');
    if (newUrl) { mapping[url] = newUrl; renamed++; }
    else { mapping[url] = url; skipped++; }
  }

  successResponse(res, { mapping, renamed, skipped }, 'Rename complete');
};

// ─── @POST /api/v1/orders/:id/images ────────────────────────────────────────
exports.uploadOrderImages = async (req, res) => {
  if (!req.files || req.files.length === 0) throw new AppError('No files uploaded', 400);
  const id = Number(req.params.id);
  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw new AppError('Order not found', 404);

  const urls = await uploadFilesToGitHub(req.files, 'doc', 'documents');
  const orderImages = [...(existing.orderImages || []), ...urls];
  await prisma.order.update({ where: { id }, data: { orderImages } });
  successResponse(res, { orderImages }, 'Images uploaded');
};

// ─── @POST /api/v1/orders/:id/attachments ───────────────────────────────────
exports.uploadAttachment = async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400);
  const id = Number(req.params.id);
  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) throw new AppError('Order not found', 404);

  const filename = uniqueName('doc', req.file.originalname);
  const fileUrl = await uploadToGitHub(req.file.buffer, filename, 'documents');

  const attachment = {
    fileName: req.file.originalname,
    filePath: fileUrl,
    fileType: req.file.mimetype,
    uploadedAt: new Date().toISOString(),
  };

  const attachments = [...(existing.attachments || []), attachment];
  await prisma.order.update({ where: { id }, data: { attachments } });
  successResponse(res, { attachment }, 'File uploaded successfully');
};

// ─── @GET /api/v1/orders/stats/dashboard ────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const nonCancelled = { orderStatus: { not: 'CANCELLED' } };

  const [
    totalOrders,
    ordersThisMonth,
    statusGroups,
    topCustomersAgg,
    recentOrders,
    revenueGroups,
  ] = await Promise.all([
    prisma.order.count({ where: nonCancelled }),
    prisma.order.count({ where: { ...nonCancelled, createdAt: { gte: startOfMonth } } }),
    prisma.order.groupBy({
      by: ['orderStatus'],
      where: nonCancelled,
      _count: { _all: true },
      orderBy: { _count: { orderStatus: 'desc' } },
    }),
    prisma.order.groupBy({
      by: ['customerId'],
      where: { ...nonCancelled, createdAt: { gte: startOfYear } },
      _count: { _all: true },
      _sum: { finalAmount: true },
      orderBy: { _sum: { finalAmount: 'desc' } },
      take: 5,
    }),
    prisma.order.findMany({
      where: nonCancelled,
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        customer: { select: { id: true, companyName: true, country: true, fileNumber: true } },
      },
    }),
    prisma.order.groupBy({
      by: ['currency'],
      where: { ...nonCancelled, createdAt: { gte: startOfYear } },
      _sum: { finalAmount: true },
    }),
  ]);

  // Translate enum keys back to frontend strings.
  const ordersByStatus = statusGroups.map((g) => ({
    _id: toFrontendOrderStatus(g.orderStatus),
    count: g._count._all,
  }));

  // Hydrate customer info for the top-customers list.
  const topCustomerIds = topCustomersAgg.map((c) => c.customerId).filter(Boolean);
  const customers = topCustomerIds.length
    ? await prisma.customer.findMany({
        where: { id: { in: topCustomerIds } },
        select: { id: true, companyName: true, fileNumber: true, country: true },
      })
    : [];
  const cMap = Object.fromEntries(customers.map((c) => [c.id, c]));
  const topCustomers = topCustomersAgg.map((c) => ({
    _id: c.customerId,
    companyName: cMap[c.customerId]?.companyName,
    fileNumber: cMap[c.customerId]?.fileNumber,
    country: cMap[c.customerId]?.country,
    totalOrders: c._count._all,
    totalValue: Number(c._sum.finalAmount || 0),
  }));

  const totalRevenue = revenueGroups.map((g) => ({
    _id: g.currency,
    total: Number(g._sum.finalAmount || 0),
  }));

  successResponse(res, {
    totalOrders,
    ordersThisMonth,
    ordersByStatus,
    topCustomers,
    recentOrders: recentOrders.map(shape),
    totalRevenue,
  });
};

// ─── @GET /api/v1/orders/export ─────────────────────────────────────────────
exports.exportOrders = async (req, res) => {
  const { ids, status } = req.query;
  const where = {};
  if (ids) where.id = { in: ids.split(',').map((s) => Number(s)).filter(Number.isFinite) };
  if (status) where.orderStatus = toDbOrderStatus(status);

  const orders = await prisma.order.findMany({
    where,
    include: {
      customer: { select: { id: true, companyName: true, country: true, fileNumber: true } },
      items: { orderBy: { sortOrder: 'asc' } },
    },
  });
  successResponse(res, { orders: orders.map(shape), count: orders.length }, 'Orders exported');
};

// ─── @DELETE /api/v1/orders/:id/media ───────────────────────────────────────
exports.deleteOrderMedia = async (req, res) => {
  const id = Number(req.params.id);
  const { filePath } = req.body;
  if (!filePath) throw new AppError('File path is required', 400);

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) throw new AppError('Order not found', 404);

  const isMatch = (p) => p === filePath;
  let updated = false;
  const data = {};

  // Order-level images / attachments / comments.
  const orderImages = Array.isArray(order.orderImages) ? order.orderImages : [];
  if (orderImages.some(isMatch)) {
    data.orderImages = orderImages.filter((p) => !isMatch(p));
    updated = true;
  }
  const attachments = Array.isArray(order.attachments) ? order.attachments : [];
  if (attachments.some((a) => isMatch(a.filePath))) {
    data.attachments = attachments.filter((a) => !isMatch(a.filePath));
    updated = true;
  }
  const comments = Array.isArray(order.comments) ? order.comments : [];
  let commentsChanged = false;
  const newComments = comments.map((c) => {
    if (Array.isArray(c.images) && c.images.some(isMatch)) {
      commentsChanged = true;
      return { ...c, images: c.images.filter((p) => !isMatch(p)) };
    }
    return c;
  });
  if (commentsChanged) {
    data.comments = newComments;
    updated = true;
  }

  if (Object.keys(data).length > 0) {
    await prisma.order.update({ where: { id }, data });
  }

  // Per-item images / comments / barcode.image.
  for (const item of order.items) {
    const idata = {};
    const itemImages = Array.isArray(item.images) ? item.images : [];
    if (itemImages.some(isMatch)) {
      idata.images = itemImages.filter((p) => !isMatch(p));
      updated = true;
    }
    if (item.barcodeImage && isMatch(item.barcodeImage)) {
      idata.barcodeImage = null;
      updated = true;
    }
    const itemComments = Array.isArray(item.comments) ? item.comments : [];
    let itemCommentsChanged = false;
    const newItemComments = itemComments.map((c) => {
      if (Array.isArray(c.images) && c.images.some(isMatch)) {
        itemCommentsChanged = true;
        return { ...c, images: c.images.filter((p) => !isMatch(p)) };
      }
      return c;
    });
    if (itemCommentsChanged) {
      idata.comments = newItemComments;
      updated = true;
    }
    if (Object.keys(idata).length > 0) {
      await prisma.orderItem.update({ where: { id: item.id }, data: idata });
    }
  }

  // Propagate to the BuyerCatalogue for non-Draft orders.
  if (updated && order.orderStatus !== 'DRAFT') {
    const fresh = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    try { await syncBuyerCatalogue(fresh, req.user); }
    catch (err) { console.error('Error syncing buyer catalogue after deleteOrderMedia:', err); }
  }

  // Async — fire-and-forget the actual GitHub delete.
  if (isGitHubUrl(filePath)) {
    deleteFromGitHub(filePath).catch((err) =>
      console.error('GitHub delete error:', err.message)
    );
  }

  successResponse(res, null, 'Media deleted successfully');
};

// ─── @DELETE /api/v1/orders/:id ─────────────────────────────────────────────
exports.deleteOrder = async (req, res) => {
  const id = Number(req.params.id);
  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  });
  if (!order) throw new AppError('Order not found', 404);

  // Collect file paths to clean up on GitHub side (fire-and-forget).
  const filePaths = new Set();
  for (const p of order.orderImages || []) filePaths.add(p);
  for (const att of order.attachments || []) filePaths.add(att.filePath);
  for (const c of order.comments || []) for (const p of c.images || []) filePaths.add(p);
  for (const item of order.items) {
    for (const p of item.images || []) filePaths.add(p);
    if (item.barcodeImage) filePaths.add(item.barcodeImage);
    for (const c of item.comments || []) for (const p of c.images || []) filePaths.add(p);
  }

  // OrderItem has onDelete: Cascade, so deleting the order cascades to items.
  await prisma.order.delete({ where: { id } });

  for (const fileUrl of filePaths) {
    if (fileUrl && isGitHubUrl(fileUrl)) {
      deleteFromGitHub(fileUrl).catch((err) =>
        console.error(`GitHub delete error for ${fileUrl}:`, err.message)
      );
    }
  }

  successResponse(res, null, 'Order and associated media deleted successfully');
};

// ─── @PATCH /api/v1/orders/:id/items/:itemId/primary-image ───────────────────
exports.setPrimaryImage = async (req, res) => {
  const orderId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { imagePath } = req.body;

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new AppError('Order not found', 404);

  const item = await prisma.orderItem.findFirst({ where: { id: itemId, orderId } });
  if (!item) throw new AppError('Item not found', 404);

  await prisma.orderItem.update({ where: { id: itemId }, data: { primaryImage: imagePath } });

  if (order.orderStatus !== 'DRAFT') {
    const fresh = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    try { await syncBuyerCatalogue(fresh, req.user); }
    catch (err) { console.error('Error syncing buyer catalogue after setPrimaryImage:', err); }
  }

  successResponse(res, { primaryImage: imagePath }, 'Primary image updated successfully');
};
