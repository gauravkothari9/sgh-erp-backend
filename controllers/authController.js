const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');
const { AppError } = require('../middleware/errorHandler');
const { successResponse, createdResponse } = require('../utils/apiResponse');
const generateUserId = require('../utils/generateUserId');
const {
  MODULES,
  ACTIONS,
  MODULE_KEYS,
  buildEmptyPermissionsMap,
  getDepartments,
} = require('../config/modules');

// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000; // 15 min lockout after MAX attempts
const MIN_LEN_REGULAR = 8;
const MIN_LEN_ADMIN = 12;

// ─── Role helpers ────────────────────────────────────────────────────────────
// Frontend speaks PascalCase ('Admin' / 'Employee'). Prisma stores the enum
// values ('ADMIN' / 'EMPLOYEE'). Translate at the edges.
const FROM_FRONTEND_ROLE = {
  Admin: 'ADMIN',
  Employee: 'EMPLOYEE',
  Manager: 'MANAGER',
  ShowroomStaff: 'SHOWROOM_STAFF',
};
const TO_FRONTEND_ROLE = {
  ADMIN: 'Admin',
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  SHOWROOM_STAFF: 'ShowroomStaff',
};
const toDbRole = (r) => FROM_FRONTEND_ROLE[r] || r;
const toFrontendRole = (r) => TO_FRONTEND_ROLE[r] || r;

// ─── Password strength rules ─────────────────────────────────────────────────
const validatePasswordStrength = (password, role) => {
  if (typeof password !== 'string') return 'Password is required';
  const dbRole = toDbRole(role);
  if (dbRole === 'ADMIN') {
    if (password.length < MIN_LEN_ADMIN) return `Admin password must be at least ${MIN_LEN_ADMIN} characters`;
    if (!/[A-Z]/.test(password)) return 'Admin password must contain an uppercase letter';
    if (!/[a-z]/.test(password)) return 'Admin password must contain a lowercase letter';
    if (!/[0-9]/.test(password)) return 'Admin password must contain a digit';
    if (!/[^A-Za-z0-9]/.test(password)) return 'Admin password must contain a symbol';
  } else {
    if (password.length < MIN_LEN_REGULAR) return `Password must be at least ${MIN_LEN_REGULAR} characters`;
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return 'Password must include letters and digits';
    }
  }
  return null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const effectivePermissions = (user) => {
  if (user.role === 'ADMIN') {
    const map = buildEmptyPermissionsMap();
    for (const key of MODULE_KEYS) for (const a of ACTIONS) map[key][a] = true;
    return map;
  }
  const stored = user.permissions || {};
  const map = buildEmptyPermissionsMap();
  for (const key of MODULE_KEYS) {
    if (stored[key]) for (const a of ACTIONS) map[key][a] = !!stored[key][a];
  }
  return map;
};

// Normalize an incoming permissions object into the canonical shape —
// silently drops unknown modules/actions and coerces values to booleans.
const sanitizePermissions = (input) => {
  const out = buildEmptyPermissionsMap();
  if (!input || typeof input !== 'object') return out;
  for (const moduleKey of MODULE_KEYS) {
    const incoming = input[moduleKey];
    if (!incoming || typeof incoming !== 'object') continue;
    for (const action of ACTIONS) {
      out[moduleKey][action] = !!incoming[action];
    }
  }
  return out;
};

// When `rememberMe` is true the token has no expiry; otherwise it's the
// short session window plus the inactivity timeout in middleware/auth.js.
const signToken = (user, rememberMe = false) => {
  const payload = {
    id: user.id,
    role: user.role,
    pv: user.permissionsVersion,
    rm: rememberMe ? 1 : 0,
  };
  const options = {};
  if (!rememberMe) options.expiresIn = process.env.JWT_EXPIRES_IN || '12h';
  return jwt.sign(payload, process.env.JWT_SECRET, options);
};

// Frontend-shaped user payload. _id is preserved as the integer id for code
// that already uses `user._id`; `id` is also exposed for cleaner consumers.
const buildAuthPayload = (user) => ({
  _id: user.id,
  id: user.id,
  userId: user.userId,
  fullName: user.fullName,
  email: user.email,
  role: toFrontendRole(user.role),
  designation: user.designation,
  department: user.department,
  permissions: effectivePermissions(user),
  permissionsVersion: user.permissionsVersion,
  avatar: user.avatar,
  phone: user.phone,
  isActive: user.isActive,
});

const sendTokenResponse = (user, statusCode, res, rememberMe = false) => {
  const token = signToken(user, rememberMe);
  res.status(statusCode).json({
    success: true,
    token,
    rememberMe,
    data: { user: buildAuthPayload(user) },
  });
};

const countActiveAdmins = () =>
  prisma.user.count({ where: { role: 'ADMIN', isActive: true } });

// ─── @GET /api/v1/auth/bootstrap-status ──────────────────────────────────────
exports.getBootstrapStatus = async (req, res) => {
  const userCount = await prisma.user.count();
  successResponse(res, { canBootstrap: userCount === 0 });
};

// ─── @POST /api/v1/auth/bootstrap-admin ──────────────────────────────────────
exports.bootstrapAdmin = async (req, res) => {
  const existingCount = await prisma.user.count();
  if (existingCount > 0) {
    throw new AppError(
      'Bootstrap is disabled — an account already exists. Ask an administrator to create your user.',
      403
    );
  }

  const { fullName, email, password } = req.body;
  if (!fullName || !email || !password) {
    throw new AppError('Full name, email and password are required', 400);
  }

  const strengthError = validatePasswordStrength(password, 'Admin');
  if (strengthError) throw new AppError(strengthError, 400);

  const userId = await generateUserId();
  const passwordHash = await bcrypt.hash(password, 12);
  const newUser = await prisma.user.create({
    data: {
      userId,
      fullName,
      email: email.toLowerCase(),
      passwordHash,
      role: 'ADMIN',
      designation: 'Administrator',
      department: 'Admin',
      permissions: buildEmptyPermissionsMap(),
    },
  });

  sendTokenResponse(newUser, 201, res, false);
};

// ─── @POST /api/v1/auth/login ─────────────────────────────────────────────────
exports.login = async (req, res) => {
  const { email, password, rememberMe } = req.body;
  if (!email || !password) throw new AppError('Please provide email and password', 400);

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new AppError('Invalid email or password', 401);

  if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
    throw new AppError(
      'Account locked due to too many failed login attempts. Try again later.',
      423
    );
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    const next = (user.failedLoginAttempts || 0) + 1;
    const data = { failedLoginAttempts: next };
    if (next >= MAX_LOGIN_ATTEMPTS) {
      data.lockUntil = new Date(Date.now() + LOCK_WINDOW_MS);
      data.failedLoginAttempts = 0;
    }
    await prisma.user.update({ where: { id: user.id }, data });
    throw new AppError('Invalid email or password', 401);
  }

  if (!user.isActive) {
    throw new AppError('Your account has been deactivated. Contact an administrator.', 403);
  }

  const fresh = await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockUntil: null,
      lastLogin: new Date(),
      lastActiveAt: new Date(),
    },
  });

  sendTokenResponse(fresh, 200, res, !!rememberMe);
};

// ─── @POST /api/v1/auth/logout ───────────────────────────────────────────────
exports.logout = async (req, res) => {
  successResponse(res, {}, 'Logged out');
};

// ─── @GET /api/v1/auth/me ────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  successResponse(res, { user: buildAuthPayload(user) });
};

// ─── @PUT /api/v1/auth/update-password ──────────────────────────────────────
exports.updatePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError('User not found', 404);

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new AppError('Current password is incorrect', 401);

  const strengthError = validatePasswordStrength(newPassword, user.role);
  if (strengthError) throw new AppError(strengthError, 400);

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash },
  });

  sendTokenResponse(updated, 200, res);
};

// ─── @GET /api/v1/auth/modules ───────────────────────────────────────────────
exports.getModules = async (req, res) => {
  successResponse(res, {
    modules: MODULES,
    actions: ACTIONS,
    departments: getDepartments(),
  });
};

// ─── Admin: User CRUD ────────────────────────────────────────────────────────

// @POST /api/v1/auth/users
exports.createUser = async (req, res) => {
  const {
    fullName,
    email,
    password,
    role,
    permissions,
    phone,
    designation,
    department,
  } = req.body;

  if (!fullName || !email || !password) {
    throw new AppError('Full name, email and password are required', 400);
  }

  const effectiveRole = role === 'Admin' ? 'Admin' : 'Employee';
  const strengthError = validatePasswordStrength(password, effectiveRole);
  if (strengthError) throw new AppError(strengthError, 400);

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) throw new AppError('A user with this email already exists', 409);

  const finalDesignation =
    effectiveRole === 'Admin' ? (designation || 'Administrator') : designation;
  const finalDepartment =
    effectiveRole === 'Admin' ? (department || 'Admin') : department;

  if (effectiveRole === 'Employee' && (!finalDesignation || !finalDepartment)) {
    throw new AppError('Designation and department are required for Employees', 400);
  }

  const userId = await generateUserId();
  const passwordHash = await bcrypt.hash(password, 12);
  const newUser = await prisma.user.create({
    data: {
      userId,
      fullName,
      email: email.toLowerCase(),
      passwordHash,
      role: toDbRole(effectiveRole),
      designation: finalDesignation,
      department: finalDepartment,
      permissions:
        effectiveRole === 'Employee'
          ? sanitizePermissions(permissions)
          : buildEmptyPermissionsMap(),
      phone,
    },
  });

  createdResponse(res, { user: buildAuthPayload(newUser) }, 'User created successfully');
};

exports.register = exports.createUser;

// @GET /api/v1/auth/users
exports.getUsers = async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  successResponse(res, {
    users: users.map(buildAuthPayload),
    count: users.length,
  });
};

// @GET /api/v1/auth/users/:id
exports.getUser = async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } });
  if (!user) throw new AppError('User not found', 404);
  successResponse(res, { user: buildAuthPayload(user) });
};

// @PUT /api/v1/auth/users/:id
exports.updateUser = async (req, res) => {
  const id = Number(req.params.id);
  const { fullName, role, isActive, phone, designation, department } = req.body;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('User not found', 404);

  // Last-admin protection: prevent demotion or deactivation of the final Admin.
  if (user.role === 'ADMIN') {
    const adminCount = await countActiveAdmins();
    const targetRole = role ? toDbRole(role) : user.role;
    const beingDemoted = targetRole !== 'ADMIN';
    const beingDeactivated = isActive === false;
    if (adminCount <= 1 && (beingDemoted || beingDeactivated)) {
      throw new AppError('Cannot demote or deactivate the last active Admin account.', 400);
    }
  }

  const data = {};
  if (typeof fullName === 'string') data.fullName = fullName;
  if (typeof phone === 'string') data.phone = phone;
  if (typeof designation === 'string') data.designation = designation;
  if (typeof department === 'string') data.department = department;
  if (typeof isActive === 'boolean') data.isActive = isActive;

  if (role === 'Admin' || role === 'Employee') {
    const targetRole = toDbRole(role);
    const roleChanging = user.role !== targetRole;
    data.role = targetRole;
    if (roleChanging) {
      data.permissionsVersion = (user.permissionsVersion || 0) + 1;
      if (targetRole === 'ADMIN') {
        data.permissions = buildEmptyPermissionsMap();
        if (!user.designation) data.designation = 'Administrator';
        if (!user.department) data.department = 'Admin';
      }
    }
  }

  const updated = await prisma.user.update({ where: { id }, data });
  successResponse(res, { user: buildAuthPayload(updated) }, 'User updated successfully');
};

// @PUT /api/v1/auth/users/:id/permissions
exports.updateUserPermissions = async (req, res) => {
  const id = Number(req.params.id);
  const { permissions } = req.body;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('User not found', 404);

  if (user.role === 'ADMIN') {
    throw new AppError('Admin permissions cannot be edited — Admins always have full access.', 400);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      permissions: sanitizePermissions(permissions),
      permissionsVersion: (user.permissionsVersion || 0) + 1,
    },
  });

  successResponse(res, { user: buildAuthPayload(updated) }, 'Permissions updated successfully');
};

// @POST /api/v1/auth/users/:id/reset-password
exports.resetUserPassword = async (req, res) => {
  const id = Number(req.params.id);
  const { newPassword } = req.body;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('User not found', 404);

  const strengthError = validatePasswordStrength(newPassword, user.role);
  if (strengthError) throw new AppError(strengthError, 400);

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id },
    data: { passwordHash, failedLoginAttempts: 0, lockUntil: null },
  });

  successResponse(res, {}, 'Password reset successfully');
};

// @DELETE /api/v1/auth/users/:id
exports.deleteUser = async (req, res) => {
  const id = Number(req.params.id);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new AppError('User not found', 404);

  if (id === req.user.id) throw new AppError('You cannot delete your own account.', 400);

  if (user.role === 'ADMIN') {
    const adminCount = await countActiveAdmins();
    if (adminCount <= 1) {
      throw new AppError('Cannot delete the last active Admin account.', 400);
    }
  }

  await prisma.user.delete({ where: { id } });
  successResponse(res, {}, 'User deleted successfully');
};
