/**
 * Local Disk Storage Utility (with image compression)
 * ───────────────────────────────────────────────────
 * Saves uploaded files to the backend's UPLOAD_PATH folder
 * (./uploads in prod, ./uploads-dev in dev) and returns public URLs.
 *
 * Images are automatically resized and re-encoded as JPEG to keep file size
 * sane. Non-images (PDFs, etc.) are saved untouched. Multi-uploads run in
 * parallel.
 *
 * Drop-in replacement for utils/githubStorage.js — exports the same
 * function names so controllers don't need to change destructuring.
 *
 * Env vars used:
 *   UPLOAD_PATH      Where files land on disk, relative to backend/.
 *                    Default: "./uploads"
 *   PUBLIC_API_URL   Base URL the frontend uses to fetch files.
 *                    e.g. https://api.sghsofterp.com or http://localhost:5001
 *   IMAGE_MAX_WIDTH  Resize images larger than this. Default: 1920
 *   IMAGE_QUALITY    JPEG quality 1–100. Default: 82
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  // sharp not installed — images will be saved untouched.
  console.warn('[localStorage] sharp not installed; image compression disabled. Run `npm install sharp` in backend.');
}

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.heic', '.heif',
]);

const getBaseDir = () => {
  const uploadPath = process.env.UPLOAD_PATH || './uploads';
  return path.resolve(__dirname, '..', uploadPath);
};

const getPublicBase = () => (process.env.PUBLIC_API_URL || '').replace(/\/$/, '');

const buildPublicUrl = (folder, filename) =>
  `${getPublicBase()}/uploads/${folder}/${filename}`;

const isImageFile = (filename) =>
  IMAGE_EXTS.has(path.extname(filename).toLowerCase());

/**
 * Compress + resize an image buffer. Returns { buffer, filename }.
 * If sharp isn't available or the buffer isn't a valid image, returns
 * the original unchanged.
 */
const processImage = async (buffer, filename) => {
  if (!sharp || !isImageFile(filename)) {
    return { buffer, filename };
  }

  const maxWidth = parseInt(process.env.IMAGE_MAX_WIDTH || '1920', 10);
  const quality  = parseInt(process.env.IMAGE_QUALITY   || '82',  10);

  try {
    const meta = await sharp(buffer).metadata();
    // Only downscale; never upscale.
    const resizeWidth = meta.width && meta.width > maxWidth ? maxWidth : null;

    let pipeline = sharp(buffer, { failOn: 'none' }).rotate(); // honor EXIF orientation
    if (resizeWidth) {
      pipeline = pipeline.resize({ width: resizeWidth, withoutEnlargement: true });
    }
    const out = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();

    // Force .jpg extension since we're re-encoding to JPEG.
    const base = path.basename(filename, path.extname(filename));
    return { buffer: out, filename: `${base}.jpg` };
  } catch (err) {
    console.warn(`[localStorage] sharp couldn't process ${filename}, saving as-is:`, err.message);
    return { buffer, filename };
  }
};

/**
 * Save one file (Buffer) to disk and return its public URL.
 */
const uploadToLocal = async (buffer, filename, folder = 'uploads') => {
  const baseDir   = getBaseDir();
  const folderDir = path.join(baseDir, folder);
  await fsp.mkdir(folderDir, { recursive: true });

  const processed = await processImage(buffer, filename);

  const filePath = path.join(folderDir, processed.filename);
  await fsp.writeFile(filePath, processed.buffer);

  return buildPublicUrl(folder, processed.filename);
};

/**
 * Save many files in parallel.
 */
const uploadMultipleToLocal = async (files, folder = 'uploads') => {
  return Promise.all(
    files.map((file) => uploadToLocal(file.buffer, file.filename, folder))
  );
};

/**
 * Delete a previously-saved file. Handles both local URLs and
 * legacy GitHub raw URLs (skips the latter — we don't have a token).
 */
const deleteFromLocal = async (fileUrl) => {
  if (!fileUrl) return false;

  if (fileUrl.includes('raw.githubusercontent.com')) {
    console.warn(`Skipping delete of legacy GitHub-stored file: ${fileUrl}`);
    return false;
  }

  const match = fileUrl.match(/\/uploads\/(.+)$/);
  if (!match) return false;
  const relativePath = match[1].split('?')[0];

  const fullPath = path.join(getBaseDir(), relativePath);
  try {
    await fsp.unlink(fullPath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
};

const isLocalUrl = (url) => Boolean(url) && url.includes('/uploads/');

/**
 * Rename an existing locally-stored file. Resolves the file on disk from
 * its public URL, renames it to `newFilename` within the same folder, and
 * returns the new public URL. Returns null if the source can't be found.
 *
 * Legacy GitHub URLs are not renamed — they're returned as-is.
 *
 * @param {string} oldUrl       – Existing public URL of the file
 * @param {string} newFilename  – Target filename within the same folder
 * @returns {Promise<string|null>}
 */
const renameLocally = async (oldUrl, newFilename) => {
  if (!oldUrl || !newFilename) return null;
  if (!isLocalUrl(oldUrl)) {
    // Legacy GitHub-stored file — nothing we can do without a token.
    return null;
  }

  const match = oldUrl.match(/\/uploads\/(.+)$/);
  if (!match) return null;
  const relPath = match[1].split('?')[0];

  const slash = relPath.indexOf('/');
  const folder = slash > -1 ? relPath.slice(0, slash) : 'uploads';

  const oldExt = path.extname(relPath);
  // Force the extension to match the existing file so we don't end up with
  // double extensions (`X_Pro-1.jpg.jpg`) when the caller hands us a name
  // without one.
  const targetName = path.extname(newFilename)
    ? newFilename
    : `${newFilename}${oldExt}`;

  const baseDir = getBaseDir();
  const oldPath = path.join(baseDir, relPath);
  const newPath = path.join(baseDir, folder, targetName);

  if (oldPath === newPath) {
    return oldUrl;
  }

  try {
    await fsp.rename(oldPath, newPath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  return buildPublicUrl(folder, targetName);
};

module.exports = {
  // Real names
  uploadToLocal,
  uploadMultipleToLocal,
  deleteFromLocal,
  renameLocally,
  isLocalUrl,
  // Aliases for githubStorage compatibility
  uploadToGitHub:         uploadToLocal,
  uploadMultipleToGitHub: uploadMultipleToLocal,
  deleteFromGitHub:       deleteFromLocal,
  renameOnGitHub:         renameLocally,
  isGitHubUrl:            isLocalUrl,
};
