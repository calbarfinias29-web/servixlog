# SERVIX Local Server - Database Backup Script (FAZA 8F)

$DataRoot = "$env:PROGRAMDATA\SERVIX"
$DbPath = "$DataRoot\data\servix-local.db"
$BackupDir = "$DataRoot\backups"

if (-not (Test-Path $BackupDir)) { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }

if (Test-Path $DbPath) {
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupPath = "$BackupDir\servix-local-backup-$timestamp.db"
    
    try {
        Copy-Item -Path $DbPath -Destination $backupPath -Force
        Write-Host "? Database backed up: $backupPath" -ForegroundColor Green
        exit 0
    } catch {
        Write-Host "? Backup failed: $_" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "? No existing database to back up" -ForegroundColor Green
    exit 0
}
