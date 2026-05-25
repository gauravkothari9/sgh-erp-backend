// S3-ready abstraction. For now: local disk via multer. Swap the storage
// backend later by replacing this module — the rest of the app only talks
// through `upload.array(...)` and the URL string returned by `publicUrl()`.

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const UPLOAD_PATH = path.resolve(__dirname, '..', '..', process.env.UPLOAD_PATH || './uploads');
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

if (!fs.existsSync(UPLOAD_PATH)) fs.mkdirSync(UPLOAD_PATH, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_PATH),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-z0-9_.-]/gi, '_');
    cb(null, `${Date.now()}-${Math.floor(Math.random() * 1e6)}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE || 10 * 1024 * 1024) },
  fileFilter: (_req, file, cb) =>
    cb(null, /^image\//.test(file.mimetype || '')),
});

const publicUrl = (filename) => `${PUBLIC_BASE}/uploads/${filename}`;

module.exports = { upload, publicUrl };
