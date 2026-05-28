const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { User } = require('../../models');
const { ok, created, fail } = require('../../lib/response');
const { validate } = require('../../lib/validate');
const generateUserId = require('../../../utils/generateUserId');

const signAccess = (user) =>
  jwt.sign({ userId: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });

const signRefresh = (user) =>
  jwt.sign({ userId: user._id.toString() }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '14d',
  });

const sanitize = (u) => ({
  id: u._id.toString(),
  email: u.email,
  name: u.fullName,
  role: u.role,
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
  const user = await User.findOne({ email: email.toLowerCase() }).populate('assignedLocation');
  if (!user || !user.isActive) return fail(res, 401, 'Invalid credentials');
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return fail(res, 401, 'Invalid credentials');

  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user);
  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  user.lastLogin = new Date();
  await user.save();
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
  const user = await User.findById(payload.userId).populate('assignedLocation');
  if (!user || !user.isActive || !user.refreshTokenHash) return fail(res, 401, 'Session ended');
  const match = await bcrypt.compare(refreshToken, user.refreshTokenHash);
  if (!match) return fail(res, 401, 'Session ended');

  const newAccess = signAccess(user);
  const newRefresh = signRefresh(user);
  user.refreshTokenHash = await bcrypt.hash(newRefresh, 10);
  await user.save();
  ok(res, { user: sanitize(user), accessToken: newAccess, refreshToken: newRefresh });
};

const logout = async (req, res) => {
  if (req.user) {
    req.user.refreshTokenHash = null;
    await req.user.save();
  }
  ok(res, null, 'Logged out');
};

const me = async (req, res) => ok(res, { user: sanitize(req.user) });

const adminExists = async (_req, res) => {
  const count = await User.countDocuments({ role: 'ADMIN', isActive: true });
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
  const existing = await User.countDocuments({ role: 'ADMIN' });
  if (existing > 0) return fail(res, 403, 'An admin already exists');

  const { fullName, email, password } = req.body;
  const lowered = email.toLowerCase();
  const dup = await User.findOne({ email: lowered });
  if (dup) return fail(res, 409, 'A user with that email already exists');

  const userId = await generateUserId();
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    userId,
    fullName,
    email: lowered,
    passwordHash,
    role: 'ADMIN',
    designation: 'Administrator',
    department: 'Admin',
    permissions: { modules: {} },
    isActive: true,
  });

  const accessToken = signAccess(user);
  const refreshToken = signRefresh(user);
  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  await user.save();
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
