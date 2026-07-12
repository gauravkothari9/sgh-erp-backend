const ShowroomProduct = require('../models/ShowroomProduct');
const { uploadToLocal, deleteFromLocal } = require('../utils/localStorage');
const { AppError } = require('../middleware/errorHandler');
const { successResponse, createdResponse } = require('../utils/apiResponse');
const { isValidLocation, SHOWROOM_BRANCHES, SHOWROOM_COLLECTIONS } = require('../config/showroom');
const { deductShowroomStock } = require('../utils/showroomStock');
const { notify, showroomModule } = require('../utils/notify');

// The permission module a given branch maps to.
const moduleFor = (branch) => (branch === 'Kakani' ? 'showroomKakani' : 'showroomJhalamand');

const assertBranchPermission = (req, branch, action) => {
  if (!['Kakani', 'Jhalamand'].includes(branch)) throw new AppError('Invalid branch.', 400);
  if (!req.user.hasPermission(moduleFor(branch), action)) {
    throw new AppError(`Access denied. Missing '${action}' permission on ${branch} showroom.`, 403);
  }
};

// A product can span both branches, so editing it requires the permission on
// every branch it currently sits in, plus every branch it is moving into.
const assertLocationsPermission = (req, locations, action) => {
  const branches = [...new Set((locations || []).map((l) => l.branch).filter(Boolean))];
  if (!branches.length) throw new AppError('Product has no showroom location.', 400);
  branches.forEach((b) => assertBranchPermission(req, b, action));
};

// A product whose stock ran to zero keeps no locations, so fall back to the
// legacy branch mirror when checking permission on it.
const locationsOf = (product) =>
  product.locations?.length ? product.locations : [{ branch: product.branch }];

// Multipart sends everything as strings — dimensions arrive as the flat fields
// length / width / height / unit.
const readDimensions = (body) => ({
  length: parseFloat(body.length) || 0,
  width: parseFloat(body.width) || 0,
  height: parseFloat(body.height) || 0,
  unit: body.unit === 'inch' ? 'inch' : 'cm',
});

// `locations` arrives as a JSON string in the multipart body:
//   [{ branch: 'Jhalamand', zone: 'A', qty: 5 }, …]
// Rows are validated, uppercased, and merged so a branch+zone appears once.
const readLocations = (raw) => {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { throw new AppError('Invalid locations payload.', 400); }
  }
  if (!Array.isArray(parsed)) throw new AppError('Locations must be a list of branch/zone/qty rows.', 400);

  const merged = new Map();
  parsed.forEach((row) => {
    const branch = row?.branch;
    const zone = String(row?.zone || '').toUpperCase();
    const qty = Math.max(parseInt(row?.qty, 10) || 0, 0);
    if (!qty) return; // a zero row just means "not stocked here"
    if (!isValidLocation(branch, zone)) {
      throw new AppError(`Invalid showroom location: ${branch || '?'} zone ${zone || '?'}.`, 400);
    }
    const key = `${branch}|${zone}`;
    merged.set(key, { branch, zone, qty: (merged.get(key)?.qty || 0) + qty });
  });

  const locations = [...merged.values()];
  if (!locations.length) throw new AppError('Add stock in at least one zone.', 400);
  return locations;
};

// ─── @GET /api/v1/showroom/products?branch=&zone= ────────────────────────────
// Lists everything stocked in that zone (qty > 0). Without `zone`, every item
// present anywhere in the branch.
exports.listProducts = async (req, res) => {
  const { branch, zone } = req.query;
  assertBranchPermission(req, branch, 'read');

  const match = { branch };
  if (zone) match.zone = String(zone).toUpperCase();

  const products = await ShowroomProduct.find({
    locations: { $elemMatch: { ...match, qty: { $gt: 0 } } },
  })
    .sort({ createdAt: -1 })
    .lean();

  // Surface how many units of each item sit in *this* zone, alongside the total.
  const withZoneQty = products.map((p) => ({
    ...p,
    zoneQty: (p.locations || [])
      .filter((l) => l.branch === branch && (!zone || l.zone === String(zone).toUpperCase()))
      .reduce((s, l) => s + (l.qty || 0), 0),
  }));

  successResponse(res, { products: withZoneQty });
};

// Branches the signed-in user may read. Collections span both showrooms, so a
// user who can only see Kakani gets Kakani stock only. `?branch=` narrows the
// view further (the toggle on the Collections page); no branch = all of them.
const readableBranches = (req) => {
  const allowed = SHOWROOM_BRANCHES.filter((b) => req.user.hasPermission(moduleFor(b), 'read'));
  const asked = req.query.branch;
  if (!asked) return allowed;
  if (!allowed.includes(asked)) {
    throw new AppError(`Access denied. Missing 'read' permission on ${asked} showroom.`, 403);
  }
  return [asked];
};

// ─── @GET /api/v1/showroom/collections ───────────────────────────────────────
// Every collection the user can see, with how many items and units sit in it.
exports.getCollections = async (req, res) => {
  const branches = readableBranches(req);
  if (!branches.length) throw new AppError('Access denied. No showroom access.', 403);

  const products = await ShowroomProduct.find({
    'locations.branch': { $in: branches },
  }).lean();

  const map = new Map();
  products.forEach((p) => {
    const key = p.collectionName?.trim() || 'Uncategorised';
    const units = (p.locations || [])
      .filter((l) => branches.includes(l.branch))
      .reduce((s, l) => s + (l.qty || 0), 0);
    if (!units) return;
    const entry = map.get(key) || { collection: key, items: 0, units: 0, image: '' };
    entry.items += 1;
    entry.units += units;
    if (!entry.image && p.image) entry.image = p.image;
    map.set(key, entry);
  });

  const collections = [...map.values()].sort((a, b) => a.collection.localeCompare(b.collection));

  // Items nobody has priced for walk-in customers yet — they'd bill at ₹0.
  const missingLocalPrice = products.filter(
    (p) =>
      !p.localPrice &&
      (p.locations || []).some((l) => branches.includes(l.branch) && l.qty > 0)
  ).length;

  successResponse(res, { collections, missingLocalPrice, suggested: SHOWROOM_COLLECTIONS });
};

// ─── @GET /api/v1/showroom/collections/products?collection=&search= ──────────
// Products across BOTH showrooms (every zone the user can read), optionally
// filtered to one collection.
exports.getCollectionProducts = async (req, res) => {
  const branches = readableBranches(req);
  if (!branches.length) throw new AppError('Access denied. No showroom access.', 403);

  const { collection, search, missingLocalPrice } = req.query;
  const filter = { 'locations.branch': { $in: branches } };

  // Two independent $or clauses (price + search) — keep them in $and so neither
  // overwrites the other.
  const and = [];

  // `?missingLocalPrice=1` → only items with no walk-in price set.
  if (missingLocalPrice === '1' || missingLocalPrice === 'true') {
    and.push({ $or: [{ localPrice: { $in: [0, null] } }, { localPrice: { $exists: false } }] });
  }
  if (collection) {
    filter.collectionName = collection === 'Uncategorised'
      ? { $in: ['', null] }
      : collection;
  }
  if (search) {
    const rx = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    and.push({ $or: [{ name: rx }, { sku: rx }, { collectionName: rx }] });
  }
  if (and.length) filter.$and = and;

  const products = await ShowroomProduct.find(filter).sort({ collectionName: 1, createdAt: -1 }).lean();

  // Hide zones in branches the user can't read, and recompute the visible total.
  const scoped = products
    .map((p) => {
      const locations = (p.locations || []).filter((l) => branches.includes(l.branch));
      return { ...p, locations, totalQty: locations.reduce((s, l) => s + (l.qty || 0), 0) };
    })
    .filter((p) => p.totalQty > 0);

  successResponse(res, { products: scoped });
};

// ─── @GET /api/v1/showroom/products/:id ──────────────────────────────────────
exports.getProduct = async (req, res) => {
  const product = await ShowroomProduct.findById(req.params.id).lean();
  if (!product) throw new AppError('Product not found', 404);
  assertLocationsPermission(req, locationsOf(product), 'read');
  successResponse(res, { product });
};

// ─── @POST /api/v1/showroom/products ─────────────────────────────────────────
// Multipart: name, length/width/height/unit, basePrice, locations (JSON string)
// + optional `image` file.
exports.createProduct = async (req, res) => {
  const { sku, name, collection, size, basePrice, localPrice } = req.body;
  if (!name || !name.trim()) throw new AppError('Product name is required.', 400);

  const locations = readLocations(req.body.locations);
  assertLocationsPermission(req, locations, 'create');

  let image = '';
  if (req.file) {
    image = await uploadToLocal(req.file.buffer, req.file.originalname, 'showroom');
  }

  const product = await ShowroomProduct.create({
    sku: (sku || '').trim().toUpperCase(),
    name: name.trim(),
    collectionName: (collection || '').trim(),
    size: (size || '').trim(),
    dimensions: readDimensions(req.body),
    basePrice: parseFloat(basePrice) || 0,
    localPrice: parseFloat(localPrice) || 0,
    image,
    locations,
    createdBy: req.user._id,
  });

  // A product with no walk-in price would bill at ₹0 on a local order — flag it
  // to the showroom staff who can fix it.
  if (!product.localPrice) {
    await notify(
      [...new Set(locations.map((l) => showroomModule(l.branch)))],
      {
        type: 'showroom-no-local-price',
        title: 'Local price missing',
        message: `"${product.name}" was added without a local price. It would bill at ₹0 on a local order.`,
        link: '/showroom/collections?missing=1',
      },
      { exclude: req.user._id }
    );
  }

  createdResponse(res, { product }, 'Product added');
};

// ─── @PUT /api/v1/showroom/products/:id ──────────────────────────────────────
// Same fields as create. A new `image` file replaces the old one;
// `removeImage=true` clears it. Sending `locations` replaces the stock spread.
exports.updateProduct = async (req, res) => {
  const product = await ShowroomProduct.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);
  assertLocationsPermission(req, locationsOf(product), 'update');

  const { sku, name, collection, size, basePrice, localPrice, removeImage } = req.body;
  if (sku !== undefined) product.sku = sku.trim().toUpperCase();
  if (collection !== undefined) product.collectionName = collection.trim();
  if (name !== undefined) {
    if (!name.trim()) throw new AppError('Product name is required.', 400);
    product.name = name.trim();
  }
  if (size !== undefined) product.size = size.trim();
  if (basePrice !== undefined) product.basePrice = parseFloat(basePrice) || 0;
  if (localPrice !== undefined) product.localPrice = parseFloat(localPrice) || 0;
  if (req.body.length !== undefined || req.body.width !== undefined || req.body.height !== undefined) {
    product.dimensions = readDimensions(req.body);
  }
  if (req.body.locations !== undefined) {
    const locations = readLocations(req.body.locations);
    assertLocationsPermission(req, locations, 'update'); // also covers zones it moves *into*
    product.locations = locations;
  }

  const oldImage = product.image;
  if (req.file) {
    product.image = await uploadToLocal(req.file.buffer, req.file.originalname, 'showroom');
  } else if (removeImage === 'true' || removeImage === true) {
    product.image = '';
  }

  await product.save();

  // Drop the replaced file only once the new record is safely persisted.
  if (oldImage && oldImage !== product.image) {
    try { await deleteFromLocal(oldImage); } catch { /* best-effort */ }
  }

  successResponse(res, { product }, 'Product updated');
};

// ─── @PATCH /api/v1/showroom/products/:id/transfer ───────────────────────────
// Move `qty` units between zones: { from: {branch, zone}, to: {branch, zone}, qty }
exports.transferStock = async (req, res) => {
  const product = await ShowroomProduct.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);

  const { from, to } = req.body;
  const qty = parseInt(req.body.qty, 10) || 0;
  if (qty <= 0) throw new AppError('Transfer quantity must be at least 1.', 400);
  if (!isValidLocation(from?.branch, from?.zone)) throw new AppError('Invalid source zone.', 400);
  if (!isValidLocation(to?.branch, to?.zone)) throw new AppError('Invalid destination zone.', 400);

  const fromZone = String(from.zone).toUpperCase();
  const toZone = String(to.zone).toUpperCase();
  if (from.branch === to.branch && fromZone === toZone) {
    throw new AppError('Source and destination zone are the same.', 400);
  }

  assertBranchPermission(req, from.branch, 'update');
  assertBranchPermission(req, to.branch, 'update');

  const src = product.locations.find((l) => l.branch === from.branch && l.zone === fromZone);
  if (!src || src.qty < qty) {
    throw new AppError(`Only ${src?.qty || 0} unit(s) available in ${from.branch} zone ${fromZone}.`, 400);
  }

  src.qty -= qty;
  const dest = product.locations.find((l) => l.branch === to.branch && l.zone === toZone);
  if (dest) dest.qty += qty;
  else product.locations.push({ branch: to.branch, zone: toZone, qty });

  await product.save(); // pre-save drops zeroed rows and recomputes totalQty
  successResponse(res, { product }, 'Stock moved');
};

// ─── @POST /api/v1/showroom/products/consume ─────────────────────────────────
// Deduct ordered units from showroom stock: { items: [{ id, qty, branch, zone }] }
// Units come out of the zone the item was picked in first, then out of the
// remaining zones (largest first) until the ordered quantity is covered.
exports.consumeStock = async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) throw new AppError('No items to consume.', 400);

  const products = await deductShowroomStock(items, req.user);
  successResponse(res, { products }, 'Showroom stock updated');
};

// ─── @DELETE /api/v1/showroom/products/:id ───────────────────────────────────
exports.deleteProduct = async (req, res) => {
  const product = await ShowroomProduct.findById(req.params.id);
  if (!product) throw new AppError('Product not found', 404);
  assertLocationsPermission(req, locationsOf(product), 'delete');
  if (product.image) {
    try { await deleteFromLocal(product.image); } catch { /* best-effort */ }
  }
  await product.deleteOne();
  successResponse(res, {}, 'Product removed');
};
