const path = require('path');
const InventoryProduct = require('../models/InventoryProduct');
const InventoryLedger = require('../models/InventoryLedger');
const { AppError } = require('../middleware/errorHandler');
const { uploadToGitHub } = require('../utils/localStorage');
const {
  successResponse,
  createdResponse,
} = require('../utils/apiResponse');

const VALID_ZONES = {
  jhalamand: ['A', 'B', 'C', 'D'],
  kakani: ['A', 'B', 'C'],
};

const enforceLedgerCap = async () => {
  try {
    const count = await InventoryLedger.countDocuments();
    if (count > 100) {
      const excess = count - 100;
      const oldestRecords = await InventoryLedger.find()
        .sort({ createdAt: 1 })
        .limit(excess)
        .select('_id');
      const idsToDelete = oldestRecords.map((r) => r._id);
      await InventoryLedger.deleteMany({ _id: { $in: idsToDelete } });
    }
  } catch (err) {
    console.error('Failed to enforce ledger cap:', err);
  }
};

const shape = (p) => {
  if (!p) return p;
  const doc = p.toObject ? p.toObject() : p;
  return {
    ...doc,
    _id: doc._id ? String(doc._id) : doc.id,
    id: doc._id ? String(doc._id) : doc.id,
  };
};

// ─── @GET /api/v1/inventory-products ──────────────────────────────────────────
exports.listProducts = async (req, res) => {
  const { page = 1, limit = 100, location, zone, status, search } = req.query;
  const filter = {};

  if (location) filter.location = location;
  if (zone) filter.zone = String(zone).toUpperCase();
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { companySKU: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  const take = parseInt(limit, 10);
  const skip = (parseInt(page, 10) - 1) * take;

  const [items, total] = await Promise.all([
    InventoryProduct.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(take)
      .lean(),
    InventoryProduct.countDocuments(filter),
  ]);

  successResponse(
    res,
    {
      products: items.map(shape),
      total,
      page: parseInt(page, 10),
      limit: take,
    },
    'Inventory products retrieved'
  );
};

// ─── @GET /api/v1/inventory-products/:id ──────────────────────────────────────
exports.getProduct = async (req, res) => {
  const product = await InventoryProduct.findById(req.params.id).lean();
  if (!product) throw new AppError('Product not found', 404);

  // Fetch all other batches of this same SKU across all branches and zones
  const otherBatches = await InventoryProduct.find({
    companySKU: product.companySKU,
    _id: { $ne: product._id },
  })
    .sort({ status: 1, createdAt: -1 })
    .lean();

  // Fetch full transaction audit trail ledger
  const ledger = await InventoryLedger.find({ productId: req.params.id })
    .populate('performedBy', 'fullName username')
    .sort({ createdAt: -1 })
    .lean();

  successResponse(res, {
    product: shape(product),
    ledger: ledger.map((l) => ({
      ...l,
      _id: String(l._id),
      id: String(l._id),
    })),
    otherBatches: otherBatches.map(shape),
  });
};

// ─── @POST /api/v1/inventory-products ─────────────────────────────────────────
exports.createProduct = async (req, res) => {
  const { name, companySKU, size, price, currency, qty, location, zone, description } = req.body;

  if (!name || !companySKU || !location || !zone) {
    throw new AppError('Product name, company SKU, location, and zone are required', 400);
  }

  const loc = String(location).toLowerCase();
  const zo = String(zone).toUpperCase();

  const allowedZones = VALID_ZONES[loc];
  if (!allowedZones) throw new AppError(`Unknown location: ${location}`, 400);
  if (!allowedZones.includes(zo)) {
    throw new AppError(`Zone "${zo}" is not valid for ${location} (allowed: ${allowedZones.join(', ')})`, 400);
  }

  // Upload photos to GitHub helper
  let photos = [];
  if (Array.isArray(req.files) && req.files.length > 0) {
    photos = await Promise.all(
      req.files.map(async (f) => {
        const ext = path.extname(f.originalname);
        const filename = `inventory-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        return uploadToGitHub(f.buffer, filename, 'showroom');
      })
    );
  }
  const primaryImage = photos.length > 0 ? photos[0] : null;

  const product = await InventoryProduct.create({
    name,
    companySKU: String(companySKU).toUpperCase(),
    size: size || null,
    price: price ? Number(price) : 0,
    currency: currency || 'INR',
    qty: qty ? Number(qty) : 1,
    location: loc,
    zone: zo,
    description: description || null,
    photos,
    primaryImage,
    createdBy: req.user._id,
    modifiedBy: req.user._id,
  });

  createdResponse(res, { product: shape(product) }, 'Inventory product created');
};

// ─── @PUT /api/v1/inventory-products/:id ──────────────────────────────────────
exports.updateProduct = async (req, res) => {
  const product = await InventoryProduct.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);

  const { name, companySKU, size, price, currency, qty, location, zone, description, photosToDelete } = req.body;

  if (location && zone) {
    const loc = String(location).toLowerCase();
    const zo = String(zone).toUpperCase();
    const allowedZones = VALID_ZONES[loc];
    if (!allowedZones) throw new AppError(`Unknown location: ${location}`, 400);
    if (!allowedZones.includes(zo)) {
      throw new AppError(`Zone "${zo}" is not valid for ${location} (allowed: ${allowedZones.join(', ')})`, 400);
    }
    product.location = loc;
    product.zone = zo;
  }

  if (name) product.name = name;
  if (companySKU) product.companySKU = String(companySKU).toUpperCase();
  if (size !== undefined) product.size = size || null;
  if (price !== undefined) product.price = price ? Number(price) : 0;
  if (currency) product.currency = currency;
  if (qty !== undefined) product.qty = qty ? Number(qty) : 1;
  if (description !== undefined) product.description = description || null;

  // Handle photos to delete
  if (Array.isArray(photosToDelete) && photosToDelete.length > 0) {
    product.photos = product.photos.filter((p) => !photosToDelete.includes(p));
  }

  // Upload new photos if provided
  let newPhotos = [];
  if (Array.isArray(req.files) && req.files.length > 0) {
    newPhotos = await Promise.all(
      req.files.map(async (f) => {
        const ext = path.extname(f.originalname);
        const filename = `inventory-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        return uploadToGitHub(f.buffer, filename, 'showroom');
      })
    );
    product.photos = [...product.photos, ...newPhotos];
  }

  // Auto-set primary image if it's currently unset or has been deleted
  if (product.photos.length > 0) {
    if (!product.primaryImage || !product.photos.includes(product.primaryImage)) {
      product.primaryImage = product.photos[0];
    }
  } else {
    product.primaryImage = null;
  }

  product.modifiedBy = req.user._id;
  await product.save();

  successResponse(res, { product: shape(product) }, 'Inventory product updated');
};

// ─── @DELETE /api/v1/inventory-products/:id ───────────────────────────────────
exports.deleteProduct = async (req, res) => {
  const product = await InventoryProduct.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);

  await Promise.all([
    InventoryProduct.findByIdAndDelete(req.params.id),
    InventoryLedger.deleteMany({ productId: req.params.id }),
  ]);

  successResponse(res, null, 'Inventory product and associated audit ledger deleted successfully');
};

// ─── @POST /api/v1/inventory-products/:id/sell ─────────────────────────────────
exports.sellProduct = async (req, res) => {
  const product = await InventoryProduct.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);

  const { customerName, customerEmail, customerPhone, customerAddress, sellQty } = req.body;
  if (!customerName || !customerPhone || !customerAddress) {
    throw new AppError('Customer Name, Phone number, and Address are required to complete a sale', 400);
  }

  const sQty = sellQty ? Number(sellQty) : product.qty;
  if (sQty <= 0 || sQty > product.qty) {
    throw new AppError(`Invalid sale quantity. Available: ${product.qty}`, 400);
  }

  // Subtract quantity directly
  product.qty -= sQty;
  product.modifiedBy = req.user._id;

  const saleDetails = {
    customerName,
    customerEmail: customerEmail || null,
    customerPhone,
    customerAddress,
    soldAt: new Date(),
  };

  await product.save();

  // Log ledger
  await InventoryLedger.create({
    productId: product._id,
    productName: product.name,
    action: 'sold',
    fromLocation: product.location,
    fromZone: product.zone,
    qty: sQty,
    details: saleDetails,
    performedBy: req.user._id,
  });

  await enforceLedgerCap();

  successResponse(res, { product: shape(product) }, 'Product sale recorded successfully');
};

// ─── @POST /api/v1/inventory-products/:id/sample ───────────────────────────────
exports.sampleProduct = async (req, res) => {
  const product = await InventoryProduct.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);

  const { personName, personMobile, sampleQty } = req.body;
  if (!personName || !personMobile) {
    throw new AppError('Person name and Mobile number are required to log a sample', 400);
  }

  const sQty = sampleQty ? Number(sampleQty) : product.qty;
  if (sQty <= 0 || sQty > product.qty) {
    throw new AppError(`Invalid sample quantity. Available: ${product.qty}`, 400);
  }

  // Subtract quantity directly
  product.qty -= sQty;
  product.modifiedBy = req.user._id;

  const sampleDetails = {
    personName,
    personMobile,
    sampleQty: sQty,
    takenAt: new Date(),
    returned: false,
    companySKU: product.companySKU,
    size: product.size,
    price: product.price,
    currency: product.currency,
    description: product.description,
    photos: product.photos,
    primaryImage: product.primaryImage,
  };

  await product.save();

  // Log ledger
  await InventoryLedger.create({
    productId: product._id,
    productName: product.name,
    action: 'sample_taken',
    fromLocation: product.location,
    fromZone: product.zone,
    qty: sQty,
    details: sampleDetails,
    performedBy: req.user._id,
  });

  await enforceLedgerCap();

  successResponse(res, { product: shape(product) }, 'Product sample dispatch recorded successfully');
};

// ─── @POST /api/v1/inventory-products/:id/transfer ─────────────────────────────
exports.transferProduct = async (req, res) => {
  const product = await InventoryProduct.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);

  const { customerFile, purpose, incharge, employee, driver, transferQty } = req.body;
  if (!employee || !driver) {
    throw new AppError('Loader Employee and Transit Driver are required to initiate transfer', 400);
  }

  const destLoc = product.location === 'jhalamand' ? 'kakani' : 'jhalamand';

  const tQty = transferQty ? Number(transferQty) : product.qty;
  if (tQty <= 0 || tQty > product.qty) {
    throw new AppError(`Invalid transfer quantity. Available: ${product.qty}`, 400);
  }

  // Subtract from source
  product.qty -= tQty;
  await product.save();

  const transferDetails = {
    fromLocation: product.location,
    fromZone: product.zone,
    targetLocation: destLoc,
    targetZone: 'TRANSIT',
    customerFile: customerFile || null,
    purpose: purpose || null,
    incharge: incharge || 'N/A',
    employee,
    driver,
    transferTime: new Date(),
    receivedTime: null,
  };

  // Create Transit Product Document at destination (pending verification and unloading)
  const transitProduct = await InventoryProduct.create({
    name: product.name,
    companySKU: product.companySKU,
    size: product.size,
    price: product.price,
    currency: product.currency,
    qty: tQty,
    location: destLoc,
    zone: 'TRANSIT',
    status: 'transferring',
    photos: product.photos,
    primaryImage: product.primaryImage,
    description: product.description,
    transferDetails,
    createdBy: req.user._id,
    modifiedBy: req.user._id,
  });

  // Log ledger
  await InventoryLedger.create({
    productId: transitProduct._id,
    productName: transitProduct.name,
    action: 'transfer_started',
    fromLocation: product.location,
    fromZone: product.zone,
    toLocation: destLoc,
    toZone: 'TRANSIT',
    qty: tQty,
    details: transferDetails,
    performedBy: req.user._id,
  });

  await enforceLedgerCap();

  successResponse(
    res,
    { product: shape(product) },
    'Cargo dispatch registered. Product is now on hold in transit to destination.'
  );
};

// ─── @POST /api/v1/inventory-products/:id/receive ──────────────────────────────
exports.receiveProduct = async (req, res) => {
  const product = await InventoryProduct.findById(req.params.id);
  if (!product) throw new AppError('Transit cargo not found', 404);
  if (product.status !== 'transferring') {
    throw new AppError('Product is not in transit', 400);
  }

  const { targetZone } = req.body;
  if (!targetZone) {
    throw new AppError('Target zone selection is required to receive product', 400);
  }

  const zo = String(targetZone).toUpperCase();
  const allowedZones = VALID_ZONES[product.location];
  if (!allowedZones) throw new AppError(`Unknown location: ${product.location}`, 400);
  if (!allowedZones.includes(zo)) {
    throw new AppError(`Zone "${zo}" is not valid for ${product.location} (allowed: ${allowedZones.join(', ')})`, 400);
  }

  // Look for existing on-floor product with the same SKU in that zone
  let targetProduct = await InventoryProduct.findOne({
    companySKU: product.companySKU,
    location: product.location,
    zone: zo,
    status: 'on_floor',
  });

  let receivedProduct;
  if (targetProduct) {
    // Merge quantity and delete the transit document
    targetProduct.qty += product.qty;
    targetProduct.modifiedBy = req.user._id;
    await targetProduct.save();
    await InventoryProduct.findByIdAndDelete(product._id);
    receivedProduct = targetProduct;
  } else {
    // Simply update the transit document to become floor stock in that zone
    product.zone = zo;
    product.status = 'on_floor';
    if (product.transferDetails) {
      product.transferDetails.targetZone = zo;
      product.transferDetails.receivedTime = new Date();
    }
    product.modifiedBy = req.user._id;
    await product.save();
    receivedProduct = product;
  }

  // Log receipt in ledger
  await InventoryLedger.create({
    productId: receivedProduct._id,
    productName: receivedProduct.name,
    action: 'transfer_received',
    fromLocation: product.transferDetails?.fromLocation || null,
    fromZone: product.transferDetails?.fromZone || null,
    toLocation: receivedProduct.location,
    toZone: receivedProduct.zone,
    qty: product.qty,
    details: {
      receivedAt: new Date(),
      targetZone: zo,
    },
    performedBy: req.user._id,
  });

  await enforceLedgerCap();

  successResponse(res, { product: shape(receivedProduct) }, 'Transit cargo successfully allocated and unloaded to floor zone stock');
};

// ─── @POST /api/v1/inventory-products/:id/return-sample ───────────────────────
exports.returnSampleProduct = async (req, res) => {
  const { ledgerId } = req.body;
  if (!ledgerId) throw new AppError('Ledger log ID is required to return a sample', 400);

  const log = await InventoryLedger.findById(ledgerId);
  if (!log) throw new AppError('Sample checkout log not found', 404);
  if (log.action !== 'sample_taken') throw new AppError('Invalid movement log action', 400);
  if (log.details?.returned) throw new AppError('Sample has already been received back', 400);

  // Mark log as returned
  log.details = {
    ...log.details,
    returned: true,
    returnedAt: new Date(),
  };
  log.markModified('details');
  await log.save();

  // Find or recreate the showroom floor stock product
  let product = await InventoryProduct.findById(log.productId);
  if (!product) {
    // If it was deleted when qty reached 0, search by SKU at target location/zone or recreate it
    product = await InventoryProduct.findOne({
      companySKU: log.details?.companySKU || 'SGH-SKU',
      location: log.fromLocation,
      zone: log.fromZone,
      status: 'on_floor',
    });

    if (!product) {
      product = await InventoryProduct.create({
        name: log.productName,
        companySKU: log.details?.companySKU || 'SGH-SKU',
        qty: 0,
        location: log.fromLocation,
        zone: log.fromZone,
        status: 'on_floor',
        size: log.details?.size || null,
        price: log.details?.price || 0,
        currency: log.details?.currency || 'INR',
        description: log.details?.description || null,
        photos: log.details?.photos || [],
        primaryImage: log.details?.primaryImage || null,
        createdBy: req.user._id,
        modifiedBy: req.user._id,
      });
    }
  }

  // Restore qty
  product.qty += log.qty;
  product.modifiedBy = req.user._id;
  await product.save();

  // Log return
  await InventoryLedger.create({
    productId: product._id,
    productName: product.name,
    action: 'sample_returned',
    fromLocation: product.location,
    fromZone: product.zone,
    qty: log.qty,
    details: {
      personName: log.details?.personName,
      personMobile: log.details?.personMobile,
      returnedAt: new Date(),
    },
    performedBy: req.user._id,
  });

  await enforceLedgerCap();

  successResponse(res, { product: shape(product) }, 'Sample successfully received back to floor stock');
};

// ─── @GET /api/v1/inventory-products/all-on-floor ─────────────────────────────
exports.listAllOnFloor = async (req, res) => {
  const { search } = req.query;
  const filter = { status: 'on_floor' };

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { companySKU: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  const products = await InventoryProduct.find(filter)
    .sort({ location: 1, zone: 1, createdAt: -1 })
    .lean();

  successResponse(res, { products: products.map(shape) }, 'All on-floor products retrieved');
};

// ─── @GET /api/v1/inventory-products/ledger ────────────────────────────────────
exports.getGlobalLedger = async (req, res) => {
  const { page = 1, limit = 50, action, search, fromLocation, returned } = req.query;
  const filter = {};

  if (action) filter.action = action;
  if (fromLocation) filter.fromLocation = fromLocation;
  if (returned !== undefined) {
    if (returned === 'true') {
      filter['details.returned'] = true;
    } else if (returned === 'false') {
      filter['details.returned'] = false;
    }
  }

  if (search) {
    const matchedProducts = await InventoryProduct.find({
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { companySKU: { $regex: search, $options: 'i' } },
      ]
    }).select('_id').lean();
    const matchedIds = matchedProducts.map((p) => p._id);

    filter.$or = [
      { productId: { $in: matchedIds } },
      { productName: { $regex: search, $options: 'i' } },
    ];
  }

  const take = parseInt(limit, 10);
  const skip = (parseInt(page, 10) - 1) * take;

  const [logs, total] = await Promise.all([
    InventoryLedger.find(filter)
      .populate('performedBy', 'fullName username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(take)
      .lean(),
    InventoryLedger.countDocuments(filter),
  ]);

  // Resolve company SKU for logs to display in table/timeline
  const productIds = logs.map((l) => l.productId).filter(Boolean);
  const products = await InventoryProduct.find({ _id: { $in: productIds } })
    .select('_id companySKU')
    .lean();
  const skuMap = products.reduce((acc, p) => {
    acc[String(p._id)] = p.companySKU;
    return acc;
  }, {});

  const shapedLogs = logs.map((l) => ({
    ...l,
    _id: String(l._id),
    id: String(l._id),
    companySKU: skuMap[String(l.productId)] || null,
  }));

  successResponse(
    res,
    {
      logs: shapedLogs,
      total,
      page: parseInt(page, 10),
      limit: take,
    },
    'Global stock ledger retrieved'
  );
};

// ─── @POST /api/v1/inventory-products/bulk-action ─────────────────────────────
exports.bulkActionProducts = async (req, res) => {
  const { productIds, action, payload } = req.body;

  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new AppError('productIds array is required', 400);
  }
  if (!['sell', 'sample', 'transfer'].includes(action)) {
    throw new AppError('Invalid bulk action. Allowed: sell, sample, transfer', 400);
  }
  if (!payload) {
    throw new AppError('Payload is required', 400);
  }

  const products = await InventoryProduct.find({ _id: { $in: productIds } });
  if (products.length !== productIds.length) {
    throw new AppError('One or more products could not be found', 404);
  }

  // Validate all items are 'on_floor'
  const nonFloor = products.filter((p) => p.status !== 'on_floor');
  if (nonFloor.length > 0) {
    const names = nonFloor.map((p) => p.name).join(', ');
    throw new AppError(`Bulk action rejected. These items are not currently on floor: ${names}`, 400);
  }

  // Handle specific action logic
  if (action === 'sell') {
    const { customerName, customerEmail, customerPhone, customerAddress } = payload;
    if (!customerName || !customerPhone || !customerAddress) {
      throw new AppError('Customer Name, Phone, and Address are required', 400);
    }

    for (const product of products) {
      const sellQty = product.qty;
      product.qty = 0; // Completely sold in bulk
      product.modifiedBy = req.user._id;

      const saleDetails = {
        customerName,
        customerEmail: customerEmail || null,
        customerPhone,
        customerAddress,
        soldAt: new Date(),
        companySKU: product.companySKU,
        size: product.size,
        price: product.price,
        currency: product.currency,
        description: product.description,
        photos: product.photos,
        primaryImage: product.primaryImage,
      };

      await product.save();

      await InventoryLedger.create({
        productId: product._id,
        productName: product.name,
        action: 'sold',
        fromLocation: product.location,
        fromZone: product.zone,
        qty: sellQty,
        details: saleDetails,
        performedBy: req.user._id,
      });

      await enforceLedgerCap();
    }
  } else if (action === 'sample') {
    const { personName, personMobile } = payload;
    if (!personName || !personMobile) {
      throw new AppError('Taker Representative Name and Mobile are required', 400);
    }

    for (const product of products) {
      const sampleQty = product.qty;
      product.qty = 0; // Completely taken as sample in bulk
      product.modifiedBy = req.user._id;

      const sampleDetails = {
        personName,
        personMobile,
        sampleQty,
        takenAt: new Date(),
        returned: false,
        companySKU: product.companySKU,
        size: product.size,
        price: product.price,
        currency: product.currency,
        description: product.description,
        photos: product.photos,
        primaryImage: product.primaryImage,
      };

      await product.save();

      await InventoryLedger.create({
        productId: product._id,
        productName: product.name,
        action: 'sample_taken',
        fromLocation: product.location,
        fromZone: product.zone,
        qty: sampleQty,
        details: sampleDetails,
        performedBy: req.user._id,
      });

      await enforceLedgerCap();
    }
  } else if (action === 'transfer') {
    const { targetZone, customerFile, purpose, incharge, employee, driver } = payload;
    if (!employee || !driver) {
      throw new AppError('Loader Employee and Transit Driver are required', 400);
    }

    for (const product of products) {
      const destLoc = product.location === 'jhalamand' ? 'kakani' : 'jhalamand';

      const transferQty = product.qty;
      product.qty = 0; // Completely transferred in bulk
      product.modifiedBy = req.user._id;
      await product.save();

      const transferDetails = {
        fromLocation: product.location,
        fromZone: product.zone,
        targetLocation: destLoc,
        targetZone: 'TRANSIT',
        customerFile: customerFile || null,
        purpose: purpose || null,
        incharge: incharge || 'N/A',
        employee,
        driver,
        transferTime: new Date(),
        receivedTime: null,
      };

      // Create Transit Product Document at destination (pending verification and unloading)
      const transitProduct = await InventoryProduct.create({
        name: product.name,
        companySKU: product.companySKU,
        size: product.size,
        price: product.price,
        currency: product.currency,
        qty: transferQty,
        location: destLoc,
        zone: 'TRANSIT',
        status: 'transferring',
        photos: product.photos,
        primaryImage: product.primaryImage,
        description: product.description,
        transferDetails,
        createdBy: req.user._id,
        modifiedBy: req.user._id,
      });

      await InventoryLedger.create({
        productId: transitProduct._id,
        productName: transitProduct.name,
        action: 'transfer_started',
        fromLocation: product.location,
        fromZone: product.zone,
        toLocation: destLoc,
        toZone: 'TRANSIT',
        qty: transferQty,
        details: transferDetails,
        performedBy: req.user._id,
      });

      await enforceLedgerCap();
    }
  }

  successResponse(res, null, `Bulk ${action} completed successfully for ${products.length} items`);
};
