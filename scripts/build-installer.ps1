# SERVIX Windows Installer Build Script
# FAZA 8F - Build production installer for Windows

param(
    [string]$OutputDir = ".\dist-installer",
    [string]$Version = "2.0.0",
    [switch]$SkipBuild = $false,
    [switch]$SkipSigning = $false
)

$ErrorActionPreference = "Stop"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "SERVIX Windows Installer Builder (FAZA 8F)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Ensure we're in the project root
if (-not (Test-Path "package.json")) {
    throw "Error: package.json not found. Run from project root."
}

$ProjectRoot = Get-Location
$BuildStaging = "$OutputDir\staging"
$InstallerOutput = "$OutputDir\installer"
$CurrentVersion = $Version

Write-Host "[1/7] Validating environment..." -ForegroundColor Yellow

# Check required tools
$tools = @("node", "npm")
foreach ($tool in $tools) {
    $check = Get-Command $tool -ErrorAction SilentlyContinue
    if (-not $check) {
        throw "Error: $tool is not installed or not in PATH"
    }
    Write-Host "? $tool found: $($check.Source)" -ForegroundColor Green
}

# Check for Inno Setup if not skipping
if (-not $SkipBuild) {
    $innoSetupPath = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
    if (-not (Test-Path $innoSetupPath)) {
        Write-Host "??? Inno Setup 6 not found at expected location" -ForegroundColor Yellow
        Write-Host "  Expected: $innoSetupPath" -ForegroundColor Yellow
        Write-Host "  Installer file (.iss) will be generated but .exe cannot be built" -ForegroundColor Yellow
        $innoSetupPath = $null
    } else {
        Write-Host "? Inno Setup 6 found" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "[2/7] Cleaning previous builds..." -ForegroundColor Yellow
if (Test-Path $OutputDir) {
    Remove-Item -Path $OutputDir -Recurse -Force
    Write-Host "? Cleaned $OutputDir" -ForegroundColor Green
}
New-Item -ItemType Directory -Path $BuildStaging -Force | Out-Null
New-Item -ItemType Directory -Path $InstallerOutput -Force | Out-Null
Write-Host "? Created staging directories" -ForegroundColor Green

Write-Host ""
Write-Host "[3/7] Building frontend..." -ForegroundColor Yellow
if ($SkipBuild) { Write-Host "  Skipped (-SkipBuild)" -ForegroundColor Yellow } else { & npm run build; if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" } }
Write-Host "? Frontend built to dist/" -ForegroundColor Green

Write-Host ""
Write-Host "[4/7] Copying application files..." -ForegroundColor Yellow

# Copy frontend
Copy-Item -Path "dist" -Destination "$BuildStaging\frontend" -Recurse -Force
Write-Host "? Frontend copied" -ForegroundColor Green

# Copy server
Copy-Item -Path "server\src" -Destination "$BuildStaging\server\src" -Recurse -Force
Copy-Item -Path "server\tsconfig.json" -Destination "$BuildStaging\server\tsconfig.json" -Force
Write-Host "? Server source copied" -ForegroundColor Green

# Copy necessary files
Copy-Item -Path "package.json" -Destination "$BuildStaging\package.json" -Force
# server/src/devices.ts imports '../../src/version.ts' => app\src\version.ts in staging
New-Item -ItemType Directory -Path "$BuildStaging\src" -Force | Out-Null
Copy-Item -Path "src\version.ts" -Destination "$BuildStaging\src\version.ts" -Force
Write-Host "? Configuration files copied" -ForegroundColor Green

# FAZA 8F - Bundle Node.js runtime (app-local, NOT installed globally)
Write-Host ""
Write-Host "[4b/7] Bundling Node.js runtime..." -ForegroundColor Yellow
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeVersion = & node -v
    New-Item -ItemType Directory -Path "$BuildStaging\runtime" -Force | Out-Null
    $nodeSource = Split-Path $nodeCmd.Source
    # Copy node.exe plus required DLLs for a portable runtime
    Copy-Item -Path $nodeCmd.Source -Destination "$BuildStaging\runtime\node.exe" -Force
    Get-ChildItem -Path $nodeSource -Filter "*.dll" -ErrorAction SilentlyContinue | ForEach-Object {
        Copy-Item $_.FullName -Destination "$BuildStaging\runtime\" -Force
    }
    Write-Host "? Node.js $nodeVersion bundled to staging\runtime\ (portable, app-local)" -ForegroundColor Green
    Write-Host "  Version: $nodeVersion | Source: https://nodejs.org (official binaries)" -ForegroundColor Cyan
} else {
    Write-Host "??? node.exe not found in PATH - runtime will NOT be bundled!" -ForegroundColor Red
    Write-Host "  The installer requires a bundled Node runtime for end users." -ForegroundColor Red
    New-Item -ItemType Directory -Path "$BuildStaging\runtime" -Force | Out-Null
    'Node.js runtime was not bundled - see build warnings' | Set-Content -Path "$BuildStaging\runtime\MISSING-RUNTIME.txt" -Force
}

# Create production environment file
$envContent = @"
# SERVIX Local Production Environment
SERVIX_ENV=production
SERVIX_HOST=127.0.0.1
SERVIX_PORT=8787
SERVIX_LAN_ENABLED=false
SERVIX_DB_PATH=__PROGRAMDATA__\SERVIX\data\servix-local.db
SERVIX_SEED=true
NODE_ENV=production
"@

$envContent | Set-Content -Path "$BuildStaging\.env.production" -Force
Write-Host "? Production environment file created" -ForegroundColor Green

Write-Host ""
Write-Host "[5/7] Creating setup scripts..." -ForegroundColor Yellow

# Create Windows Service startup script
$startServiceScript = @'
# SERVIX Local Server - Windows Service Startup Script (FAZA 8F)
# Uses the app-local bundled Node runtime (never the system global Node).

$AppRoot = "C:\Program Files\SERVIX\app"
$DataRoot = "$env:PROGRAMDATA\SERVIX"
$LogFile = "$DataRoot\logs\servix-server.log"

# Create directories if they don't exist
if (-not (Test-Path $DataRoot)) { New-Item -ItemType Directory -Path $DataRoot -Force | Out-Null }
if (-not (Test-Path "$DataRoot\data")) { New-Item -ItemType Directory -Path "$DataRoot\data" -Force | Out-Null }
if (-not (Test-Path "$DataRoot\logs")) { New-Item -ItemType Directory -Path "$DataRoot\logs" -Force | Out-Null }
if (-not (Test-Path "$DataRoot\backups")) { New-Item -ItemType Directory -Path "$DataRoot\backups" -Force | Out-Null }

# Simple log rotation: keep the log under ~5 MB (one .old generation, no data deleted)
if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 5MB)) {
    Move-Item -Path $LogFile -Destination "$LogFile.old" -Force
}

# Load environment (config overrides from ProgramData take precedence over defaults)
$envFile = "$AppRoot\.env.production"
if (Test-Path $envFile) {
    Get-Content $envFile | Where-Object { $_ -match '=' } | ForEach-Object {
        $key, $value = $_ -split '=', 2
        $value = $value -replace '__PROGRAMDATA__', $env:PROGRAMDATA
        [Environment]::SetEnvironmentVariable($key.Trim(), $value.Trim(), [System.EnvironmentVariableTarget]::Process)
    }
}
$overridesFile = "$DataRoot\config\.env"
if (Test-Path $overridesFile) {
    Get-Content $overridesFile | Where-Object { $_ -match '=' } | ForEach-Object {
        $key, $value = $_ -split '=', 2
        [Environment]::SetEnvironmentVariable($key.Trim(), $value.Trim(), [System.EnvironmentVariableTarget]::Process)
    }
}

# Prefer the bundled runtime; fall back to system node only with a warning
$NodeExe = "$AppRoot\runtime\node.exe"
if (-not (Test-Path $NodeExe)) {
    Write-Host "[SERVIX] WARNING: bundled runtime missing, falling back to system node" | Out-File $LogFile -Append
    $NodeExe = "node.exe"
}

# Start SERVIX server (TypeScript runs natively on Node >= 22.18 / 24 via type stripping)
Set-Location $AppRoot
& $NodeExe server\src\server.ts >> $LogFile 2>&1
'@

New-Item -ItemType Directory -Path "$BuildStaging\scripts" -Force | Out-Null
$startServiceScript | Set-Content -Path "$BuildStaging\scripts\start-service.ps1" -Force
Write-Host "? Service startup script created" -ForegroundColor Green

# Create health check script
$healthCheckScript = @'
# SERVIX Local Server - Health Check Script (FAZA 8F)

$Port = 8787
$MaxRetries = 30
$RetryDelay = 2

for ($i = 0; $i -lt $MaxRetries; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" `
            -Method GET `
            -ErrorAction SilentlyContinue `
            -TimeoutSec 5
        
        if ($response.StatusCode -eq 200) {
            $data = $response.Content | ConvertFrom-Json
            Write-Host "? SERVIX Health Check PASSED" -ForegroundColor Green
            Write-Host "  Server: $($data.server)" -ForegroundColor Green
            Write-Host "  Status: $($data.status)" -ForegroundColor Green
            Write-Host "  Schema Version: $($data.schemaVersion)" -ForegroundColor Green
            Write-Host "  Uptime: $($data.uptimeSeconds)s" -ForegroundColor Green
            exit 0
        }
    } catch {
        # Expected during startup
    }
    
    if ($i -lt $MaxRetries - 1) {
        Write-Host "  Attempting health check ($($i+1)/$MaxRetries)..." -ForegroundColor Yellow
        Start-Sleep -Seconds $RetryDelay
    }
}

Write-Host "? SERVIX Health Check FAILED after $MaxRetries attempts" -ForegroundColor Red
exit 1
'@

$healthCheckScript | Set-Content -Path "$BuildStaging\scripts\health-check.ps1" -Force
Write-Host "? Health check script created" -ForegroundColor Green

# Create backup script
$backupScript = @'
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
'@

$backupScript | Set-Content -Path "$BuildStaging\scripts\backup-db.ps1" -Force
Write-Host "? Backup script created" -ForegroundColor Green

# Create uninstall preservation script
$uninstallScript = @'
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
'@

$uninstallScript | Set-Content -Path "$BuildStaging\scripts\uninstall.ps1" -Force
Write-Host "? Uninstall script created" -ForegroundColor Green
# Create service registration script (native sc.exe ? no NSSM/WinSW dependency)
$installServiceScript = @'
# SERVIX Local Server - Windows Service Registration (FAZA 8F)
# Uses native sc.exe: no external wrapper (NSSM/WinSW) required.

$ServiceName = "SERVIX"
$ScriptPath = "C:\Program Files\SERVIX\scripts\start-service.ps1"

# Idempotent: remove a previous registration only if it exists.
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

# Register the service: automatic startup, runs start-service.ps1 via PowerShell.
# Recovery: restart after 5s on crash, then 30s, then 60s (sc failure config).
$binPath = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $ScriptPath + '"'
sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "SERVIX Local Server" | Out-Null
sc.exe description $ServiceName "SERVIX Local Server for real-time device coordination" | Out-Null
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/30000/restart/60000 | Out-Null

if ($LASTEXITCODE -eq 0) {
    Write-Host "[SERVIX] Service registered (automatic startup, crash recovery enabled)"
    sc.exe start $ServiceName | Out-Null
} else {
    Write-Host "[SERVIX] ERROR: service registration failed (sc.exe exit $LASTEXITCODE)"
    exit 1
}
'@

$installServiceScript | Set-Content -Path "$BuildStaging\scripts\install-service.ps1" -Force
Write-Host "? Service registration script created (native sc.exe, crash recovery)" -ForegroundColor Green

Write-Host ""
Write-Host "[6/7] Creating Inno Setup configuration..." -ForegroundColor Yellow

# Create Inno Setup script
$innoContent = @"
; SERVIX Local Server Installer (FAZA 8F)
; Using Inno Setup 6

#define MyAppName "SERVIX"
#define MyAppVersion "$CurrentVersion"
#define MyAppPublisher "SERVIX Team"
#define MyAppExeName "servix-admin.exe"
#define AppSourceDir "$(Convert-Path $BuildStaging)"

[Setup]
AppId={{12345678-1234-1234-1234-123456789012}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppSupportURL=https://example.com/support
DefaultDirName={pf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=$InstallerOutput
OutputBaseFilename=SERVIX-{#MyAppVersion}-setup
; SetupIconFile removed (FAZA 8H): no .ico asset exists in the project.
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
DisableProgramGroupPage=yes
VersionInfoVersion={#MyAppVersion}
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
ShowLanguageDialog=yes

[Languages]
Name: english; MessagesFile: compiler:Default.isl
Name: romanian; MessagesFile: compiler:Languages\Romanian.isl

[Types]
Name: full; Description: Full installation
Name: compact; Description: Minimal installation
Name: custom; Description: Custom installation; Flags: iscustom

[Components]
Name: app; Description: SERVIX Application; Types: full compact custom; Flags: fixed
Name: service; Description: Windows Service (Auto-start); Types: full; Flags: fixed
Name: shortcuts; Description: Start Menu & Desktop Shortcuts; Types: full compact

[Dirs]
Name: {pf}\{#MyAppName}\app
Name: {pf}\{#MyAppName}\scripts
Name: {commonappdata}\{#MyAppName}\data
Name: {commonappdata}\{#MyAppName}\backups
Name: {commonappdata}\{#MyAppName}\logs
Name: {commonappdata}\{#MyAppName}\config

[Files]
; Frontend
Source: {#AppSourceDir}\frontend\*; DestDir: {pf}\{#MyAppName}\app\frontend; Flags: ignoreversion recursesubdirs createallsubdirs
; Server
Source: {#AppSourceDir}\server\*; DestDir: {pf}\{#MyAppName}\app\server; Flags: ignoreversion recursesubdirs createallsubdirs
; Bundled Node.js runtime (app-local, NOT installed globally)
Source: {#AppSourceDir}\runtime\*; DestDir: {pf}\{#MyAppName}\app\runtime; Flags: ignoreversion recursesubdirs createallsubdirs
; Shared version module
Source: {#AppSourceDir}\src\version.ts; DestDir: {pf}\{#MyAppName}\app\src; Flags: ignoreversion
; Configuration
Source: {#AppSourceDir}\.env.production; DestDir: {pf}\{#MyAppName}\app; Flags: ignoreversion
Source: {#AppSourceDir}\package.json; DestDir: {pf}\{#MyAppName}\app; Flags: ignoreversion
; Scripts
Source: {#AppSourceDir}\scripts\start-service.ps1; DestDir: {pf}\{#MyAppName}\scripts; Flags: ignoreversion
Source: {#AppSourceDir}\scripts\install-service.ps1; DestDir: {pf}\{#MyAppName}\scripts; Flags: ignoreversion
Source: {#AppSourceDir}\scripts\health-check.ps1; DestDir: {pf}\{#MyAppName}\scripts; Flags: ignoreversion
Source: {#AppSourceDir}\scripts\backup-db.ps1; DestDir: {pf}\{#MyAppName}\scripts; Flags: ignoreversion
Source: {#AppSourceDir}\scripts\uninstall.ps1; DestDir: {pf}\{#MyAppName}\scripts; Flags: ignoreversion

[Icons]
Name: {group}\SERVIX Admin; Filename: http://127.0.0.1:8787/; Comment: Open SERVIX Admin (Local Server)
Name: {group}\SERVIX Server Status; Filename: http://127.0.0.1:8787/api/health; Comment: SERVIX Local Server Health
Name: {group}\Uninstall SERVIX; Filename: {uninstallexe}
Name: {commondesktop}\SERVIX Admin; Filename: http://127.0.0.1:8787/; Comment: SERVIX Local Admin; Components: shortcuts

[Run]
Filename: powershell.exe; Parameters: -NoProfile -ExecutionPolicy Bypass -File ""{pf}\{#MyAppName}\scripts\install-service.ps1"""; Flags: waituntilterminated runhidden; Description: Registering SERVIX Windows Service...
Filename: powershell.exe; Parameters: -NoProfile -ExecutionPolicy Bypass -File ""{pf}\{#MyAppName}\scripts\health-check.ps1"""; Flags: waituntilterminated; Description: Verifying installation...

[UninstallRun]
Filename: powershell.exe; Parameters: -NoProfile -ExecutionPolicy Bypass -File ""{pf}\{#MyAppName}\scripts\uninstall.ps1"""; Flags: waituntilterminated runhidden

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    { Service registration + health check are executed by the [Run] entries. }
    { Uninstall never deletes %ProgramData%\SERVIX (database, backups, logs). }
  end;
end;
"@

$innoContent | Set-Content -Path "$BuildStaging\SERVIX-setup.iss" -Force
Write-Host "OK Inno Setup configuration created" -ForegroundColor Green

Write-Host ""
Write-Host "[7/7] Building installer package..." -ForegroundColor Yellow

if ($innoSetupPath -and (Test-Path $innoSetupPath)) {
    Write-Host "  Compiling with Inno Setup..." -ForegroundColor Yellow
    & $innoSetupPath "$BuildStaging\SERVIX-setup.iss"

    if ($LASTEXITCODE -eq 0) {
        $setupExe = Get-ChildItem -Path $InstallerOutput -Filter "*.exe" | Select-Object -First 1
        if ($setupExe) {
            Write-Host "OK Installer created: $($setupExe.FullName)" -ForegroundColor Green
            Write-Host "  Size: $('{0:N0}' -f $setupExe.Length) bytes" -ForegroundColor Green
        }
    } else {
        Write-Host "WARNING: Inno Setup compilation had issues (see above)" -ForegroundColor Yellow
    }
} else {
    Write-Host "WARNING: Inno Setup not available - generating configuration only" -ForegroundColor Yellow
    Write-Host "  Generated: $BuildStaging\SERVIX-setup.iss" -ForegroundColor Yellow
    Write-Host "  To build on Windows, download Inno Setup 6 and run:" -ForegroundColor Yellow
    Write-Host "  ISCC.exe $BuildStaging\SERVIX-setup.iss" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Build Complete" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Staging directory: $BuildStaging" -ForegroundColor Green
Write-Host "Output directory: $InstallerOutput" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. On Windows with Inno Setup 6, run:" -ForegroundColor Yellow
Write-Host "   ISCC.exe $BuildStaging\SERVIX-setup.iss" -ForegroundColor Yellow
Write-Host "2. Test the installer: $InstallerOutput\SERVIX-*.exe" -ForegroundColor Yellow
Write-Host "3. Verify Windows Service registration and startup" -ForegroundColor Yellow
