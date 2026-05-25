const { z } = require('zod');
const prisma = require('../../lib/prisma');
const { ok, created } = require('../../lib/response');
const { validate } = require('../../lib/validate');

const list = async (req, res) => {
  const { type } = req.query;
  const where = {};
  if (type) where.type = type;

  const locations = await prisma.location.findMany({
    where,
    orderBy: [{ type: 'asc' }, { code: 'asc' }],
    include: { children: { orderBy: { code: 'asc' } }, parent: true },
  });

  // For convenience, also expose a clean two-level hierarchy.
  const parents = locations.filter((l) => l.type === 'LOCATION');
  const hierarchy = parents.map((p) => ({
    ...p,
    children: locations.filter((c) => c.parentId === p.id),
  }));

  ok(res, { locations, hierarchy });
};

const getOne = async (req, res) => {
  const id = Number(req.params.id);
  const location = await prisma.location.findUnique({
    where: { id },
    include: { children: true, parent: true },
  });
  if (!location) return res.status(404).json({ success: false, message: 'Not found' });
  ok(res, { location });
};

const createSchema = {
  body: z.object({
    code: z.string().min(1).max(40),
    name: z.string().min(1),
    type: z.enum(['LOCATION', 'SHOWROOM', 'VIRTUAL']),
    parentId: z.number().int().optional().nullable(),
  }),
};

const createOne = async (req, res) => {
  const data = req.body;
  const location = await prisma.location.create({ data });
  created(res, { location });
};

const updateSchema = {
  body: z.object({
    name: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    parentId: z.number().int().nullable().optional(),
  }),
};

const updateOne = async (req, res) => {
  const id = Number(req.params.id);
  const location = await prisma.location.update({ where: { id }, data: req.body });
  ok(res, { location });
};

module.exports = {
  list,
  getOne,
  createOne: [validate(createSchema), createOne],
  updateOne: [validate(updateSchema), updateOne],
};
