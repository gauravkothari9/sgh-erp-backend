// v2 JWT auth middleware. Verifies access token, attaches req.user from
// Postgres. Use `requireRole('ADMIN', 'MANAGER')` to gate routes.

const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { fail } = require('../lib/response');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 401, 'Authentication required');

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { assignedLocation: true },
    });
    if (!user || !user.isActive) return fail(res, 401, 'User inactive or missing');
    req.user = user;
    next();
  } catch {
    return fail(res, 401, 'Invalid or expired token');
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, 'Authentication required');
    if (!roles.includes(req.user.role)) return fail(res, 403, 'Forbidden');
    next();
  };
}

// Resolve which locations the user is allowed to act on. ADMIN → all,
// MANAGER → assigned parent + its children, SHOWROOM_STAFF → assigned showroom.
async function scopedLocationIds(user) {
  if (user.role === 'ADMIN') return null; // null = no restriction
  if (!user.assignedLocationId) return [];
  if (user.role === 'MANAGER') {
    const children = await prisma.location.findMany({
      where: { parentId: user.assignedLocationId },
      select: { id: true },
    });
    return [user.assignedLocationId, ...children.map((c) => c.id)];
  }
  return [user.assignedLocationId];
}

module.exports = { authenticate, requireRole, scopedLocationIds };
