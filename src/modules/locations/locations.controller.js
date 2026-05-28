const mongoose = require('mongoose');
const { z } = require('zod');
const { Location } = require('../../models');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');

// Hydrate the parent/children references so the frontend can rely on
// `parent`, `parentId`, and `children` on every Location response.
const hydrate = (loc, allLocs) => {
  const idStr = loc._id.toString();
  const obj = loc.toObject ? loc.toObject() : loc;
  return {
    id: idStr,
    code: obj.code,
    name: obj.name,
    type: obj.type,
    parentId: obj.parent ? obj.parent.toString() : null,
    isActive: obj.isActive,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
    children: allLocs
      .filter((l) => l.parent && l.parent.toString() === idStr)
      .map((c) => ({
        id: c._id.toString(),
        code: c.code,
        name: c.name,
        type: c.type,
        parentId: idStr,
        isActive: c.isActive,
      })),
  };
};

const list = async (req, res) => {
  const where = {};
  if (req.query.type) where.type = req.query.type;
  const all = await Location.find({}).sort({ type: 1, code: 1 });
  const filtered = req.query.type ? all.filter((l) => l.type === req.query.type) : all;
  const locations = filtered.map((l) => hydrate(l, all));
  const hierarchy = all
    .filter((l) => l.type === 'LOCATION')
    .map((p) => hydrate(p, all));
  ok(res, { locations, hierarchy });
};

const getOne = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Not found');
  const location = await Location.findById(req.params.id);
  if (!location) return fail(res, 404, 'Not found');
  const all = await Location.find({});
  ok(res, { location: hydrate(location, all) });
};

const createSchema = {
  body: z.object({
    code: z.string().min(1).max(40),
    name: z.string().min(1),
    type: z.enum(['LOCATION', 'SHOWROOM', 'VIRTUAL']),
    parentId: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => (v && mongoose.isValidObjectId(v) ? v : null)),
  }),
};

const createOne = async (req, res) => {
  const { code, name, type, parentId } = req.body;
  const location = await Location.create({ code, name, type, parent: parentId || null });
  const all = await Location.find({});
  created(res, { location: hydrate(location, all) });
};

const updateSchema = {
  body: z.object({
    name: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    parentId: z
      .union([z.string(), z.null()])
      .optional()
      .transform((v) => {
        if (v === null) return null;
        if (v === undefined) return undefined;
        return mongoose.isValidObjectId(v) ? v : null;
      }),
  }),
};

const updateOne = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'Not found');
  const updates = {};
  if (req.body.name !== undefined) updates.name = req.body.name;
  if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;
  if (req.body.parentId !== undefined) updates.parent = req.body.parentId;

  const location = await Location.findByIdAndUpdate(req.params.id, updates, { new: true });
  if (!location) return fail(res, 404, 'Not found');
  const all = await Location.find({});
  ok(res, { location: hydrate(location, all) });
};

module.exports = {
  list,
  getOne,
  createOne: [validate(createSchema), createOne],
  updateOne: [validate(updateSchema), updateOne],
};
