// Load env vars from .env.development when NODE_ENV=development, else .env.
// PM2 boots with NODE_ENV=production (set in ecosystem.config.js) → reads .env.
// `npm run dev` sets NODE_ENV=development → reads .env.development.
const path = require('path');
const envSuffix = process.env.NODE_ENV === 'development' ? '.development' : '';
require('dotenv').config({ path: path.join(__dirname, `.env${envSuffix}`) });
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { errorHandler, notFound } = require('./middleware/errorHandler');

// Route imports — v1 office
const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const orderRoutes = require('./routes/orderRoutes');
const buyerCatalogueRoutes = require('./routes/buyerCatalogueRoutes');
const showroomProductRoutes = require('./routes/showroomProductRoutes');

// v2 — Showroom Inventory module
const v2AuthRoutes = require('./src/modules/auth/auth.routes');
const v2UserRoutes = require('./src/modules/users/users.routes');
const v2LocationRoutes = require('./src/modules/locations/locations.routes');
const v2ProductRoutes = require('./src/modules/products/products.routes');
const v2InstanceRoutes = require('./src/modules/instances/instances.routes');
const v2StockRoutes = require('./src/modules/stock/stock.routes');
const v2ReservationRoutes = require('./src/modules/reservations/reservations.routes');
const v2SalesRoutes = require('./src/modules/sales/sales.routes');
const v2ReportRoutes = require('./src/modules/reports/reports.routes');

const app = express();

// ─── Trust proxy ────────────────────────────────────────────────────────────
// Behind Cloudflare Tunnel, the real client IP arrives in X-Forwarded-For.
// Trust 1 hop (the tunnel) so express-rate-limit can identify users correctly.
app.set('trust proxy', 1);

// ─── Security Middleware ────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// ─── CORS ───────────────────────────────────────────────────────────────────
// Allow:
//  - the production frontend (CLIENT_URL)
//  - the Vite dev server (localhost:5173)
//  - any Vercel preview deployment for this project (sghcrafts-*.vercel.app)
const allowedOrigin = (origin) => {
  if (!origin) return true;                                                       // server-to-server, curl
  if (origin === process.env.CLIENT_URL) return true;                             // prod
  if (origin === 'http://localhost:5173') return true;                            // local dev
  if (/^https:\/\/sghcrafts(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) return true; // any vercel preview
  return false;
};

app.use(cors({
  origin: (origin, cb) => allowedOrigin(origin) ? cb(null, true) : cb(new Error('CORS: ' + origin)),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body Parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// ─── Static Files (Uploads) ─────────────────────────────────────────────────
// Resolve UPLOAD_PATH relative to backend/ so dev (./uploads-dev) and prod
// (./uploads) serve from the right folder.
const uploadDir = path.resolve(__dirname, process.env.UPLOAD_PATH || './uploads');
app.use('/uploads', express.static(uploadDir));

// ─── Health check & Root ────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ success: true, message: 'SGH ERP Backend is running' });
});

app.get('/api/v1', (req, res) => {
  res.json({
    success: true,
    message: 'SGH ERP API v1 is active',
    version: '1.0.0',
  });
});

app.get('/api/v1/health', (req, res) => {
  res.json({
    success: true,
    message: 'SGH ERP API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes (v1 — Postgres) ─────────────────────────────────────────────
// NOTE: auth + customers are fully ported. orders, buyer-catalogue, and
// showroom-products are mounted but return 501 — see TODO in their
// controller files for the porting plan.
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/buyer-catalogue', buyerCatalogueRoutes);
app.use('/api/v1/showroom-products', showroomProductRoutes);

// ─── API Routes (v2 — Postgres / Prisma showroom inventory) ─────────────────
app.use('/api/v2/auth', v2AuthRoutes);
app.use('/api/v2/users', v2UserRoutes);
app.use('/api/v2/locations', v2LocationRoutes);
app.use('/api/v2/products', v2ProductRoutes);
app.use('/api/v2/instances', v2InstanceRoutes);
app.use('/api/v2/stock', v2StockRoutes);
app.use('/api/v2/reservations', v2ReservationRoutes);
app.use('/api/v2/sales', v2SalesRoutes);
app.use('/api/v2/reports', v2ReportRoutes);

// ─── Error Handling ─────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ─── Start Server (skipped on Vercel serverless) ────────────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  const server = app.listen(PORT, () => {
    console.log(`🚀 SGH ERP Server running on port ${PORT} [${process.env.NODE_ENV}]`);
  });

  process.on('unhandledRejection', (err) => {
    console.error('⚠️  Unhandled Rejection:', err);
    if (process.env.NODE_ENV === 'production') {
      server.close(() => process.exit(1));
    }
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Closing server...');
    server.close(() => process.exit(0));
  });
}

module.exports = app;
