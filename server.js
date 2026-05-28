// Load env vars from .env.development when NODE_ENV=development, else .env.
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
const { connect } = require('./src/lib/db');

// v1 — Office module (MongoDB)
const v1AuthRoutes = require('./routes/authRoutes');
const v1CustomerRoutes = require('./routes/customerRoutes');
const v1OrderRoutes = require('./routes/orderRoutes');
const v1BuyerCatalogueRoutes = require('./routes/buyerCatalogueRoutes');
const v1InventoryProductRoutes = require('./routes/inventoryProductRoutes');

// v2 — Showroom Inventory module (MongoDB)
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

// Behind a tunnel/proxy, trust the first hop so rate-limit sees real IPs.
app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { success: false, message: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

const allowedOrigin = (origin) => {
  if (!origin) return true;
  if (origin === process.env.CLIENT_URL) return true;
  if (origin === 'http://localhost:5173') return true;
  if (/^https:\/\/sghcrafts(-[a-z0-9-]+)?\.vercel\.app$/.test(origin)) return true;
  return false;
};

app.use(cors({
  origin: (origin, cb) => (allowedOrigin(origin) ? cb(null, true) : cb(new Error('CORS: ' + origin))),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));

const uploadDir = path.resolve(__dirname, process.env.UPLOAD_PATH || './uploads');
app.use('/uploads', express.static(uploadDir));

app.get('/', (_req, res) => {
  res.json({ success: true, message: 'SGH ERP Backend is running' });
});
app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'API is running', timestamp: new Date().toISOString() });
});
app.get('/api/v1', (_req, res) => {
  res.json({ success: true, message: 'SGH ERP API v1 is active', version: '1.0.0' });
});
app.get('/api/v1/health', (_req, res) => {
  res.json({ success: true, message: 'SGH ERP API is running', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ─── API Routes (v1 — Office module MongoDB) ────────────────
app.use('/api/v1/auth', v1AuthRoutes);
app.use('/api/v1/customers', v1CustomerRoutes);
app.use('/api/v1/orders', v1OrderRoutes);
app.use('/api/v1/buyer-catalogue', v1BuyerCatalogueRoutes);
app.use('/api/v1/inventory-products', v1InventoryProductRoutes);

// ─── API Routes (v2 — MongoDB / Mongoose Showroom Inventory) ────────────────
app.use('/api/v2/auth', v2AuthRoutes);
app.use('/api/v2/users', v2UserRoutes);
app.use('/api/v2/locations', v2LocationRoutes);
app.use('/api/v2/products', v2ProductRoutes);
app.use('/api/v2/instances', v2InstanceRoutes);
app.use('/api/v2/stock', v2StockRoutes);
app.use('/api/v2/reservations', v2ReservationRoutes);
app.use('/api/v2/sales', v2SalesRoutes);
app.use('/api/v2/reports', v2ReportRoutes);

app.use(notFound);
app.use(errorHandler);

if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  connect()
    .then(() => {
      const server = app.listen(PORT, () => {
        console.log(`🚀 SGH ERP Server running on port ${PORT} [${process.env.NODE_ENV || 'production'}]`);
      });
      process.on('unhandledRejection', (err) => {
        console.error('⚠️  Unhandled Rejection:', err);
        if (process.env.NODE_ENV === 'production') server.close(() => process.exit(1));
      });
      process.on('SIGTERM', () => {
        console.log('SIGTERM received. Closing server...');
        server.close(() => process.exit(0));
      });
    })
    .catch((err) => {
      console.error('Failed to connect to MongoDB:', err.message);
      process.exit(1);
    });
}

module.exports = app;
