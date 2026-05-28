const mongoose = require('mongoose');

const ROLES = ['ADMIN', 'EMPLOYEE', 'MANAGER', 'SHOWROOM_STAFF'];

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true }, // human-readable: SGH-U-0001
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    fullName: { type: String, required: true },
    phone: { type: String, default: null },
    role: { type: String, enum: ROLES, default: 'EMPLOYEE' },
    designation: { type: String, default: null },
    department: { type: String, default: null },
    permissions: { type: mongoose.Schema.Types.Mixed, default: {} },
    permissionsVersion: { type: Number, default: 1 },
    isActive: { type: Boolean, default: true },
    avatar: { type: String, default: null },
    lastLogin: { type: Date, default: null },
    lastActiveAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    refreshTokenHash: { type: String, default: null },
    assignedLocation: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null, index: true },
  },
  { timestamps: true }
);

userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', userSchema);
