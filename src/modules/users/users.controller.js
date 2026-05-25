// v2 user management. Admin-only CRUD with department, module access
// permissions, and assigned showroom (parent location → sub-showroom).

const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../../lib/prisma');
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
  id: u.id,
  userId: u.userId,
  email: u.email,
  fullName: u.fullName,
  phone: u.phone,
  role: u.role,
  designation: u.designation,
  department: u.department,
  permissions: u.permissions || {},
  isActive: u.isActive,
  assignedLocationId: u.assignedLocationId,
  assignedLocation: u.assignedLocation
    ? {
        id: u.assignedLocation.id,
        code: u.assignedLocation.code,
        name: u.assignedLocation.name,
        type: u.assignedLocation.type,
        parentId: u.assignedLocation.parentId,
      }
    : null,
  lastLogin: u.lastLogin,
  createdAt: u.createdAt,
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
  const users = await prisma.user.findMany({
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    include: { assignedLocation: true },
  });
  ok(res, { users: users.map(sanitize), moduleKeys: MODULE_KEYS });
};

const getOne = async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({
    where: { id },
    include: { assignedLocation: true },
  });
  if (!user) return fail(res, 404, 'User not found');
  ok(res, { user: sanitize(user) });
};

// Validate that an assignedLocationId, when provided, exists and that the
// role / location-type combination makes sense.
async function resolveAssignment({ role, assignedLocationId }) {
  if (assignedLocationId == null) return { ok: true, value: null };
  const loc = await prisma.location.findUnique({ where: { id: assignedLocationId } });
  if (!loc) return { ok: false, message: 'Assigned location does not exist' };
  if (role === 'SHOWROOM_STAFF' && loc.type !== 'SHOWROOM') {
    return { ok: false, message: 'Showroom staff must be assigned to a sub-showroom' };
  }
  if (role === 'MANAGER' && loc.type !== 'LOCATION') {
    return { ok: false, message: 'Managers must be assigned to a showroom (parent), not a sub-showroom' };
  }
  return { ok: true, value: assignedLocationId };
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
    assignedLocationId: z.number().int().nullable().optional(),
    isActive: z.boolean().optional(),
  }),
};

const createOne = async (req, res) => {
  const body = req.body;
  const email = body.email.toLowerCase();
  const dup = await prisma.user.findUnique({ where: { email } });
  if (dup) return fail(res, 409, 'A user with that email already exists');

  const assignment = await resolveAssignment({
    role: body.role,
    assignedLocationId: body.assignedLocationId ?? null,
  });
  if (!assignment.ok) return fail(res, 400, assignment.message);

  const userId = await generateUserId();
  const passwordHash = await bcrypt.hash(body.password, 12);

  const user = await prisma.user.create({
    data: {
      userId,
      fullName: body.fullName,
      email,
      passwordHash,
      phone: body.phone ?? null,
      role: body.role,
      designation: body.designation ?? null,
      department: body.department ?? null,
      permissions: { modules: body.modules || {} },
      assignedLocationId: assignment.value,
      isActive: body.isActive ?? true,
    },
    include: { assignedLocation: true },
  });
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
    assignedLocationId: z.number().int().nullable().optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8).optional(),
  }),
};

const updateOne = async (req, res) => {
  const id = Number(req.params.id);
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return fail(res, 404, 'User not found');

  const body = req.body;
  const data = {};

  if (body.fullName !== undefined) data.fullName = body.fullName;
  if (body.email !== undefined) {
    const lowered = body.email.toLowerCase();
    if (lowered !== existing.email) {
      const dup = await prisma.user.findUnique({ where: { email: lowered } });
      if (dup) return fail(res, 409, 'A user with that email already exists');
      data.email = lowered;
    }
  }
  if (body.phone !== undefined) data.phone = body.phone;
  if (body.role !== undefined) data.role = body.role;
  if (body.designation !== undefined) data.designation = body.designation;
  if (body.department !== undefined) data.department = body.department;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  if (body.modules !== undefined) {
    data.permissions = { ...(existing.permissions || {}), modules: body.modules || {} };
    data.permissionsVersion = (existing.permissionsVersion || 1) + 1;
  }
  if (body.password) {
    data.passwordHash = await bcrypt.hash(body.password, 12);
    data.refreshTokenHash = null; // force re-login after a password reset
  }

  const nextRole = body.role ?? existing.role;
  if (body.assignedLocationId !== undefined || body.role !== undefined) {
    const desired = body.assignedLocationId !== undefined ? body.assignedLocationId : existing.assignedLocationId;
    const assignment = await resolveAssignment({ role: nextRole, assignedLocationId: desired });
    if (!assignment.ok) return fail(res, 400, assignment.message);
    data.assignedLocationId = assignment.value;
  }

  // Safety: never let an admin demote/deactivate the last active admin.
  const demoting = data.role && data.role !== 'ADMIN';
  const deactivating = data.isActive === false;
  if (existing.role === 'ADMIN' && (demoting || deactivating)) {
    const otherAdmins = await prisma.user.count({
      where: { role: 'ADMIN', isActive: true, NOT: { id } },
    });
    if (otherAdmins === 0) return fail(res, 400, 'Cannot demote or disable the last active admin');
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    include: { assignedLocation: true },
  });
  ok(res, { user: sanitize(user) });
};

const remove = async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.id === id) return fail(res, 400, 'You cannot delete your own account');
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) return fail(res, 404, 'User not found');
  if (existing.role === 'ADMIN') {
    const otherAdmins = await prisma.user.count({
      where: { role: 'ADMIN', isActive: true, NOT: { id } },
    });
    if (otherAdmins === 0) return fail(res, 400, 'Cannot delete the last active admin');
  }
  // Soft-delete: deactivate so foreign-keyed history rows survive.
  await prisma.user.update({
    where: { id },
    data: { isActive: false, refreshTokenHash: null },
  });
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
