# =====================================================================
# Clone the production Postgres database AND uploads folder into dev.
# Run whenever you want fresh prod data + files for local testing.
#
# Usage (any PowerShell window):
#   & "D:\Shri Ganesh ERP Software\Sgh Software\sgh-erp\backend\scripts\clone-prod-to-dev.ps1"
#
# Requires pg_dump and psql on PATH (Postgres bin/ folder).
# Override the connection strings via env vars if you don't use the
# defaults baked into .env.
# =====================================================================

$ErrorActionPreference = 'Stop'

$timestamp   = Get-Date -Format 'yyyy-MM-dd-HHmm'
$dumpFile    = Join-Path $env:TEMP "sgh-erp-clone-$timestamp.dump"
$backendDir  = "D:\Shri Ganesh ERP Software\Sgh Software\sgh-erp\backend"
$prodUploads = Join-Path $backendDir "uploads"
$devUploads  = Join-Path $backendDir "uploads-dev"

# Default connection strings — override via PROD_DB_URL / DEV_DB_URL env vars.
$prodUrl = if ($env:PROD_DB_URL) { $env:PROD_DB_URL } else { "postgresql://postgres:postgres@localhost:5432/sgh_erp" }
$devUrl  = if ($env:DEV_DB_URL)  { $env:DEV_DB_URL  } else { "postgresql://postgres:postgres@localhost:5432/sgh_erp_dev" }

Write-Host "==> Dumping production database..." -ForegroundColor Cyan
pg_dump --format=custom --no-owner --no-privileges --file=$dumpFile $prodUrl

Write-Host ""
Write-Host "==> Recreating dev database (drop + restore)..." -ForegroundColor Cyan
# The --clean flag inside pg_restore drops each object before recreating,
# but tables added since the previous restore would leak. To be safe we
# drop + recreate the whole dev DB.
$devDbName = ([uri]$devUrl).Segments[-1]
$devAdminUrl = $devUrl -replace "/$devDbName(\?|$)", "/postgres`$1"
psql $devAdminUrl -c "DROP DATABASE IF EXISTS `"$devDbName`";"
psql $devAdminUrl -c "CREATE DATABASE `"$devDbName`";"
pg_restore --no-owner --no-privileges --dbname=$devUrl $dumpFile

Write-Host ""
Write-Host "==> Mirroring uploads/ -> uploads-dev/..." -ForegroundColor Cyan
if (Test-Path $prodUploads) {
    robocopy $prodUploads $devUploads /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    # robocopy uses non-zero codes for "success with copies"; only 8+ is real failure.
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed with exit code $LASTEXITCODE"
    }
    $fileCount = (Get-ChildItem -Path $devUploads -Recurse -File -ErrorAction SilentlyContinue).Count
    Write-Host "    Mirrored $fileCount files." -ForegroundColor Gray
} else {
    Write-Host "    No prod uploads folder yet, nothing to mirror." -ForegroundColor Gray
}

Write-Host ""
Write-Host "==> Cleaning up temp dump..." -ForegroundColor Cyan
Remove-Item -Path $dumpFile -Force

Write-Host ""
Write-Host "Done. Dev DB and uploads are now a copy of production." -ForegroundColor Green
Write-Host "Start the local backend with:"
Write-Host "  cd '$backendDir'; npm run dev"
