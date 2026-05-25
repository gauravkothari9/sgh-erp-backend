const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../../lib/prisma');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const generateUserId = require('../../../utils/generateUserId');

const signAccess = (user) =>
  jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });

const signRefresh = (user) =>
  jwt.sign({ userId: user.id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '14d',
  });

const sanitize = (u) => ({
  id: u.id,
  email: u.email,
  name: u.fullName,
  role: u.role,
  assignedLocationId: u.assignedLocationId,
  assignedLocation: u.assignedLocation,
});

const loginSchema = {
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
};

const refreshSchema = {
  body: z.object({ refreshToken: z.string().min(1) }),
};

const login = async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { assignedLocation: true },
  });
  if (!user || !user.isActive) return fail(res, 401, 'Invalid credentials');
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return fail(res, 401, 'Invalid credentials');

  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user);
  // Store hashed refresh token so we can invalidate on logout.
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash: await bcrypt.hash(refreshToken, 10) },
  });
  ok(res, { user: sanitize(user), accessToken, refreshToken }, 'Logged in');
};

const refresh = async (req, res) => {
  const { refreshToken } = req.body;
  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    return fail(res, 401, 'Invalid refresh token');
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: { assignedLocation: true },
  });
  if (!user || !user.isActive || !user.refreshTokenHash) return fail(res, 401, 'Session ended');
  const match = await bcrypt.compare(refreshToken, user.refreshTokenHash);
  if (!match) return fail(res, 401, 'Session ended');

  const newAccess = signAccess(user);
  const newRefresh = signRefresh(user);
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash: await bcrypt.hash(newRefresh, 10) },
  });
  ok(res, { user: sanitize(user), accessToken: newAccess, refreshToken: newRefresh });
};

const logout = async (req, res) => {
  if (req.user) {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { refreshTokenHash: null },
    });
  }
  ok(res, null, 'Logged out');
};

const me = async (req, res) => ok(res, { user: sanitize(req.user) });

const adminExists = async (_req, res) => {
  const count = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
  ok(res, { exists: count > 0 });
};

const setupAdminSchema = {
  body: z.object({
    fullName: z.string().min(2, 'Name is too short'),
    email: z.string().email(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }),
};

const setupAdmin = async (req, res) => {
  const existing = await prisma.user.count({ where: { role: 'ADMIN' } });
  if (existing > 0) return fail(res, 403, 'An admin already exists');

  const { fullName, email, password } = req.body;
  const lowered = email.toLowerCase();
  const dup = await prisma.user.findUnique({ where: { email: lowered } });
  if (dup) return fail(res, 409, 'A user with that email already exists');

  const userId = await generateUserId();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      userId,
      fullName,
      email: lowered,
      passwordHash,
      role: 'ADMIN',
      designation: 'Administrator',
      department: 'Admin',
      permissions: {},
      isActive: true,
    },
    include: { assignedLocation: true },
  });

  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user);
  await prisma.user.update({
    where: { id: user.id },
    data: { refreshTokenHash: await bcrypt.hash(refreshToken, 10) },
  });
  created(res, { user: sanitize(user), accessToken, refreshToken }, 'Admin created');
};

module.exports = {
  login: [validate(loginSchema), login],
  refresh: [validate(refreshSchema), refresh],
  logout,
  me,
  adminExists,
  setupAdmin: [validate(setupAdminSchema), setupAdmin],
};
