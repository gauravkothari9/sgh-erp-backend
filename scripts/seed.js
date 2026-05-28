// Minimal MongoDB seed for SGH ERP.
//
// Run with:  node scripts/seed.js
//
// Idempotent — safe to re-run. Creates:
//   • Two parent showrooms (Jhalamand + Kakani) so the UI has somewhere to go.
//   • The DISPATCHED virtual location that v2 sales needs.
//   • A bootstrap admin user IF none exists. Override SEED_ADMIN_EMAIL /
//     SEED_ADMIN_PASSWORD in .env to control credentials.

require('dotenv').config({
  path: require('path').join(__dirname, '..', process.env.NODE_ENV === 'development' ? '.env.development' : '.env'),
});
const bcrypt = require('bcryptjs');
const { connect, mongoose } = require('../src/lib/db');
const { User, Location } = require('../src/models');
const generateUserId = require('../utils/generateUserId');

async function upsertLocation(payload) {
  const existing = await Location.findOne({ code: payload.code });
  if (existing) {
    console.log(`• Location ${payload.code} already exists — skipped`);
    return existing;
  }
  const loc = await Location.create(payload);
  console.log(`✓ Created location ${payload.code} (${payload.name})`);
  return loc;
}

async function seedLocations() {
  const dispatched = await upsertLocation({
    code: 'DISPATCHED',
    name: 'Dispatched (virtual)',
    type: 'VIRTUAL',
    isActive: true,
  });

  const jhl = await upsertLocation({
    code: 'JHL',
    name: 'Jhalamand',
    type: 'LOCATION',
    isActive: true,
  });

  const kkn = await upsertLocation({
    code: 'KKN',
    name: 'Kakani',
    type: 'LOCATION',
    isActive: true,
  });

  return { dispatched, jhl, kkn };
}

async function seedAdmin() {
  const userCount = await User.countDocuments();
  if (userCount > 0) {
    console.log(`• ${userCount} user(s) already exist — bootstrap admin skipped`);
    return;
  }
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@sgh.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme-1234';
  const userId = await generateUserId();
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await User.create({
    userId,
    fullName: 'Bootstrap Admin',
    email,
    passwordHash,
    role: 'ADMIN',
    designation: 'Administrator',
    department: 'Admin',
    permissions: { modules: {} },
    isActive: true,
  });
  console.log(`✓ Created bootstrap admin (${admin.email})`);
  console.log(`  → temporary password: ${password}  (change it immediately!)`);
}

async function main() {
  await connect();
  await seedLocations();
  await seedAdmin();
}

if (require.main === module) {
  main()
    .then(() => mongoose.disconnect())
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
