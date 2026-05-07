const multer = require('multer');
const path = require('path');
const { AppError } = require('./errorHandler');

// ─── Storage: Memory (files stay in RAM as Buffers) ─────────────────────────
// Vercel serverless has ephemeral disk — we upload buffers to GitHub instead.
const memoryStorage = multer.memoryStorage();

// ─── File filters ─────────────────────────────────────────────────────────────
const documentFilter = (req, file, cb) => {
  const allowed = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(new AppError(`File type ${ext} not allowed. Allowed: ${allowed.join(', ')}`, 400), false);
  }
};

// Accept any common image format — matches either by MIME type prefix
// (`image/*`) or by a permissive extension allowlist for formats browsers
// don't always tag correctly (HEIC, AVIF, TIFF, etc.). Minimum supported
// size is 5 MB per file; the hard cap below leaves generous headroom.
const imageFilter = (req, file, cb) => {
  const allowedExts = [
    '.jpg', '.jpeg', '.jpe', '.jfif',
    '.png', '.apng',
    '.webp', '.gif', '.bmp', '.dib',
    '.tif', '.tiff',
    '.svg', '.svgz',
    '.heic', '.heif', '.avif',
    '.ico', '.cur',
  ];
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/') || allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new AppError(`Image type ${ext || mime || 'unknown'} not allowed.`, 400), false);
  }
};

// ─── Multer instances (all use memory storage now) ────────────────────────────
const uploadDocument = multer({
  storage: memoryStorage,
  fileFilter: documentFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
  },
});

const uploadImage = multer({
  storage: memoryStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per image
  },
});

const uploadCustomerPhoto = multer({
  storage: memoryStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per image
  },
});

module.exports = { uploadDocument, uploadImage, uploadCustomerPhoto };
