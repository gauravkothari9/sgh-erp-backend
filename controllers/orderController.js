const Order = require('../models/Order');
const Customer = require('../models/Customer');
const path = require('path');
const generateOrderNumber = require('../utils/generateOrderNumber');
const generatePINumber = require('../utils/generatePINumber');
const { syncBuyerCatalogue } = require('../utils/syncBuyerCatalogue');
const { AppError } = require('../middleware/errorHandler');
const {
  uploadToGitHub,
  uploadMultipleToGitHub,
  deleteFromGitHub,
  isGitHubUrl,
} = require('../utils/githubStorage');
const {
  successResponse,
  createdResponse,
  paginatedResponse,
  buildPagination,
} = require('../utils/apiResponse');

// ─── Helper: generate a unique filename from a multer memory file ───────────
const uniqueName = (prefix, originalname) => {
  const ext = path.extname(originalname);
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `${prefix}-${stamp}${ext}`;
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
