const path = require('path');
const prisma = require('../src/lib/prisma');
const { AppError } = require('../middleware/errorHandler');
const { uploadToGitHub, deleteFromGitHub, isGitHubUrl } = require('../utils/localStorage');
const {
  successResponse,
  createdResponse,
} = require('../utils/apiResponse');

// Branches + valid section letters live here so a request can't insert a
// product into a section the floor doesn't actually have.
const BRANCH_SECTIONS = {
  jhalamand: ['A', 'B', 'C', 'D'],
  kakani: ['A', 'B', 'C'],
};

const shape = (p) => {
  if (!p) return p;
  return {
    ...p,
    _id: p.id,
    price: p.price !== null && typeof p.price === 'object' && typeof p.price.toNumber === 'function'
      ? p.price.toNumber()
      : Number(p.price ?? 0),
  };
};

// ─── @GET /api/v1/showroom-products ──────────────────────────────────────────
exports.listShowroomProducts = async (req, res) => {
  const { page = 1, limit = 50, branch, section, search } = req.query;
  const where = {};
  if (branch) where.branch = branch;
  if (section) where.section = String(section).toUpperCase();
  if (search) {
    where.OR = [
      { companySKU: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  const take = parseInt(limit, 10);
  const skip = (parseInt(page, 10) - 1) * take;

  const [items, total] = await Promise.all([
    prisma.showroomProduct.findMany({
      where,
      orderBy: [{ branch: 'asc' }, { section: 'asc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.showroomProduct.count({ where }),
  ]);

  // Legacy contract: the frontend reads res.data.data.products, not a
  // flat array. Keep that shape so the existing UI keeps working.
  successResponse(
    res,
    {
      products: items.map(shape),
      total,
      page: parseInt(page, 10),
      limit: take,
    },
    'Showroom products retrieved'
  );
};

// ─── @GET /api/v1/showroom-products/:id ──────────────────────────────────────
exports.getShowroomProduct = async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.showroomProduct.findUnique({ where: { id } });
  if (!product) throw new AppError('Showroom product not found', 404);
  successResponse(res, { product: shape(product) });
};

// ─── @POST /api/v1/showroom-products ─────────────────────────────────────────
exports.createShowroomProduct = async (req, res) => {
  const { branch, section, companySKU, size, price, currency, description } = req.body;
  if (!branch || !section || !companySKU) {
    throw new AppError('branch, section and companySKU are required', 400);
  }

  const sec = String(section).toUpperCase();
  const allowed = BRANCH_SECTIONS[branch];
  if (!allowed) throw new AppError(`Unknown branch: ${branch}`, 400);
  if (!allowed.includes(sec)) {
    throw new AppError(`Section "${sec}" is not valid for ${branch} (allowed: ${allowed.join(', ')})`, 400);
  }

  // Upload any photos that arrived as multipart files.
  let photos = [];
  if (Array.isArray(req.files) && req.files.length > 0) {
    photos = await Promise.all(
      req.files.map(async (f) => {
        const ext = path.extname(f.originalname);
        const filename = `showroom-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        return uploadToGitHub(f.buffer, filename, 'showroom');
      })
    );
  }
  const primaryImage = photos.length > 0 ? photos[0] : null;

  const product = await prisma.showroomProduct.create({
    data: {
      branch,
      section: sec,
      companySKU: String(companySKU).toUpperCase(),
      size: size || null,
      price: price ? Number(price) : 0,
      currency: currency || 'INR',
      description: description || null,
      photos,
      primaryImage,
      createdById: req.user.id,
      modifiedById: req.user.id,
    },
  });

  createdResponse(res, { product: shape(product) }, 'Showroom product created');
};

// ─── @PUT /api/v1/showroom-products/:id ──────────────────────────────────────
exports.updateShowroomProduct = async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.showroomProduct.findUnique({ where: { id } });
  if (!existing) throw new AppError('Showroom product not found', 404);

  const { branch, section, companySKU, size, price, currency, description } = req.body;
  const data = {};

  if (branch && section) {
    const sec = String(section).toUpperCase();
    const allowed = BRANCH_SECTIONS[branch];
    if (!allowed) throw new AppError(`Unknown branch: ${branch}`, 400);
    if (!allowed.includes(sec)) {
      throw new AppError(`Section "${sec}" is not valid for ${branch} (allowed: ${allowed.join(', ')})`, 400);
    }
    data.branch = branch;
    data.section = sec;
  }
  if (companySKU !== undefined) data.companySKU = String(companySKU).toUpperCase();
  if (size !== undefined) data.size = size || null;
  if (price !== undefined) data.price = Number(price);
  if (currency !== undefined) data.currency = currency || 'INR';
  if (description !== undefined) data.description = description || null;
  data.modifiedById = req.user.id;

  // Append any newly uploaded photos.
  if (Array.isArray(req.files) && req.files.length > 0) {
    const newPhotos = await Promise.all(
      req.files.map(async (f) => {
        const ext = path.extname(f.originalname);
        const filename = `showroom-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        return uploadToGitHub(f.buffer, filename, 'showroom');
      })
    );
    data.photos = [...(existing.photos || []), ...newPhotos];
    if (!existing.primaryImage && newPhotos.length > 0) data.primaryImage = newPhotos[0];
  }

  const product = await prisma.showroomProduct.update({ where: { id }, data });
  successResponse(res, { product: shape(product) }, 'Showroom product updated');
};

// ─── @DELETE /api/v1/showroom-products/:id ───────────────────────────────────
exports.deleteShowroomProduct = async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.showroomProduct.findUnique({ where: { id } });
  if (!existing) throw new AppError('Showroom product not found', 404);

  // Best-effort GitHub cleanup — fire-and-forget so a slow third-party API
  // doesn't block the response.
  for (const url of existing.photos || []) {
    if (url && isGitHubUrl(url)) {
      deleteFromGitHub(url).catch((err) =>
        console.error(`GitHub delete error for ${url}:`, err.message)
      );
    }
  }

  await prisma.showroomProduct.delete({ where: { id } });
  successResponse(res, null, 'Showroom product deleted');
};
