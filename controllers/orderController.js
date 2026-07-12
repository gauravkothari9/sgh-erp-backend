const Order = require('../models/Order');
const Customer = require('../models/Customer');
const User = require('../models/User');
const path = require('path');
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
  BOARD_COLUMNS,
  BRANCHES,
  CATEGORIES,
  SOURCING,
  MAKERS,
  LOCATIONS,
  PRODUCTION_TYPES,
  STAGE,
  STAGE_LOCATION,
  getPath,
  deriveType,
  isBranch,
  isCategory,
  isSourcing,
  isMaker,
} = require('../config/production');
const Notification = require('../models/Notification');
const { notify } = require('../utils/notify');

// ─── Helper: generate a unique filename from a multer memory file ───────────
// Structured client names from Create Order — anything matching `_Pro`,
// `_Bar`, or `_Cmt` — are taken as-is so the asset on GitHub matches the
// SKU-based name the user expects (e.g. JD-4421_Pro-1.jpg, JD-4421_Bar.jpg).
// If a duplicate already exists in the GitHub folder, the underlying
// uploader updates it via SHA (overwrite is intentional for these).
//
// Everything else falls back to the legacy `<prefix>-<stamp>` scheme so
// unrelated uploads (documents, photos without a SKU) stay collision-safe.
const STRUCTURED_NAME = /_(Pro|Bar|Cmt)(-\d+)?$/i;

const uniqueName = (prefix, originalname) => {
  const ext = path.extname(originalname);
  const baseRaw = path.basename(originalname, ext);
  const base = (baseRaw || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (base && STRUCTURED_NAME.test(base)) {
    return `${base}${ext}`;
  }

  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return base ? `${base}-${stamp}${ext}` : `${prefix}-${stamp}${ext}`;
};

// ─── Helper: Upload multer memory files to GitHub ───────────────────────────
const uploadFilesToGitHub = async (files, prefix, folder) => {
  const items = files.map((f) => ({
    buffer: f.buffer,
    filename: uniqueName(prefix, f.originalname),
  }));
  return uploadMultipleToGitHub(items, folder);
};

// ─── @GET /api/v1/orders ─────────────────────────────────────────────────────
exports.getOrders = async (req, res, next) => {
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

  const filter = {};

  if (status) {
    const statuses = status.split(',');
    filter.orderStatus = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }
  if (orderType) filter.orderType = orderType;
  if (containerSize) filter.containerSize = containerSize;
  if (fileNumber) filter.fileNumber = fileNumber;

  if (dateFrom || dateTo) {
    filter.orderDate = {};
    if (dateFrom) filter.orderDate.$gte = new Date(dateFrom);
    if (dateTo) filter.orderDate.$lte = new Date(dateTo);
  }

  if (search) {
    filter.$or = [
      { orderNumber: { $regex: search, $options: 'i' } },
      { fileNumber: { $regex: search, $options: 'i' } },
      { buyerPONumber: { $regex: search, $options: 'i' } },
      { 'items.companySKU': { $regex: search, $options: 'i' } },
      { 'items.buyerSKU': { $regex: search, $options: 'i' } },
    ];
  }

  if (country) {
    const customerIds = await Customer.find({ country }, { _id: 1 }).lean();
    filter.customer = { $in: customerIds.map((c) => c._id) };
  }

  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .populate('customer', 'companyName country fileNumber agent')
      .populate('createdBy', 'fullName')
      .select('-revisionHistory -__v')
      .lean(),
    Order.countDocuments(filter),
  ]);

  paginatedResponse(
    res,
    orders,
    buildPagination(total, page, limit),
    'Orders fetched successfully'
  );
};

// ─── @GET /api/v1/orders/:id ─────────────────────────────────────────────────
exports.getOrder = async (req, res, next) => {
  const order = await Order.findById(req.params.id)
    .populate('customer', 'companyName country fileNumber emails phones currency agent priceType')
    .populate('createdBy', 'fullName email')
    .populate('lastModifiedBy', 'fullName')
    .populate('finalizedBy', 'fullName')
    .populate('cancelledBy', 'fullName')
    .populate('revisionHistory.editedBy', 'fullName')
    .populate('comments.createdBy', 'fullName')
    .select('-__v');

  if (!order) throw new AppError('Order not found', 404);
  successResponse(res, { order });
};

// ─── @POST /api/v1/orders ────────────────────────────────────────────────────
exports.createOrder = async (req, res, next) => {
  const { fileNumber, customer: customerId, ...orderData } = req.body;

  let customer;
  if (customerId) {
    customer = await Customer.findById(customerId);
  } else if (fileNumber) {
    customer = await Customer.findOne({ fileNumber });
  }

  if (!customer) throw new AppError('Customer not found. Please select a valid customer.', 404);

  // Duplicate Buyer PO check
  if (orderData.buyerPONumber) {
    const duplicate = await Order.findOne({
      customer: customer._id,
      buyerPONumber: orderData.buyerPONumber,
      orderStatus: { $ne: 'Cancelled' },
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

  const order = await Order.create({
    ...orderData,
    orderNumber,
    proformaInvoiceNumber,
    customer: customer._id,
    fileNumber: customer.fileNumber,
    currency: orderData.currency || customer.currency || 'USD',
    createdBy: req.user._id,
    lastModifiedBy: req.user._id,
  });

  await order.save();

  const populated = await Order.findById(order._id)
    .populate('customer', 'companyName country fileNumber')
    .populate('createdBy', 'fullName');

  createdResponse(res, { order: populated }, 'Order created successfully');
};

// ─── @PUT /api/v1/orders/:id ─────────────────────────────────────────────────
exports.updateOrder = async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  if (order.orderStatus === 'Cancelled') {
    throw new AppError('Cannot edit a cancelled order.', 400);
  }

  // Strip immutable fields
  delete req.body.orderNumber;
  delete req.body.fileNumber;
  delete req.body.customer;
  delete req.body.createdBy;
  delete req.body.proformaInvoiceNumber;

  const wasFinalised = !['Draft'].includes(order.orderStatus);
  const snapshot = order.toObject();

  if (wasFinalised) {
    order.revisionNumber = (order.revisionNumber || 0) + 1;
    order.revisionHistory.push({
      revisionNumber: order.revisionNumber,
      editedBy: req.user._id,
      snapshot,
      changeNote: req.body.changeNote || `Revision ${order.revisionNumber}`,
    });
  }

  Object.assign(order, req.body, { lastModifiedBy: req.user._id });
  delete order._doc?.changeNote;

  await order.save();

  // Sync products to Buyer Catalogue for any non-Draft order.
  if (order.orderStatus !== 'Draft') {
    try {
      await syncBuyerCatalogue(order, req.user);
    } catch (error) {
      console.error('Error syncing buyer catalogue during update:', error);
    }
  }

  const populated = await Order.findById(order._id)
    .populate('customer', 'companyName country fileNumber')
    .populate('createdBy', 'fullName')
    .populate('lastModifiedBy', 'fullName');

  successResponse(res, { order: populated }, 'Order updated successfully');
};

// ─── @PATCH /api/v1/orders/:id/finalize ─────────────────────────────────────
exports.finalizeOrder = async (req, res, next) => {
  const { advanceReceived, advanceAmount } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  if (order.orderStatus !== 'Draft') {
    throw new AppError('Only Draft orders can be finalized.', 400);
  }

  order.orderStatus = 'Finalized';
  order.finalizedAt = new Date();
  order.finalizedBy = req.user._id;
  order.lastModifiedBy = req.user._id;

  // Save advance payment info
  if (advanceReceived && advanceAmount > 0) {
    order.advanceReceived = true;
    order.advanceAmount = advanceAmount;
    order.advanceReceivedAt = new Date();

    // Also save to customer record
    await Customer.findByIdAndUpdate(order.customer, {
      $push: {
        advancePayments: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          amount: advanceAmount,
          date: new Date(),
          notes: `Advance for order ${order.orderNumber}`,
        },
      },
    });
  }

  await order.save();

  // Sync products to Buyer Catalogue
  try {
    await syncBuyerCatalogue(order, req.user);
  } catch (error) {
    console.error('Error syncing buyer catalogue during finalize:', error);
  }

  await notify(['orders'], {
    type: 'order-finalized',
    title: 'Order finalized',
    message: `${order.orderNumber} (file ${order.fileNumber}) was finalized and is ready to start processing.`,
    fileNumber: order.fileNumber,
    orderId: order._id,
    link: `/office/orders/${order._id}`,
  }, { exclude: req.user._id });

  successResponse(res, { order }, 'Order finalized successfully');
};

// ─── @PATCH /api/v1/orders/:id/start-processing ─────────────────────────────
exports.startProcessing = async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  if (order.orderStatus !== 'Finalized') {
    throw new AppError('Only Finalized orders can start processing.', 400);
  }

  order.orderStatus = 'Pending';
  order.lastModifiedBy = req.user._id;
  await order.save();

  await notify(['production', 'orders'], {
    type: 'order-processing',
    title: 'Order entered production',
    message: `${order.orderNumber} (file ${order.fileNumber}) is ready to be routed to stages.`,
    fileNumber: order.fileNumber,
    orderId: order._id,
    link: `/factory/production`,
  }, { exclude: req.user._id });

  successResponse(res, { order }, 'Order processing started');
};

// ─── @PATCH /api/v1/orders/:id/status ───────────────────────────────────────
exports.updateOrderStatus = async (req, res, next) => {
  const { status } = req.body;

  const validStatuses = [
    'Pending', 'In Production', 'QC', 'Polish',
    'Packaging', 'Ready to Ship', 'Shipped', 'Completed', 'Cancelled',
  ];

  if (!validStatuses.includes(status)) {
    throw new AppError(`Invalid status: ${status}`, 400);
  }

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  const isAdmin = req.user?.role === 'Admin';

  // Terminal states are only reversible by Admin.
  if (order.orderStatus === 'Cancelled' && !isAdmin) {
    throw new AppError('Cannot change status of a cancelled order.', 400);
  }
  if (order.orderStatus === 'Completed' && !isAdmin) {
    throw new AppError('Cannot change status of a completed order.', 400);
  }

  // Forward-only enforcement
  const STATUS_ORDER = [
    'Draft', 'Finalized', 'Pending', 'In Production', 'QC',
    'Polish', 'Packaging', 'Ready to Ship', 'Shipped', 'Completed',
  ];
  if (!isAdmin) {
    const currentIdx = STATUS_ORDER.indexOf(order.orderStatus);
    const targetIdx = STATUS_ORDER.indexOf(status);
    if (currentIdx >= 0 && targetIdx >= 0 && targetIdx <= currentIdx) {
      throw new AppError(
        `Cannot move order backward from "${order.orderStatus}" to "${status}". Only an Admin can reverse status.`,
        403
      );
    }
  }

  const previousStatus = order.orderStatus;
  order.orderStatus = status;
  order.lastModifiedBy = req.user._id;

  await order.save();

  await notify(['orders'], {
    type: 'order-status',
    title: `Order ${status}`,
    message: `${order.orderNumber} moved from ${previousStatus} to ${status}.`,
    fileNumber: order.fileNumber,
    orderId: order._id,
    link: `/office/orders/${order._id}`,
  }, { exclude: req.user._id });

  successResponse(res, { order }, `Order status updated to ${status}`);
};

// ─── @PATCH /api/v1/orders/:id/cancel ───────────────────────────────────────
exports.cancelOrder = async (req, res, next) => {
  const { reason } = req.body;
  if (!reason) throw new AppError('Cancellation reason is required', 400);

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  if (order.orderStatus === 'Cancelled') {
    throw new AppError('Order is already cancelled.', 400);
  }

  const previousStatus = order.orderStatus;
  order.orderStatus = 'Cancelled';
  order.cancellationReason = reason;
  order.cancelledAt = new Date();
  order.cancelledBy = req.user._id;
  order.lastModifiedBy = req.user._id;
  await order.save();

  await notify(['orders', 'production'], {
    type: 'order-cancelled',
    title: 'Order cancelled',
    message: `${order.orderNumber} was cancelled (was ${previousStatus}). Reason: ${reason}`,
    fileNumber: order.fileNumber,
    orderId: order._id,
    link: `/office/orders/${order._id}`,
  }, { exclude: req.user._id });

  successResponse(res, { order }, 'Order cancelled successfully');
};

// ─── @POST /api/v1/orders/:id/comments ──────────────────────────────────────
exports.addComment = async (req, res, next) => {
  const { text } = req.body;

  // Upload comment images to GitHub
  let images = [];
  if (req.files && req.files.length > 0) {
    images = await uploadFilesToGitHub(req.files, 'doc', 'documents');
  }

  if (!text && images.length === 0) {
    throw new AppError('Comment must have text or images', 400);
  }

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  order.comments.push({
    text,
    images,
    createdBy: req.user._id,
    createdByName: req.user.fullName,
  });
  order.lastModifiedBy = req.user._id;

  await order.save();

  successResponse(res, { comments: order.comments }, 'Comment added');
};

// ─── @POST /api/v1/orders/upload-media ──────────────────────────────────────
exports.uploadMedia = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }

  // Upload to GitHub images folder
  const urls = await uploadFilesToGitHub(req.files, 'img', 'images');

  successResponse(res, { urls }, 'Media uploaded');
};

// ─── @POST /api/v1/orders/rename-media ──────────────────────────────────────
// Bulk-rename a set of media URLs to a new SKU prefix. The endpoint walks
// each URL, looks for the structured `_(Pro|Bar|Cmt)(-N)?` suffix from the
// upload renamer, and rewrites the file under `<newSku>_<suffix>.<ext>`.
//
// URLs that don't carry the structured suffix are returned unchanged — this
// keeps the catalogue autofill case safe (those URLs use their original
// filenames). The response is a mapping the client uses to swap URLs in its
// local item state.
exports.renameMediaToSku = async (req, res) => {
  const { urls = [], sku = '' } = req.body || {};

  const safeSku = String(sku || '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!safeSku) throw new AppError('A non-empty SKU is required', 400);
  if (!Array.isArray(urls) || urls.length === 0) {
    successResponse(res, { mapping: {}, renamed: 0, skipped: 0 }, 'Nothing to rename');
    return;
  }

  // Matches our client-side rename pattern. Captured group 1 is the role
  // tag (Pro/Bar/Cmt) and group 2 is the optional `-N` index.
  const STRUCTURED = /_(Pro|Bar|Cmt)(-\d+)?$/i;

  const mapping = {};
  let renamed = 0;
  let skipped = 0;

  for (const url of urls) {
    if (!url || typeof url !== 'string') { skipped++; continue; }
    const filename = url.split('/').pop().split('?')[0];
    const dot = filename.lastIndexOf('.');
    const base = dot > -1 ? filename.slice(0, dot) : filename;
    const ext = dot > -1 ? filename.slice(dot) : '';

    const match = base.match(STRUCTURED);
    if (!match) {
      mapping[url] = url;
      skipped++;
      continue;
    }

    const role = match[1];          // Pro / Bar / Cmt
    const index = match[2] || '';   // "-N" or ""
    const newBase = `${safeSku}_${role}${index}`;
    if (newBase === base) {
      mapping[url] = url;
      skipped++;
      continue;
    }

    const newName = `${newBase}${ext}`;
    const newUrl = await renameOnGitHub(url, newName, 'images');
    if (newUrl) {
      mapping[url] = newUrl;
      renamed++;
    } else {
      // Failed (file missing, legacy URL, etc.) — leave the original.
      mapping[url] = url;
      skipped++;
    }
  }

  successResponse(res, { mapping, renamed, skipped }, 'Rename complete');
};

// ─── @POST /api/v1/orders/:id/images ────────────────────────────────────────
exports.uploadOrderImages = async (req, res, next) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded', 400);
  }

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  // Upload to GitHub documents folder
  const urls = await uploadFilesToGitHub(req.files, 'doc', 'documents');
  order.orderImages.push(...urls);
  order.lastModifiedBy = req.user._id;

  await order.save();

  successResponse(res, { orderImages: order.orderImages }, 'Images uploaded');
};

// ─── @POST /api/v1/orders/:id/attachments ───────────────────────────────────
exports.uploadAttachment = async (req, res, next) => {
  if (!req.file) throw new AppError('No file uploaded', 400);

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  // Upload single file to GitHub
  const filename = uniqueName('doc', req.file.originalname);
  const fileUrl = await uploadToGitHub(req.file.buffer, filename, 'documents');

  const attachment = {
    fileName: req.file.originalname,
    filePath: fileUrl,
    fileType: req.file.mimetype,
    uploadedAt: new Date(),
  };

  order.attachments.push(attachment);
  order.lastModifiedBy = req.user._id;
  await order.save();

  successResponse(res, { attachment }, 'File uploaded successfully');
};


// ─── @GET /api/v1/orders/stats/dashboard ────────────────────────────────────
exports.getDashboardStats = async (req, res, next) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const [
    totalOrders,
    ordersThisMonth,
    ordersByStatus,
    topCustomers,
    recentOrders,
    totalRevenue,
  ] = await Promise.all([
    Order.countDocuments({ orderStatus: { $ne: 'Cancelled' } }),

    Order.countDocuments({
      createdAt: { $gte: startOfMonth },
      orderStatus: { $ne: 'Cancelled' },
    }),

    Order.aggregate([
      { $match: { orderStatus: { $ne: 'Cancelled' } } },
      { $group: { _id: '$orderStatus', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),

    Order.aggregate([
      { $match: { orderStatus: { $ne: 'Cancelled' }, createdAt: { $gte: startOfYear } } },
      {
        $group: {
          _id: '$customer',
          totalOrders: { $sum: 1 },
          totalValue: { $sum: '$finalAmount' },
        },
      },
      { $sort: { totalValue: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'customers',
          localField: '_id',
          foreignField: '_id',
          as: 'customerInfo',
        },
      },
      { $unwind: '$customerInfo' },
      {
        $project: {
          companyName: '$customerInfo.companyName',
          fileNumber: '$customerInfo.fileNumber',
          country: '$customerInfo.country',
          totalOrders: 1,
          totalValue: 1,
        },
      },
    ]),

    Order.find({ orderStatus: { $ne: 'Cancelled' } })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('customer', 'companyName country fileNumber')
      .select('orderNumber orderStatus finalAmount currency orderDate orderType fileNumber')
      .lean(),

    Order.aggregate([
      { $match: { orderStatus: { $ne: 'Cancelled' }, createdAt: { $gte: startOfYear } } },
      { $group: { _id: '$currency', total: { $sum: '$finalAmount' } } },
    ]),
  ]);

  successResponse(res, {
    totalOrders,
    ordersThisMonth,
    ordersByStatus,
    topCustomers,
    recentOrders,
    totalRevenue,
  });
};

// ─── @GET /api/v1/orders/export ─────────────────────────────────────────────
exports.exportOrders = async (req, res, next) => {
  const { ids, status } = req.query;

  const filter = {};
  if (ids) filter._id = { $in: ids.split(',') };
  if (status) filter.orderStatus = status;

  const orders = await Order.find(filter)
    .populate('customer', 'companyName country fileNumber')
    .select('-revisionHistory -attachments -internalNotes -__v')
    .lean();

  successResponse(res, { orders, count: orders.length }, 'Orders exported');
};

// ─── @DELETE /api/v1/orders/:id/media ───────────────────────────────────────
exports.deleteOrderMedia = async (req, res, next) => {
  const { filePath } = req.body;
  if (!filePath) throw new AppError('File path is required', 400);

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  try {
    // Clear references in DB
    let updated = false;
    const isMatch = (p) => p === filePath;

    // Order images
    if (order.orderImages.some(isMatch)) {
      order.orderImages = order.orderImages.filter(p => !isMatch(p));
      updated = true;
    }

    // Item images and barcodes
    order.items.forEach(item => {
      if (item.images.some(isMatch)) {
        item.images = item.images.filter(p => !isMatch(p));
        updated = true;
      }
      if (item.barcode?.image && isMatch(item.barcode.image)) {
        item.barcode.image = '';
        updated = true;
      }
      // Item comments
      item.comments.forEach(comment => {
        if (comment.images.some(isMatch)) {
          comment.images = comment.images.filter(p => !isMatch(p));
          updated = true;
        }
      });
    });

    // Order comments
    order.comments.forEach(comment => {
      if (comment.images.some(isMatch)) {
        comment.images = comment.images.filter(p => !isMatch(p));
        updated = true;
      }
    });

    // Attachments
    if (order.attachments.some(att => isMatch(att.filePath))) {
      order.attachments = order.attachments.filter(att => !isMatch(att.filePath));
      updated = true;
    }

    if (updated) {
      await order.save();

      // Propagate item-image deletions to the BuyerCatalogue
      if (order.orderStatus !== 'Draft') {
        try {
          await syncBuyerCatalogue(order, req.user);
        } catch (error) {
          console.error('Error syncing buyer catalogue after deleteOrderMedia:', error);
        }
      }
    }

    // Delete from GitHub (non-blocking — DB is already cleaned up)
    if (isGitHubUrl(filePath)) {
      deleteFromGitHub(filePath).catch((err) =>
        console.error('GitHub delete error:', err.message)
      );
    }

    successResponse(res, null, 'Media deleted successfully');
  } catch (err) {
    throw new AppError(`Failed to delete file: ${err.message}`, 500);
  }
};

// ─── @DELETE /api/v1/orders/:id ─────────────────────────────────────────────
exports.deleteOrder = async (req, res, next) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  // 1. Collect all file paths/URLs
  const filePaths = new Set();

  if (order.orderImages) order.orderImages.forEach(p => filePaths.add(p));
  order.items.forEach(item => {
    if (item.images) item.images.forEach(p => filePaths.add(p));
    if (item.barcode?.image) filePaths.add(item.barcode.image);
    item.comments.forEach(c => {
      if (c.images) c.images.forEach(p => filePaths.add(p));
    });
  });
  order.comments.forEach(c => {
    if (c.images) c.images.forEach(p => filePaths.add(p));
  });
  order.attachments.forEach(att => filePaths.add(att.filePath));

  // 2. Delete files from GitHub (non-blocking)
  filePaths.forEach(fileUrl => {
    if (fileUrl && isGitHubUrl(fileUrl)) {
      deleteFromGitHub(fileUrl).catch((err) =>
        console.error(`GitHub delete error for ${fileUrl}:`, err.message)
      );
    }
  });

  // 3. Delete order from DB
  await Order.findByIdAndDelete(req.params.id);

  successResponse(res, null, 'Order and associated media deleted successfully');
};

// ─── Factory Production Tracking ─────────────────────────────────────────────
// Orders whose items are live on the shop floor. Drafts aren't in production
// yet; Cancelled/Shipped/Completed are done — everything else is trackable.
const ACTIVE_ORDER_STATUSES = [
  'Finalized', 'Pending', 'In Production', 'QC', 'Polish', 'Packaging', 'Ready to Ship',
];

// Orders that have actually started processing (after "Start Processing", which
// moves a Finalized order to Pending). Only these show on the production floor /
// branch / stage views — Drafts and merely-Finalized orders don't.
const PROCESSING_STATUSES = [
  'Pending', 'In Production', 'QC', 'Polish', 'Packaging', 'Ready to Ship',
];

// Resolve an item's routing attributes, falling back to legacy fields so items
// routed before this feature (or via the old board) still resolve a path.
const resolveItemAttrs = (item) => {
  const p = item.production || {};
  const category = p.productionType || deriveType(item.itemCondition);
  const branch = p.branch || p.madeAt || (category === 'Antique' ? 'Kakani' : '');
  const sourcing = p.sourcing || 'In-house';
  return { branch, category, sourcing };
};

// The per-stage unit distribution for an item, with a legacy fallback: items
// routed before batch tracking (or via the old board) get their whole quantity
// placed at their currentStage.
const getStageQty = (item, path) => {
  const p = item.production || {};
  let sq = Array.isArray(p.stageQty)
    ? p.stageQty.filter((e) => e && e.qty > 0).map((e) => ({ stage: e.stage, qty: e.qty }))
    : [];
  if (sq.length === 0) {
    const stage = p.currentStage || (path && path[0]);
    if (stage) sq = [{ stage, qty: item.quantity || 1 }];
  }
  return sq;
};

// The earliest (furthest-back) occupied stage, by the path's order.
const earliestStage = (sq, path) => {
  let best = null;
  let bestIdx = Infinity;
  for (const e of sq) {
    const i = path.indexOf(e.stage);
    if (i >= 0 && i < bestIdx) { bestIdx = i; best = e.stage; }
  }
  return best;
};

// Units of an item at the Ready-for-Container stage.
const readyUnits = (item, path) =>
  (getStageQty(item, path).find((e) => e.stage === STAGE.READY) || {}).qty || 0;

// ─── @GET /api/v1/orders/production/config ───────────────────────────────────
// Static workflow metadata the board + branch views need. Cached by the client
// — this is the single source of truth mirrored from config/production.js.
exports.getProductionConfig = async (req, res) => {
  successResponse(res, {
    columns: BOARD_COLUMNS,
    branches: BRANCHES,
    categories: CATEGORIES,
    sourcing: SOURCING,
    makers: MAKERS,
    locations: LOCATIONS,
    productionTypes: PRODUCTION_TYPES,
    stages: STAGE,
    stageLocation: STAGE_LOCATION,
  });
};

// ─── @GET /api/v1/orders/production/board ────────────────────────────────────
// Flattens every item of every active order into a "card" with its resolved
// stage + location. This is the screen that replaces walking to each point.
// One endpoint powers the Kanban board AND every branch/stage view.
// Query: branch (Jhalamand|Kakani), category (Antique|Production),
//        sourcing (In-house|Outsourced), stage, location (…|In Transit),
//        needsSetup ('1'), search, fileNumber.
exports.getProductionBoard = async (req, res) => {
  const { location, search, fileNumber, branch, category, sourcing, stage, maker, needsSetup, group } = req.query;
  const byItem = group === 'item';   // one card per item (with full stage distribution)

  // Only orders that have STARTED processing appear here (after "Start
  // Processing" in the Office). Drafts and merely-Finalized orders are excluded.
  const filter = { orderStatus: { $in: PROCESSING_STATUSES } };
  if (fileNumber) filter.fileNumber = fileNumber;

  const orders = await Order.find(filter)
    .populate('customer', 'companyName fileNumber')
    .select('orderNumber fileNumber customer items orderDate expectedDeliveryDate')
    .lean();

  const cards = [];
  for (const order of orders) {
    for (const item of order.items || []) {
      const p = item.production || {};
      const attrs = resolveItemAttrs(item);
      const path = getPath(attrs);
      const totalQty = item.quantity || 0;
      // Shared fields for every card produced from this item.
      const baseCard = {
        orderId: order._id,
        orderNumber: order.orderNumber,
        fileNumber: order.fileNumber,
        customerName: order.customer?.companyName || '',
        expectedDeliveryDate: order.expectedDeliveryDate || null,
        itemId: item._id,
        companySKU: item.companySKU || '',
        buyerSKU: item.buyerSKU || '',
        itemDescription: item.itemDescription || '',
        totalQty,
        images: Array.isArray(item.images) ? item.images : [],
        image: item.primaryImage || (Array.isArray(item.images) ? item.images[0] : '') || '',
        comments: Array.isArray(item.comments) ? item.comments.map((c) => c.text).filter(Boolean).join(' | ') : '',
        madeAt: p.madeAt || '',
        maker: p.maker || '',
        outsource: p.outsource || {},
        productionType: attrs.category,
        running: !!p.running,
        priority: !!p.priority,
      };

      if (!path) {
        // Unrouted — a single "Needs Setup" card for the whole item.
        cards.push({
          ...baseCard, branch: '', sourcing: '', quantity: totalQty,
          currentStage: 'Needs Setup', currentLocation: '', nextStage: null,
          stageQty: [], needsSetup: true, completedAt: null,
        });
        continue;
      }

      const sq = getStageQty(item, path);
      // Full stage distribution, carried on EVERY card produced from this item
      // (so stage views can show the whole picture, not just units at that stage).
      const dist = sq.map((e) => {
        const i = path.indexOf(e.stage);
        return { stage: e.stage, qty: e.qty, nextStage: i >= 0 && i < path.length - 1 ? path[i + 1] : null };
      });

      if (byItem) {
        // One card for the whole item.
        const earliest = earliestStage(sq, path) || path[0];
        cards.push({
          ...baseCard, branch: attrs.branch, sourcing: attrs.sourcing,
          quantity: totalQty,
          currentStage: earliest,
          currentLocation: STAGE_LOCATION[earliest] || '',
          nextStage: null,
          stageQty: dist,
          needsSetup: false,
          completedAt: p.completedAt || null,
        });
        continue;
      }

      // Default — one card per occupied stage (units can be split across stages).
      for (const entry of sq) {
        const i = path.indexOf(entry.stage);
        const nextStage = i >= 0 && i < path.length - 1 ? path[i + 1] : null;
        const prevStage = i > 0 ? path[i - 1] : null;
        cards.push({
          ...baseCard, branch: attrs.branch, sourcing: attrs.sourcing,
          quantity: entry.qty,                 // units at THIS stage
          currentStage: entry.stage,
          currentLocation: STAGE_LOCATION[entry.stage] || '',
          nextStage,
          prevStage,
          stageQty: dist,                      // full distribution for context
          needsSetup: false,
          completedAt: p.completedAt || null,
        });
      }
    }
  }

  // All filters apply before we count so the column badges match the screen.
  let base = cards;
  if (needsSetup === '1') base = base.filter((c) => c.needsSetup);
  if (branch) base = base.filter((c) => c.branch === branch);
  if (category) base = base.filter((c) => c.productionType === category);
  if (sourcing) base = base.filter((c) => c.sourcing === sourcing);
  if (maker) base = base.filter((c) => c.maker === maker);
  if (stage) {
    const wanted = String(stage).split(',').map((s) => s.trim());
    base = base.filter((c) => wanted.includes(c.currentStage));
  }
  if (location) base = base.filter((c) => c.currentLocation === location);
  if (search) {
    const q = String(search).toLowerCase();
    base = base.filter((c) =>
      [c.companySKU, c.buyerSKU, c.itemDescription, c.orderNumber, c.fileNumber, c.customerName, c.maker, c.outsource?.supplierName]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }

  // Priority items first, then running, then by file / SKU.
  base.sort((a, b) =>
    (b.priority - a.priority) || (b.running - a.running) ||
    String(a.fileNumber).localeCompare(String(b.fileNumber)) ||
    String(a.companySKU).localeCompare(String(b.companySKU))
  );

  const counts = {};
  for (const col of BOARD_COLUMNS) counts[col] = 0;
  for (const c of base) counts[c.currentStage] = (counts[c.currentStage] || 0) + 1;

  successResponse(res, { cards: base, counts, columns: BOARD_COLUMNS, total: base.length });
};

// ─── @GET /api/v1/orders/container/progress ──────────────────────────────────
// Per-file container completion: how many items are Ready for Container out of
// the file's total, and how many are still pending. A container is complete
// when every item of the file is Ready for Container.
exports.getContainerProgress = async (req, res) => {
  const { search } = req.query;
  // A file shows here as soon as it has an order (any non-terminal status —
  // including Drafts). Shipped/Completed/Cancelled files drop off.
  const orders = await Order.find({ orderStatus: { $nin: ['Cancelled', 'Shipped', 'Completed'] } })
    .populate('customer', 'companyName fileNumber')
    .select('orderNumber fileNumber customer items')
    .lean();

  const map = {};
  for (const o of orders) {
    const key = o.fileNumber || '—';
    if (!map[key]) map[key] = { fileNumber: key, customerName: o.customer?.companyName || '', total: 0, ready: 0, orders: 0 };
    map[key].orders += 1;
    for (const it of o.items || []) {
      // Count units, not line items — an item's quantity can be split across stages.
      map[key].total += it.quantity || 1;
      const attrs = resolveItemAttrs(it);
      const path = getPath(attrs);
      if (path) map[key].ready += readyUnits(it, path);
    }
  }

  let files = Object.values(map).map((f) => ({
    ...f,
    pending: f.total - f.ready,
    percent: f.total ? Math.round((f.ready / f.total) * 100) : 0,
    complete: f.total > 0 && f.ready === f.total,
  }));

  if (search) {
    const q = String(search).toLowerCase();
    files = files.filter((f) =>
      [f.fileNumber, f.customerName].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }

  // Incomplete first, then most-pending first, then by file number.
  files.sort((a, b) =>
    (a.complete - b.complete) || (b.pending - a.pending) || String(a.fileNumber).localeCompare(String(b.fileNumber))
  );

  successResponse(res, {
    files,
    totals: {
      files: files.length,
      complete: files.filter((f) => f.complete).length,
      items: files.reduce((s, f) => s + f.total, 0),
      ready: files.reduce((s, f) => s + f.ready, 0),
    },
  });
};

// ─── @GET /api/v1/orders/container/file/:fileNumber ──────────────────────────
// Drill-down: every order of a file with its own progress, and each order's
// items with their stage distribution + how many pieces remain for the container.
exports.getContainerFile = async (req, res) => {
  const orders = await Order.find({
    fileNumber: req.params.fileNumber,
    orderStatus: { $nin: ['Cancelled', 'Shipped', 'Completed'] },
  })
    .populate('customer', 'companyName')
    .select('orderNumber orderStatus orderDate currency customer items')
    .sort({ orderDate: 1 })
    .lean();

  const result = orders.map((o) => {
    let total = 0;
    let ready = 0;
    const items = (o.items || []).map((item) => {
      const attrs = resolveItemAttrs(item);
      const path = getPath(attrs);
      const sq = path ? getStageQty(item, path) : [];
      const dist = sq.map((e) => ({ stage: e.stage, qty: e.qty }));
      const itemReady = (dist.find((d) => d.stage === STAGE.READY) || {}).qty || 0;
      const qty = item.quantity || 0;
      total += qty;
      ready += itemReady;
      return {
        itemId: item._id,
        companySKU: item.companySKU || '',
        itemDescription: item.itemDescription || '',
        image: item.primaryImage || (Array.isArray(item.images) ? item.images[0] : '') || '',
        totalQty: qty,
        stageQty: dist,
        ready: itemReady,
        pending: qty - itemReady,
        routed: !!path,
      };
    });
    return {
      orderId: o._id,
      orderNumber: o.orderNumber,
      orderStatus: o.orderStatus,
      orderDate: o.orderDate,
      total,
      ready,
      pending: total - ready,
      percent: total ? Math.round((ready / total) * 100) : 0,
      complete: total > 0 && ready === total,
      items,
    };
  });

  successResponse(res, {
    fileNumber: req.params.fileNumber,
    customerName: orders[0]?.customer?.companyName || '',
    orders: result,
  });
};

// ─── @PATCH /api/v1/orders/:id/complete ──────────────────────────────────────
// Mark an order Completed (from Container). Only allowed once every piece is
// Ready for Container. A Completed order drops off Production / all stage /
// branch / Container views and lives only under Office → Orders.
exports.completeOrder = async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  let total = 0;
  let ready = 0;
  for (const item of order.items || []) {
    const attrs = resolveItemAttrs(item);
    const path = getPath(attrs);
    total += item.quantity || 0;
    if (path) ready += readyUnits(item, path);
  }
  if (total === 0 || ready < total) {
    throw new AppError('Every piece must be Ready for Container before completing this order.', 400);
  }

  order.orderStatus = 'Completed';
  order.lastModifiedBy = req.user._id;
  await order.save();
  successResponse(res, { order }, 'Order marked completed');
};

// ─── @PATCH /api/v1/orders/:id/items/:itemId/production ──────────────────────
// Route an item: branch → category / sourcing → maker or supplier. Once the
// route resolves, the item is auto-placed at the first stage of its path.
// Body: { branch, category, sourcing, maker, outsource } — all optional so this
// also serves partial edits (e.g. updating an outsource last-call date).
// Legacy `{ productionType, madeAt }` is still accepted.
exports.setItemProduction = async (req, res) => {
  const { branch, category, sourcing, maker, outsource, productionType, madeAt, running, priority } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);
  const item = order.items.id(req.params.itemId);
  if (!item) throw new AppError('Item not found', 404);

  if (!item.production) item.production = {};
  // Simple flag toggles — usable on their own without re-routing.
  if (running != null) item.production.running = !!running;
  if (priority != null) item.production.priority = !!priority;
  if (running != null || priority != null) {
    if (branch == null && category == null && sourcing == null && maker == null && outsource == null && productionType == null && madeAt == null) {
      await order.save();
      return successResponse(res, { item: order.items.id(req.params.itemId) }, 'Updated');
    }
  }

  // Accept both the new and legacy field names.
  const nextBranch = branch != null ? branch : madeAt;
  const nextCategory = category != null ? category : productionType;

  if (nextBranch && !isBranch(nextBranch)) throw new AppError(`Invalid branch "${nextBranch}".`, 400);
  if (nextCategory && !isCategory(nextCategory)) throw new AppError(`Invalid category "${nextCategory}".`, 400);
  if (sourcing && !isSourcing(sourcing)) throw new AppError(`Invalid sourcing "${sourcing}".`, 400);
  if (maker && !isMaker(maker)) {
    throw new AppError(`Unknown maker "${maker}". Add them in config/production.js first.`, 400);
  }

  if (!item.production) item.production = {};
  const p = item.production;

  if (nextBranch != null) { p.branch = nextBranch; p.madeAt = nextBranch; }
  if (nextCategory != null) p.productionType = nextCategory;
  // Sourcing only applies at Kakani; Jhalamand work is always in-house.
  if (p.branch === 'Jhalamand') p.sourcing = 'In-house';
  else if (sourcing != null) p.sourcing = sourcing;
  if (maker != null) p.maker = maker;

  // Outsource details (merge; only for Kakani/Outsourced but harmless otherwise).
  if (outsource && typeof outsource === 'object') {
    p.outsource = { ...(p.outsource ? p.outsource.toObject?.() || p.outsource : {}), ...outsource };
  }

  // Kick the item onto its path the moment the route resolves and nothing has
  // started yet.
  const path = getPath({ branch: p.branch, category: p.productionType, sourcing: p.sourcing });
  if (!Array.isArray(p.history)) p.history = [];
  // Start (first route) OR restart (re-routed onto a different path) — put all
  // units at the new path's first stage. Re-routing within the same path keeps
  // the existing stage distribution.
  const needsStart = path && (!p.currentStage || !path.includes(p.currentStage));
  if (needsStart) {
    const restart = !!p.currentStage;
    p.currentStage = path[0];
    p.currentLocation = STAGE_LOCATION[path[0]] || '';
    if (!p.startedAt) p.startedAt = new Date();
    p.completedAt = null;
    p.stageQty = [{ stage: path[0], qty: item.quantity || 1 }];
    p.history.push({
      stage: path[0],
      location: p.currentLocation,
      note: `${restart ? 'Re-routed & restarted' : 'Routed & started'} (${item.quantity || 1} pc)`,
      movedBy: req.user._id,
      movedByName: req.user.fullName,
      at: new Date(),
    });
  }

  await order.save();
  successResponse(res, { item: order.items.id(req.params.itemId) }, 'Item routed');
};

// ─── @PATCH /api/v1/orders/:id/flags ─────────────────────────────────────────
// Set priority / running on EVERY item of one order.
exports.setOrderFlags = async (req, res) => {
  const { priority, running } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);
  for (const item of order.items) {
    if (!item.production) item.production = {};
    if (priority != null) item.production.priority = !!priority;
    if (running != null) item.production.running = !!running;
  }
  await order.save();
  successResponse(res, { count: order.items.length }, 'Order updated');
};

// ─── @PATCH /api/v1/orders/file/:fileNumber/flags ────────────────────────────
// Set priority / running on EVERY item of EVERY active order in a file.
exports.setFileFlags = async (req, res) => {
  const { priority, running } = req.body;
  const orders = await Order.find({
    fileNumber: req.params.fileNumber,
    orderStatus: { $in: ACTIVE_ORDER_STATUSES },
  });
  let count = 0;
  for (const order of orders) {
    for (const item of order.items) {
      if (!item.production) item.production = {};
      if (priority != null) item.production.priority = !!priority;
      if (running != null) item.production.running = !!running;
      count += 1;
    }
    await order.save();
  }
  successResponse(res, { count }, 'File updated');
};

// ─── @PATCH /api/v1/orders/:id/items/:itemId/stage ───────────────────────────
// Move a BATCH of units of an item one stage forward (or back, Admin only).
// Body: { fromStage?, qty?, direction: 'next'|'back', note?, photo? }.
//   fromStage — which stage to move units out of (defaults to the earliest
//               occupied stage, i.e. the legacy "advance the whole item").
//   qty       — how many units to move (defaults to ALL units at fromStage).
// Units of the same item can therefore sit across several stages at once.
exports.advanceItemStage = async (req, res) => {
  const { direction = 'next', fromStage, qty, note, photo } = req.body;
  const isAdmin = req.user?.role === 'Admin';

  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);
  const item = order.items.id(req.params.itemId);
  if (!item) throw new AppError('Item not found', 404);

  if (!item.production) item.production = {};
  const p = item.production;
  const attrs = resolveItemAttrs(item);
  const path = getPath(attrs);
  if (!path) {
    throw new AppError('Route the item (branch & type) before moving its stage.', 400);
  }

  const sq = getStageQty(item, path);            // [{stage, qty}]
  const srcStage = fromStage || earliestStage(sq, path) || path[0];
  const srcIdx = path.indexOf(srcStage);
  const srcEntry = sq.find((e) => e.stage === srcStage);
  const available = srcEntry ? srcEntry.qty : 0;
  if (available <= 0) throw new AppError(`No units at "${srcStage}" to move.`, 400);

  // Target stage (one step forward or, for Admin, back).
  let tgtIdx;
  if (direction === 'back') {
    if (!isAdmin) throw new AppError('Only an Admin can move units backward.', 403);
    if (srcIdx <= 0) throw new AppError('Units are already at the first stage.', 400);
    tgtIdx = srcIdx - 1;
  } else {
    if (srcIdx >= path.length - 1) throw new AppError('Units are already at the final stage.', 400);
    tgtIdx = srcIdx + 1;
  }
  const targetStage = path[tgtIdx];

  // How many units to move (default: all at the source stage).
  let moveN = qty != null ? parseInt(qty, 10) : available;
  if (isNaN(moveN) || moveN <= 0) throw new AppError('Enter a valid quantity to move.', 400);
  if (moveN > available) moveN = available;

  // Apply the move on the distribution.
  srcEntry.qty -= moveN;
  const tgtEntry = sq.find((e) => e.stage === targetStage);
  if (tgtEntry) tgtEntry.qty += moveN;
  else sq.push({ stage: targetStage, qty: moveN });
  const nextSq = sq.filter((e) => e.qty > 0);

  const totalQty = item.quantity || nextSq.reduce((s, e) => s + e.qty, 0);
  const readyQty = (nextSq.find((e) => e.stage === STAGE.READY) || {}).qty || 0;
  const complete = totalQty > 0 && readyQty >= totalQty;

  if (!Array.isArray(p.history)) p.history = [];
  p.productionType = attrs.category;
  p.stageQty = nextSq;
  p.currentStage = earliestStage(nextSq, path) || targetStage;
  p.currentLocation = STAGE_LOCATION[p.currentStage] || '';
  if (!p.startedAt) p.startedAt = new Date();
  p.completedAt = complete ? new Date() : null;
  p.history.push({
    stage: targetStage,
    location: STAGE_LOCATION[targetStage] || '',
    note: `${moveN} pc(s) ${srcStage} → ${targetStage}${note ? `: ${note}` : ''}`,
    photo: photo || '',
    movedBy: req.user._id,
    movedByName: req.user.fullName,
    at: new Date(),
  });

  await order.save();

  // The units landed in a new stage — tell the people who work that stage.
  // (Branch modules gate the stage pages; production gates the board.)
  await notify(['production', String(p.branch || '').toLowerCase()], {
    type: 'stage-advanced',
    title: `${targetStage} — ${item.companySKU}`,
    message: `${moveN} pc(s) of ${item.companySKU} moved ${srcStage} → ${targetStage} (${order.orderNumber}).`,
    fileNumber: order.fileNumber,
    orderId: order._id,
    link: `/factory/production`,
  }, { exclude: req.user._id });

  // When the last units reach Ready for Container, the file's container may be
  // complete — notify the Office.
  if (complete) {
    try {
      await notifyIfContainerComplete(order.fileNumber, order._id);
    } catch (err) {
      console.error('container-complete notify failed:', err.message);
    }
  }

  successResponse(res, { item: order.items.id(req.params.itemId) }, `Moved ${moveN} pc to ${targetStage}`);
};

// ─── Producer: notify Office when a file's container is complete ──────────────
// "Complete" = every routed item across all non-cancelled orders of the file is
// at Ready for Container (and there is at least one). Idempotent per file.
async function notifyIfContainerComplete(fileNumber, orderId) {
  if (!fileNumber) return;

  const orders = await Order.find({
    fileNumber,
    orderStatus: { $in: PROCESSING_STATUSES },
  }).select('items').lean();

  let total = 0;
  let ready = 0;
  for (const o of orders) {
    for (const item of o.items || []) {
      const attrs = resolveItemAttrs(item);
      const path = getPath(attrs);
      if (!path) continue;                        // unrouted items don't count
      total += item.quantity || 1;
      ready += readyUnits(item, path);
    }
  }
  if (total === 0 || ready < total) return;

  // Idempotent — one notification per file.
  const already = await Notification.exists({ type: 'container-complete', fileNumber });
  if (already) return;

  // Recipients: active Office staff + Admins.
  const recipients = await User.find({
    isActive: true,
    $or: [{ role: 'Admin' }, { department: 'Office' }],
  }).select('_id').lean();
  if (!recipients.length) return;

  await Notification.insertMany(
    recipients.map((u) => ({
      user: u._id,
      type: 'container-complete',
      title: 'Container complete',
      message: `All items for file ${fileNumber} are Ready for Container.`,
      fileNumber,
      orderId,
      link: `/office/orders/folder?file=${encodeURIComponent(fileNumber)}`,
    }))
  );
}

// ─── @PATCH /api/v1/orders/:id/items/:itemId/primary-image ───────────────────
exports.setPrimaryImage = async (req, res, next) => {
  const { imagePath } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) throw new AppError('Order not found', 404);

  const item = order.items.id(req.params.itemId);
  if (!item) throw new AppError('Item not found', 404);

  // Store the path as-is (GitHub URLs are already absolute)
  item.primaryImage = imagePath;
  await order.save();

  // Propagate the primary-image change to the BuyerCatalogue
  if (order.orderStatus !== 'Draft') {
    try {
      await syncBuyerCatalogue(order, req.user);
    } catch (error) {
      console.error('Error syncing buyer catalogue after setPrimaryImage:', error);
    }
  }

  successResponse(res, { primaryImage: item.primaryImage }, 'Primary image updated successfully');
};
