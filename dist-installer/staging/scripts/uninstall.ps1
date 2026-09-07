# SERVIX Local Server - Uninstall Script (FAZA 8F)
# Stops service but preserves user data

Write-Host "Stopping SERVIX Local Server..." -ForegroundColor Yellow

# Stop Windows Service
$service = Get-Service -Name "SERVIX" -ErrorAction SilentlyContinue
if ($service) {
    Stop-Service -Name "SERVIX" -Force -ErrorAction SilentlyContinue
    Write-Host "? Service stopped" -ForegroundColor Green
}

# Note: User data remains in ProgramData\SERVIX
Write-Host "? Application files will be removed" -ForegroundColor Green
Write-Host "? User data preserved in $env:PROGRAMDATA\SERVIX" -ForegroundColor Green
Write-Host "  (Database, backups, logs)" -ForegroundColor Green
