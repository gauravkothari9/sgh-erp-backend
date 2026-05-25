// Minimal Postgres seed for SGH ERP.
//
// Run with:  node scripts/seed-pg.js
//
// Idempotent — safe to re-run. Creates:
//   • The DISPATCHED virtual location v2 sales needs (sales.controller.js
//     errors without it).
//   • A bootstrap admin user IF none exists. The credentials below are only
//     for local dev — override SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD in
//     your .env when seeding shared environments.

require('dotenv').config({
  path: require('path').join(__dirname, '..', process.env.NODE_ENV === 'development' ? '.env.development' : '.env'),
});
const bcrypt = require('bcryptjs');
const prisma = require('../src/lib/prisma');
const generateUserId = require('../utils/generateUserId');

async function seedDispatchedLocation() {
  const existing = await prisma.location.findUnique({ where: { code: 'DISPATCHED' } });
  if (existing) {
    console.log('• DISPATCHED location already exists — skipped');
    return existing;
  }
  const loc = await prisma.location.create({
    data: {
      code: 'DISPATCHED',
      name: 'Dispatched (virtual)',
      type: 'VIRTUAL',
      isActive: true,
    },
  });
  console.log(`✓ Created virtual location DISPATCHED (id=${loc.id})`);
  return loc;
}

async function seedAdmin() {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    console.log(`• ${userCount} user(s) already exist — bootstrap admin skipped`);
    return;
  }
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@sgh.local').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme-1234';
  const userId = await generateUserId();
  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.create({
    data: {
      userId,
      fullName: 'Bootstrap Admin',
      email,
      passwordHash,
      role: 'ADMIN',
      designation: 'Administrator',
      department: 'Admin',
      permissions: {},
      isActive: true,
    },
  });
  console.log(`✓ Created bootstrap admin (${admin.email})`);
  console.log(`  → temporary password: ${password}  (change it immediately!)`);
}

async function main() {
  await seedDispatchedLocation();
  await seedAdmin();
}

// Only run when invoked directly (not when required from elsewhere).
if (require.main === module) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
