/**
 * GitHub Storage Utility
 * ─────────────────────
 * Stores uploaded files in a GitHub repository via the Contents API.
 * Serves them through raw.githubusercontent.com (free CDN-like delivery).
 *
 * Required env vars:
 *   GITHUB_TOKEN  – Personal Access Token (classic) with `repo` scope
 *   GITHUB_REPO   – Full repo name, e.g. "gauravkothari9/sgh-erp-uploads"
 *   GITHUB_BRANCH – Branch to use (default: "main")
 */

const GITHUB_API = 'https://api.github.com';

const getConfig = () => {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!token || !repo) {
    throw new Error(
      'GitHub storage is not configured. Set GITHUB_TOKEN and GITHUB_REPO environment variables.'
    );
  }

  return { token, repo, branch };
};

const headers = (token) => ({
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github.v3+json',
  'Content-Type': 'application/json',
  'User-Agent': 'SGH-ERP-Backend',
});

/**
 * Upload a file (Buffer) to GitHub.
 *
 * @param {Buffer}  buffer   – File content
 * @param {string}  filename – Target filename (e.g. "img-1713456789-123.jpg")
 * @param {string}  folder   – Subfolder in the repo (e.g. "images", "documents", "customers")
 * @returns {Promise<string>} – Public raw URL of the uploaded file
 */
const uploadToGitHub = async (buffer, filename, folder = 'uploads') => {
  const { token, repo, branch } = getConfig();
  const filePath = `${folder}/${filename}`;
  const url = `${GITHUB_API}/repos/${repo}/contents/${filePath}`;

  // Check if file already exists (to get its SHA for overwrite)
  let sha;
  try {
    const checkRes = await fetch(url, {
      method: 'GET',
      headers: headers(token),
    });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      sha = existing.sha;
    }
  } catch {
    // File doesn't exist — that's fine
  }

  const body = {
    message: `Upload ${filePath}`,
    content: buffer.toString('base64'),
    branch,
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub upload failed (${res.status}): ${errBody}`);
  }

  const data = await res.json();
  // Return the raw URL for direct browser access
  return data.content.download_url;
};

/**
 * Delete a file from GitHub by its raw URL or repo path.
 *
 * @param {string} fileUrl – Either a raw.githubusercontent.com URL or a repo-relative path
 * @returns {Promise<boolean>} – true if deleted, false if not found
 */
const deleteFromGitHub = async (fileUrl) => {
  const { token, repo, branch } = getConfig();

  // Extract the repo-relative path from a raw URL
  // e.g. https://raw.githubusercontent.com/user/repo/main/images/file.jpg -> images/file.jpg
  let filePath;
  if (fileUrl.includes('raw.githubusercontent.com')) {
    const parts = fileUrl.split(`/${branch}/`);
    filePath = parts[1];
  } else if (fileUrl.startsWith('http')) {
    // Some other URL format — try to extract path
    const urlObj = new URL(fileUrl);
    filePath = urlObj.pathname.split(`/${branch}/`).pop();
  } else {
    // Already a relative path
    filePath = fileUrl.startsWith('/') ? fileUrl.substring(1) : fileUrl;
  }

  if (!filePath) return false;

  const url = `${GITHUB_API}/repos/${repo}/contents/${filePath}`;

  // Get the SHA first (required for deletion)
  const getRes = await fetch(url, {
    method: 'GET',
    headers: headers(token),
  });

  if (!getRes.ok) {
    console.warn(`GitHub delete: file not found at ${filePath}`);
    return false;
  }

  const fileData = await getRes.json();

  const delRes = await fetch(url, {
    method: 'DELETE',
    headers: headers(token),
    body: JSON.stringify({
      message: `Delete ${filePath}`,
      sha: fileData.sha,
      branch,
    }),
  });

  if (!delRes.ok) {
    const errBody = await delRes.text();
    console.error(`GitHub delete failed (${delRes.status}): ${errBody}`);
    return false;
  }

  return true;
};

/**
 * Upload multiple files to GitHub in parallel.
 *
 * @param {Array<{buffer: Buffer, filename: string}>} files
 * @param {string} folder
 * @returns {Promise<string[]>} – Array of raw URLs
 */
const uploadMultipleToGitHub = async (files, folder = 'uploads') => {
  // Upload sequentially to avoid GitHub API rate issues with parallel writes
  // (GitHub Contents API can conflict on tree updates if too many parallel PUTs)
  const urls = [];
  for (const file of files) {
    const url = await uploadToGitHub(file.buffer, file.filename, folder);
    urls.push(url);
  }
  return urls;
};

/**
 * Check if a URL is a GitHub-stored file.
 */
const isGitHubUrl = (url) => {
  return url && (
    url.includes('raw.githubusercontent.com') ||
    url.includes('github.com') && url.includes('/blob/')
  );
};

/**
 * Rename an existing GitHub-hosted file. Copies the file to a new path
 * (filename within the same folder), then deletes the original. Returns
 * the new public URL. If the source file can't be fetched, returns null
 * so callers can fall back to the original URL.
 *
 * @param {string} oldUrl       – Existing raw URL of the file
 * @param {string} newFilename  – Target filename (e.g. "NEW-SKU_Pro-1.jpg")
 * @param {string} folder       – Subfolder in the repo (default: "images")
 * @returns {Promise<string|null>}
 */
const renameOnGitHub = async (oldUrl, newFilename, folder = 'images') => {
  if (!oldUrl || !newFilename) return null;
  try {
    // Fetch the original bytes so we can re-upload under the new name.
    const res = await fetch(oldUrl);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const newUrl = await uploadToGitHub(buffer, newFilename, folder);

    // Best-effort delete of the original. If it fails (file already gone,
    // network blip), the rename still "succeeds" — the new URL is live and
    // the old will just orphan in the bucket.
    try {
      await deleteFromGitHub(oldUrl);
    } catch (err) {
      console.warn(`renameOnGitHub: cleanup of ${oldUrl} failed`, err?.message || err);
    }

    return newUrl;
  } catch (err) {
    console.error('renameOnGitHub failed', err?.message || err);
    return null;
  }
};

module.exports = {
  uploadToGitHub,
  deleteFromGitHub,
  renameOnGitHub,
  uploadMultipleToGitHub,
  isGitHubUrl,
};
