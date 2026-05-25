const { z } = require('zod');
const prisma = require('../../lib/prisma');
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
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { code: { contains: q, mode: 'insensitive' } },
      { category: { contains: q, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);
  ok(res, { items, page, limit, total });
};

const getOne = async (req, res) => {
  const id = Number(req.params.id);
  const product = await prisma.product.findUnique({ where: { id } });
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
  const product = await prisma.product.create({
    data: { ...req.body, baseImages },
  });
  created(res, { product });
};

const updateOne = async (req, res) => {
  const id = Number(req.params.id);
  const data = { ...req.body };
  if (req.files && req.files.length > 0) {
    const existing = await prisma.product.findUnique({ where: { id } });
    const next = [...(existing?.baseImages || []), ...req.files.map((f) => publicUrl(f.filename))];
    data.baseImages = next;
  }
  const product = await prisma.product.update({ where: { id }, data });
  ok(res, { product });
};

const removeOne = async (req, res) => {
  const id = Number(req.params.id);
  await prisma.product.update({ where: { id }, data: { isActive: false } });
  ok(res, null, 'Product archived');
};

module.exports = {
  list,
  getOne,
  createOne: [upload.array('images', 10), validate(createSchema), createOne],
  updateOne: [upload.array('images', 10), updateOne],
  removeOne,
};
