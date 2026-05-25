// v1 auth middleware — Prisma-backed but with the same surface so existing
// routes/controllers don't need to change beyond their persistence calls.
// Attaches a Prisma User onto req.user, plus a `hasPermission()` helper.

const jwt = require('jsonwebtoken');
const prisma = require('../src/lib/prisma');
const { AppError } = require('./errorHandler');
const {
  isValidModule,
  isValidAction,
  buildEmptyPermissionsMap,
  MODULE_KEYS,
  ACTIONS,
} = require('../config/modules');

const INACTIVITY_MS =
  (parseInt(process.env.SESSION_INACTIVITY_MINUTES, 10) || 60) * 60 * 1000;

// Attach helper methods to the plain Prisma user record so the rest of the
// code can stay terse (e.g. `req.user.hasPermission('orders', 'read')`).
const decorate = (user) => {
  if (!user) return user;
  user.hasPermission = function (moduleKey, action) {
    if (this.role === 'ADMIN') return true;
    const perms = this.permissions || {};
    return !!perms[moduleKey]?.[action];
  };
  user.isLocked = function () {
    return !!(this.lockUntil && new Date(this.lockUntil) > new Date());
  };
  user.effectivePermissions = function () {
    if (this.role === 'ADMIN') {
      const map = buildEmptyPermissionsMap();
      for (const key of MODULE_KEYS) for (const a of ACTIONS) map[key][a] = true;
      return map;
    }
    const map = buildEmptyPermissionsMap();
    const stored = this.permissions || {};
    for (const key of MODULE_KEYS) {
      if (stored[key]) for (const a of ACTIONS) map[key][a] = !!stored[key][a];
    }
    return map;
  };
  return user;
};

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return next(new AppError('Not authorized. No token provided.', 401));

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return next(new AppError('Session expired. Please sign in again.', 401));
  }

  // v1 tokens carry `id`; v2 tokens carry `userId`. Accept either.
  const idRaw = decoded.id ?? decoded.userId;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) return next(new AppError('Invalid token payload.', 401));

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return next(new AppError('The user belonging to this token no longer exists.', 401));
  if (!user.isActive) return next(new AppError('Your account has been deactivated. Contact an administrator.', 403));

  decorate(user);
  if (user.isLocked()) return next(new AppError('Your account is temporarily locked. Try again later.', 403));

  // Inactivity timeout (skipped for rememberMe tokens).
  const isRememberMe = decoded && decoded.rm === 1;
  if (
    !isRememberMe &&
    user.lastActiveAt &&
    Date.now() - new Date(user.lastActiveAt).getTime() > INACTIVITY_MS
  ) {
    return next(new AppError('Session timed out due to inactivity. Please sign in again.', 401));
  }

  if (
    typeof decoded.pv === 'number' &&
    typeof user.permissionsVersion === 'number' &&
    decoded.pv !== user.permissionsVersion
  ) {
    res.set('X-Permissions-Stale', '1');
  }

  // Touch lastActiveAt asynchronously — don't block the request.
  prisma.user
    .update({ where: { id: user.id }, data: { lastActiveAt: new Date() } })
    .catch(() => {});

  req.user = user;
  next();
};

// Map legacy PascalCase role strings the v1 routes use → Prisma enum values.
const ROLE_ALIAS = {
  Admin: 'ADMIN',
  Employee: 'EMPLOYEE',
  Manager: 'MANAGER',
  ShowroomStaff: 'SHOWROOM_STAFF',
};

const authorize = (...roles) => (req, res, next) => {
  const allowed = roles.map((r) => ROLE_ALIAS[r] || r);
  if (!allowed.includes(req.user.role)) {
    return next(new AppError(`Role '${req.user.role}' is not authorized to perform this action.`, 403));
  }
  next();
};

const requirePermission = (moduleKey, action) => {
  if (!isValidModule(moduleKey)) throw new Error(`requirePermission: unknown module "${moduleKey}"`);
  if (!isValidAction(action)) throw new Error(`requirePermission: unknown action "${action}"`);
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Not authenticated.', 401));
    if (req.user.hasPermission(moduleKey, action)) return next();
    return next(new AppError(`Access denied. Missing '${action}' permission on '${moduleKey}'.`, 403));
  };
};

const optionalAuth = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const idRaw = decoded.id ?? decoded.userId;
      const id = Number(idRaw);
      if (Number.isFinite(id)) {
        const u = await prisma.user.findUnique({ where: { id } });
        if (u) req.user = decorate(u);
      }
    } catch {
      // ignore
    }
  }
  next();
};

module.exports = { protect, authorize, requirePermission, optionalAuth, decorate };
