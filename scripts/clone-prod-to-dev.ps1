# =====================================================================
# Clone the production database AND uploads folder into dev.
# Run whenever you want fresh prod data + files for local testing.
#
# Usage (any PowerShell window):
#   & "D:\Shri Ganesh ERP Software\Sgh Software\sgh-erp\backend\scripts\clone-prod-to-dev.ps1"
#
# Requires mongodump and mongorestore on PATH.
# =====================================================================

$ErrorActionPreference = 'Stop'

$timestamp   = Get-Date -Format 'yyyy-MM-dd-HHmm'
$dumpDir     = Join-Path $env:TEMP "sgh-erp-clone-$timestamp"
$backendDir  = "D:\Shri Ganesh ERP Software\Sgh Software\sgh-erp\backend"
$prodUploads = Join-Path $backendDir "uploads"
$devUploads  = Join-Path $backendDir "uploads-dev"

Write-Host "==> Dumping production database 'sgh-erp'..." -ForegroundColor Cyan
mongodump --uri "mongodb://localhost:27017/sgh-erp" --out $dumpDir

Write-Host ""
Write-Host "==> Dropping and reloading dev database 'sgh-erp-dev'..." -ForegroundColor Cyan
mongorestore --uri "mongodb://localhost:27017/sgh-erp-dev" --drop --nsFrom "sgh-erp.*" --nsTo "sgh-erp-dev.*" "$dumpDir/sgh-erp"

Write-Host ""
Write-Host "==> Mirroring uploads/ -> uploads-dev/..." -ForegroundColor Cyan
if (Test-Path $prodUploads) {
    # /MIR mirrors the tree, /NFL /NDL /NJH /NJS /NC /NS /NP keeps output quiet.
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
Remove-Item -Path $dumpDir -Recurse -Force

Write-Host ""
Write-Host "Done. Dev DB and uploads are now a copy of production." -ForegroundColor Green
Write-Host "Start the local backend with:"
Write-Host "  cd '$backendDir'; npm run dev"
