/**
 * Database Seeder — creates an initial Admin user
 * Run with: node utils/seed.js  (or `node backend/utils/seed.js` from repo root)
 */
const path = require('path');
const envSuffix = process.env.NODE_ENV === 'development' ? '.development' : '';
require('dotenv').config({ path: path.join(__dirname, '..', `.env${envSuffix}`) });
const mongoose = require('mongoose');
const User = require('../models/User');

const seed = async () => {
  try {
    // Use the same env var name (MONGODB_URI) as server.js/.env — falls back to
    // the SAME underscore-named DB so this script never silently creates a
    // stray 'sgh-erp' (hyphenated) database.
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sgh_erp';
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    // Check if admin already exists
    const existing = await User.findOne({ email: 'admin@sghcrafts.com' });
    if (existing) {
      console.log('ℹ️  Admin user already exists. Skipping seed.');
      process.exit(0);
    }

    // Create default admin
    await User.create({
      userId: 'SGH-U-0001',
      fullName: 'SGH Admin',
      designation: 'Administrator',
      department: 'Admin',
      email: 'admin@sghcrafts.com',
      password: 'SGH@admin2025',
      role: 'Admin',
    });

    console.log('✅ Admin user created:');
    console.log(`   User ID:  SGH-U-0001`);
    console.log(`   Email:    admin@sghcrafts.com`);
    console.log(`   Password: SGH@admin2025`);
    console.log(`   Role:     Admin`);
    console.log('\n⚠️  IMPORTANT: Change the password immediately after first login!');

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
};

seed();
