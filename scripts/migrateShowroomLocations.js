/**
 * One-off migration: showroom products used to be one document per zone, with
 * a flat `branch` / `zone` / `quantity`. They now carry a `locations` array so
 * the same item can be stocked in several zones at once.
 *
 * This backfills `locations` (and `totalQty`) for any document that predates
 * the change. It is idempotent — documents that already have locations are left
 * alone — so it is safe to re-run.
 *
 *   node scripts/migrateShowroomLocations.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const ShowroomProduct = require('../models/ShowroomProduct');

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set — aborting.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('Connected. Scanning showroom products…');

  const legacy = await ShowroomProduct.find({
    $or: [{ locations: { $exists: false } }, { locations: { $size: 0 } }],
  });

  let migrated = 0;
  let skipped = 0;

  for (const p of legacy) {
    if (!p.branch || !p.zone) { skipped += 1; continue; }
    p.locations = [{ branch: p.branch, zone: p.zone, qty: Math.max(p.quantity || 1, 1) }];
    await p.save(); // pre-save recomputes totalQty and the legacy mirrors
    migrated += 1;
  }

  console.log(`Done. Migrated ${migrated}, skipped ${skipped} (missing branch/zone).`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
