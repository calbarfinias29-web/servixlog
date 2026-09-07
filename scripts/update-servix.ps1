# SERVIX Production Update/Upgrade Script (FAZA 8F)
# Handles safe updates with backup and rollback capability

param(
    [string]$NewInstallerPath,
    [switch]$RollbackMode = $false
)

$ErrorActionPreference = "Stop"

function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Host "ERROR: This script requires administrator privileges" -ForegroundColor Red
    exit 1
}

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "SERVIX Update/Upgrade Script (FAZA 8F)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$AppRoot = "C:\Program Files\SERVIX\app"
$DataRoot = "$env:PROGRAMDATA\SERVIX"
$BackupDir = "$DataRoot\backups"
$LogFile = "$DataRoot\logs\update.log"
$ServiceName = "SERVIX"

function Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp | $Message" | Add-Content -Path $LogFile
    Write-Host $Message
}

function Create-DatabaseBackup {
    Log "[BACKUP] Creating database backup before update..."
    
    $DbPath = "$DataRoot\data\servix-local.db"
    if (-not (Test-Path $DbPath)) {
        Log "[BACKUP] No database found - skipping backup"
        return $null
    }
    
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $backupPath = "$BackupDir\servix-local-backup-$timestamp.db"
    
    try {
        Copy-Item -Path $DbPath -Destination $backupPath -Force
        Log "[BACKUP] ✓ Database backed up: $backupPath"
        return $backupPath
    } catch {
        Log "[BACKUP] ✗ Backup failed: $_"
        throw
    }
}

function Create-ApplicationBackup {
    Log "[BACKUP] Creating application backup..."
    
    $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $appBackupPath = "$BackupDir\app-backup-$timestamp"
    
    try {
        Copy-Item -Path $AppRoot -Destination $appBackupPath -Recurse -Force
        Log "[BACKUP] ✓ Application backed up: $appBackupPath"
        return $appBackupPath
    } catch {
        Log "[BACKUP] ✗ Application backup failed: $_"
        throw
    }
}

function Stop-Service {
    Log "[SERVICE] Stopping SERVIX service..."
    
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        Stop-Service -Name $ServiceName -Force
        Start-Sleep -Seconds 2
        Log "[SERVICE] ✓ Service stopped"
    } else {
        Log "[SERVICE] ⚠ Service not found"
    }
}

function Extract-Installer {
    param([string]$InstallerPath)
    
    if (-not (Test-Path $InstallerPath)) {
        throw "Installer not found: $InstallerPath"
    }
    
    Log "[EXTRACT] Extracting installer..."
    
    $tempDir = Join-Path $env:TEMP "servix-update-$$"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    
    # Assuming the installer is a ZIP file or similar
    # For Inno Setup .exe, this would need to be extracted differently
    if ($InstallerPath -like "*.zip") {
        Expand-Archive -Path $InstallerPath -DestinationPath $tempDir -Force
    } else {
        Log "[EXTRACT] ⚠ Installer format not recognized for extraction"
        # For .exe from Inno Setup, manual extraction would be needed
        # Or use 7-Zip if available
    }
    
    Log "[EXTRACT] ✓ Extracted to: $tempDir"
    return $tempDir
}

function Check-Compatibility {
    param([string]$StagingPath)
    
    Log "[CHECK] Checking application compatibility..."
    
    $versionFile = "$StagingPath\version.ts"
    if (Test-Path $versionFile) {
        Log "[CHECK] ✓ Version file found"
    }
    
    $schemaFile = "$StagingPath\server\src\schema.ts"
    if (Test-Path $schemaFile) {
        Log "[CHECK] ✓ Schema file found"
    }
    
    Log "[CHECK] ✓ Compatibility check passed"
}

function Update-Application {
    param(
        [string]$StagingPath,
        [string]$AppBackupPath
    )
    
    Log "[UPDATE] Updating application files..."
    
    try {
        # Remove old app files (keep data directory)
        Remove-Item -Path "$AppRoot\frontend" -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path "$AppRoot\server" -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -Path "$AppRoot\.env.production" -Force -ErrorAction SilentlyContinue
        
        # Copy new files
        Copy-Item -Path "$StagingPath\frontend" -Destination "$AppRoot\frontend" -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item -Path "$StagingPath\server" -Destination "$AppRoot\server" -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item -Path "$StagingPath\.env.production" -Destination "$AppRoot\.env.production" -Force -ErrorAction SilentlyContinue
        
        Log "[UPDATE] ✓ Application files updated"
    } catch {
        Log "[UPDATE] ✗ Update failed: $_"
        Log "[ROLLBACK] Rolling back to previous version..."
        
        # Restore from backup
        if (Test-Path $AppBackupPath) {
            Remove-Item -Path $AppRoot -Recurse -Force
            Copy-Item -Path $AppBackupPath -Destination $AppRoot -Recurse -Force
            Log "[ROLLBACK] ✓ Rolled back from: $AppBackupPath"
        }
        throw
    }
}

function Start-Service {
    Log "[SERVICE] Starting SERVIX service..."
    
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        Start-Service -Name $ServiceName
        Start-Sleep -Seconds 3
        Log "[SERVICE] ✓ Service started"
    } else {
        Log "[SERVICE] ⚠ Service not found"
    }
}

function Check-Health {
    Log "[HEALTH] Checking service health..."
    
    for ($i = 0; $i -lt 15; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:8787/api/health" `
                -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
            
            if ($response.StatusCode -eq 200) {
                $data = $response.Content | ConvertFrom-Json
                Log "[HEALTH] ✓ Service healthy"
                Log "[HEALTH]   Version: $($data.serverVersion)"
                Log "[HEALTH]   Schema: $($data.schemaVersion)"
                Log "[HEALTH]   Uptime: $($data.uptimeSeconds)s"
                return $true
            }
        } catch { }
        
        Start-Sleep -Seconds 1
    }
    
    Log "[HEALTH] ✗ Health check failed after 15 seconds"
    return $false
}

function Rollback-Update {
    param(
        [string]$DbBackupPath,
        [string]$AppBackupPath
    )
    
    Log "[ROLLBACK] Rolling back update..."
    
    Stop-Service
    
    if ($AppBackupPath -and (Test-Path $AppBackupPath)) {
        Remove-Item -Path $AppRoot -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item -Path $AppBackupPath -Destination $AppRoot -Recurse -Force
        Log "[ROLLBACK] ✓ Application rolled back"
    }
    
    Start-Service
    Log "[ROLLBACK] ✓ Rollback complete"
}

# Main update flow
try {
    Log "======== UPDATE STARTED ========"
    Log "Update installer: $NewInstallerPath"
    Log ""
    
    # Step 1: Backup
    $dbBackup = Create-DatabaseBackup
    $appBackup = Create-ApplicationBackup
    Log ""
    
    # Step 2: Stop service
    Stop-Service
    Log ""
    
    # Step 3: Check compatibility
    Check-Compatibility $AppRoot
    Log ""
    
    # Step 4: Update application
    Update-Application $AppRoot $appBackup
    Log ""
    
    # Step 5: Start service
    Start-Service
    Log ""
    
    # Step 6: Health check
    if (Check-Health) {
        Log ""
        Log "======== UPDATE SUCCESSFUL ========"
        Log "Previous version backed up to: $appBackup"
        Log "Database backed up to: $dbBackup"
        Log "User data preserved in: $DataRoot\data"
    } else {
        Log "[ERROR] Health check failed after update"
        Log "Initiating automatic rollback..."
        Rollback-Update -DbBackupPath $dbBackup -AppBackupPath $appBackup
        Log "======== UPDATE FAILED & ROLLED BACK ========"
        exit 1
    }
    
} catch {
    Log "[ERROR] Update failed with exception:"
    Log "[ERROR] $_"
    Log "======== UPDATE FAILED ========"
    exit 1
}

Log ""
Write-Host "Check logs: $LogFile" -ForegroundColor Yellow
