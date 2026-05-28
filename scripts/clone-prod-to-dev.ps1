# =====================================================================
# Clone the production MongoDB database AND uploads folder into dev.
# Run whenever you want fresh prod data + files for local testing.
#
# Usage (any PowerShell window):
#   & "D:\Shri Ganesh ERP Software\Sgh Software\sgh-erp\backend\scripts\clone-prod-to-dev.ps1"
#
# Requires mongodump and mongorestore on PATH (MongoDB Database Tools).
# Override connection strings via env vars if you don't use the defaults.
# =====================================================================

$ErrorActionPreference = 'Stop'

$timestamp   = Get-Date -Format 'yyyy-MM-dd-HHmm'
$dumpDir     = Join-Path $env:TEMP "sgh-erp-clone-$timestamp"
$backendDir  = "D:\Shri Ganesh ERP Software\Sgh Software\sgh-erp\backend"
$prodUploads = Join-Path $backendDir "uploads"
$devUploads  = Join-Path $backendDir "uploads-dev"

# Default connection strings — override via PROD_MONGO_URI / DEV_MONGO_URI env vars.
$prodUri = if ($env:PROD_MONGO_URI) { $env:PROD_MONGO_URI } else { "mongodb://127.0.0.1:27017/sgh_erp" }
$devUri  = if ($env:DEV_MONGO_URI)  { $env:DEV_MONGO_URI  } else { "mongodb://127.0.0.1:27017/sgh_erp_dev" }

Write-Host "==> Dumping production database..." -ForegroundColor Cyan
mongodump --uri=$prodUri --out=$dumpDir

# mongodump nests the DB under <out>/<dbName>; figure out the source dir.
$prodDbName = ([uri]$prodUri).Segments[-1].TrimEnd('/').Split('?')[0]
$devDbName  = ([uri]$devUri).Segments[-1].TrimEnd('/').Split('?')[0]
$prodDumpPath = Join-Path $dumpDir $prodDbName

Write-Host ""
Write-Host "==> Restoring into dev database (drop + restore)..." -ForegroundColor Cyan
mongorestore --uri=$devUri --drop --nsFrom="$prodDbName.*" --nsTo="$devDbName.*" $dumpDir

Write-Host ""
Write-Host "==> Rewriting prod image URLs -> dev URLs..." -ForegroundColor Cyan
$prodOrigin = if ($env:PROD_API_ORIGIN) { $env:PROD_API_ORIGIN } else { "https://api.sghsofterp.com" }
$devOrigin  = if ($env:DEV_API_ORIGIN)  { $env:DEV_API_ORIGIN  } else { "http://localhost:5001" }

# Replace prod origin in every string-valued field across every collection in dev.
$rewriteJs = @"
const prodOrigin = '$prodOrigin';
const devOrigin  = '$devOrigin';
db.getCollectionNames().forEach(function (name) {
  const coll = db.getCollection(name);
  coll.find({}).forEach(function (doc) {
    let changed = false;
    function walk(value) {
      if (typeof value === 'string') {
        if (value.indexOf(prodOrigin) !== -1) { changed = true; return value.split(prodOrigin).join(devOrigin); }
        return value;
      }
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object' && !(value instanceof Date) && !(value._bsontype)) {
        for (const k of Object.keys(value)) value[k] = walk(value[k]);
        return value;
      }
      return value;
    }
    walk(doc);
    if (changed) coll.replaceOne({ _id: doc._id }, doc);
  });
});
print('URL rewrite complete');
"@
mongosh $devUri --quiet --eval $rewriteJs

Write-Host ""
Write-Host "==> Mirroring uploads/ -> uploads-dev/..." -ForegroundColor Cyan
if (Test-Path $prodUploads) {
    robocopy $prodUploads $devUploads /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }
    $fileCount = (Get-ChildItem -Path $devUploads -Recurse -File -ErrorAction SilentlyContinue).Count
    Write-Host "    Mirrored $fileCount files." -ForegroundColor Gray
} else {
    Write-Host "    No prod uploads folder yet, nothing to mirror." -ForegroundColor Gray
}

Write-Host ""
Write-Host "==> Cleaning up temp dump..." -ForegroundColor Cyan
Remove-Item -Path $dumpDir -Recurse -Force

Write-Host ""
Write-Host "Done. Dev DB and uploads are now a copy of production." -ForegroundColor Green
Write-Host "Start the local backend with:"
Write-Host "  cd '$backendDir'; npm run dev"
