// JWT auth middleware. Verifies access token, attaches req.user from MongoDB.
// Use `requireRole('ADMIN', 'MANAGER')` to gate routes.

const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { User, Location } = require('../models');
const { fail } = require('../lib/response');

async function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return fail(res, 401, 'Authentication required');

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!mongoose.isValidObjectId(payload.userId)) return fail(res, 401, 'Invalid token');
    const user = await User.findById(payload.userId).populate('assignedLocation');
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
// Returns null = no restriction, [] = no access, or an array of ObjectIds.
async function scopedLocationIds(user) {
  if (user.role === 'ADMIN') return null;
  if (!user.assignedLocation) return [];
  const assignedId = user.assignedLocation._id || user.assignedLocation;
  if (user.role === 'MANAGER') {
    const children = await Location.find({ parent: assignedId }).select('_id');
    return [assignedId, ...children.map((c) => c._id)];
  }
  return [assignedId];
}

module.exports = { authenticate, requireRole, scopedLocationIds };
