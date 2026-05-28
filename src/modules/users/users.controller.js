// v2 user management. Admin-only CRUD with department, module access
// permissions, and assigned showroom (parent location → sub-showroom).

const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { z } = require('zod');
const { User, Location } = require('../../models');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const generateUserId = require('../../../utils/generateUserId');

// Canonical list of modules an admin can grant access to.
// Keep in sync with frontend src/v2/lib/modules.js.
const MODULE_KEYS = [
  'dashboard',
  'showrooms',
  'pieces',
  'add_piece',
  'transfer',
  'reserve',
  'sale',
  'scan',
  'reports',
  'admin_locations',
  'admin_users',
];

const sanitize = (u) => ({
  id: u._id.toString(),
  userId: u.userId,
  email: u.email,
  fullName: u.fullName,
  phone: u.phone,
  role: u.role,
  designation: u.designation,
  department: u.department,
  permissions: u.permissions || {},
  isActive: u.isActive,
  assignedLocationId: u.assignedLocation
    ? (u.assignedLocation._id || u.assignedLocation).toString()
    : null,
  assignedLocation: u.assignedLocation && u.assignedLocation._id
    ? {
        id: u.assignedLocation._id.toString(),
        code: u.assignedLocation.code,
        name: u.assignedLocation.name,
        type: u.assignedLocation.type,
        parentId: u.assignedLocation.parent ? u.assignedLocation.parent.toString() : null,
      }
    : null,
  lastLogin: u.lastLogin,
  createdAt: u.createdAt,
});

const objectIdOrNull = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v == null || v === '') return null;
    if (!mongoose.isValidObjectId(v)) throw new z.ZodError([{ code: 'custom', message: 'Invalid id', path: [] }]);
    return v;
  });

const modulesSchema = z
  .record(z.string(), z.boolean())
  .optional()
  .transform((m) => {
    const out = {};
    if (!m) return out;
    for (const key of MODULE_KEYS) if (m[key]) out[key] = true;
    return out;
  });

const list = async (_req, res) => {
  const users = await User.find({})
    .sort({ isActive: -1, createdAt: -1 })
    .populate('assignedLocation');
  ok(res, { users: users.map(sanitize), moduleKeys: MODULE_KEYS });
};

const getOne = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'User not found');
  const user = await User.findById(req.params.id).populate('assignedLocation');
  if (!user) return fail(res, 404, 'User not found');
  ok(res, { user: sanitize(user) });
};

async function resolveAssignment({ role, assignedLocationId }) {
  if (!assignedLocationId) return { ok: true, value: null };
  const loc = await Location.findById(assignedLocationId);
  if (!loc) return { ok: false, message: 'Assigned location does not exist' };
  if (role === 'SHOWROOM_STAFF' && loc.type !== 'SHOWROOM') {
    return { ok: false, message: 'Showroom staff must be assigned to a sub-showroom' };
  }
  if (role === 'MANAGER' && loc.type !== 'LOCATION') {
    return { ok: false, message: 'Managers must be assigned to a showroom (parent), not a sub-showroom' };
  }
  return { ok: true, value: loc._id };
}

const createSchema = {
  body: z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    phone: z.string().optional().nullable(),
    role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE', 'SHOWROOM_STAFF']),
    designation: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    modules: modulesSchema,
    assignedLocationId: objectIdOrNull,
    isActive: z.boolean().optional(),
  }),
};

const createOne = async (req, res) => {
  const body = req.body;
  const email = body.email.toLowerCase();
  const dup = await User.findOne({ email });
  if (dup) return fail(res, 409, 'A user with that email already exists');

  const assignment = await resolveAssignment({
    role: body.role,
    assignedLocationId: body.assignedLocationId ?? null,
  });
  if (!assignment.ok) return fail(res, 400, assignment.message);

  const userId = await generateUserId();
  const passwordHash = await bcrypt.hash(body.password, 12);

  const user = await User.create({
    userId,
    fullName: body.fullName,
    email,
    passwordHash,
    phone: body.phone ?? null,
    role: body.role,
    designation: body.designation ?? null,
    department: body.department ?? null,
    permissions: { modules: body.modules || {} },
    assignedLocation: assignment.value,
    isActive: body.isActive ?? true,
  });
  await user.populate('assignedLocation');
  created(res, { user: sanitize(user) });
};

const updateSchema = {
  body: z.object({
    fullName: z.string().min(2).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional().nullable(),
    role: z.enum(['ADMIN', 'MANAGER', 'EMPLOYEE', 'SHOWROOM_STAFF']).optional(),
    designation: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    modules: modulesSchema,
    assignedLocationId: objectIdOrNull,
    isActive: z.boolean().optional(),
    password: z.string().min(8).optional(),
  }),
};

const updateOne = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'User not found');
  const existing = await User.findById(req.params.id);
  if (!existing) return fail(res, 404, 'User not found');

  const body = req.body;
  const updates = {};

  if (body.fullName !== undefined) updates.fullName = body.fullName;
  if (body.email !== undefined) {
    const lowered = body.email.toLowerCase();
    if (lowered !== existing.email) {
      const dup = await User.findOne({ email: lowered });
      if (dup) return fail(res, 409, 'A user with that email already exists');
      updates.email = lowered;
    }
  }
  if (body.phone !== undefined) updates.phone = body.phone;
  if (body.role !== undefined) updates.role = body.role;
  if (body.designation !== undefined) updates.designation = body.designation;
  if (body.department !== undefined) updates.department = body.department;
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.modules !== undefined) {
    updates.permissions = { ...(existing.permissions || {}), modules: body.modules || {} };
    updates.permissionsVersion = (existing.permissionsVersion || 1) + 1;
  }
  if (body.password) {
    updates.passwordHash = await bcrypt.hash(body.password, 12);
    updates.refreshTokenHash = null; // force re-login after a password reset
  }

  const nextRole = body.role ?? existing.role;
  if (body.assignedLocationId !== undefined || body.role !== undefined) {
    const desired =
      body.assignedLocationId !== undefined ? body.assignedLocationId : existing.assignedLocation;
    const assignment = await resolveAssignment({ role: nextRole, assignedLocationId: desired });
    if (!assignment.ok) return fail(res, 400, assignment.message);
    updates.assignedLocation = assignment.value;
  }

  // Safety: never let an admin demote/deactivate the last active admin.
  const demoting = updates.role && updates.role !== 'ADMIN';
  const deactivating = updates.isActive === false;
  if (existing.role === 'ADMIN' && (demoting || deactivating)) {
    const otherAdmins = await User.countDocuments({
      role: 'ADMIN',
      isActive: true,
      _id: { $ne: existing._id },
    });
    if (otherAdmins === 0) return fail(res, 400, 'Cannot demote or disable the last active admin');
  }

  const user = await User.findByIdAndUpdate(existing._id, updates, { new: true }).populate(
    'assignedLocation'
  );
  ok(res, { user: sanitize(user) });
};

const remove = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return fail(res, 404, 'User not found');
  if (req.user._id.toString() === req.params.id)
    return fail(res, 400, 'You cannot delete your own account');
  const existing = await User.findById(req.params.id);
  if (!existing) return fail(res, 404, 'User not found');
  if (existing.role === 'ADMIN') {
    const otherAdmins = await User.countDocuments({
      role: 'ADMIN',
      isActive: true,
      _id: { $ne: existing._id },
    });
    if (otherAdmins === 0) return fail(res, 400, 'Cannot delete the last active admin');
  }
  // Soft-delete: deactivate so foreign-keyed history rows survive.
  existing.isActive = false;
  existing.refreshTokenHash = null;
  await existing.save();
  ok(res, null, 'User deactivated');
};

module.exports = {
  list,
  getOne,
  createOne: [validate(createSchema), createOne],
  updateOne: [validate(updateSchema), updateOne],
  remove,
  MODULE_KEYS,
};
