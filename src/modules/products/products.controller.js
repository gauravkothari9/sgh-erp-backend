const mongoose = require('mongoose');
const { z } = require('zod');
const { Product } = require('../../models');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const { upload, publicUrl } = require('../../lib/upload');

const list = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const q = (req.query.q || '').toString().trim();
  const material = req.query.material;

  const where = { isActive: true };
  if (material) where.materialType = material;
  if (q) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    where.$or = [{ name: re }, { code: re }, { category: re }];
  }

  const [items, total] = await Promise.all([
    Product.find(where)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Product.countDocuments(where),
  ]);
  ok(res, { items, page, limit, total });
};

const getOne = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Product not found');
  const product = await Product.findById(req.params.id);
  if (!product) return fail(res, 404, 'Product not found');
  ok(res, { product });
};

const createSchema = {
  body: z.object({
    code: z.string().min(1).max(40),
    name: z.string().min(1),
    category: z.string().optional(),
    materialType: z.enum(['WOOD', 'IRON', 'WOOD_IRON', 'IRON_MARBLE', 'WOOD_MARBLE', 'OTHER']),
    defaultUnit: z.string().optional(),
    description: z.string().optional(),
    basePrice: z.coerce.number().nonnegative().optional(),
  }),
};

const createOne = async (req, res) => {
  const baseImages = (req.files || []).map((f) => publicUrl(f.filename));
  const product = await Product.create({ ...req.body, baseImages });
  created(res, { product });
};

const updateOne = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Product not found');
  const data = { ...req.body };
  if (req.files && req.files.length > 0) {
    const existing = await Product.findById(req.params.id);
    data.baseImages = [...(existing?.baseImages || []), ...req.files.map((f) => publicUrl(f.filename))];
  }
  const product = await Product.findByIdAndUpdate(req.params.id, data, { new: true });
  if (!product) return fail(res, 404, 'Product not found');
  ok(res, { product });
};

const removeOne = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Product not found');
  await Product.findByIdAndUpdate(req.params.id, { isActive: false });
  ok(res, null, 'Product archived');
};

module.exports = {
  list,
  getOne,
  createOne: [upload.array('images', 10), validate(createSchema), createOne],
  updateOne: [upload.array('images', 10), updateOne],
  removeOne,
};
