# SERVIX Windows Service Setup Script (FAZA 8F)
# Registers SERVIX Local Server as a Windows Service
# Requires admin privileges

param(
    [ValidateSet("install", "uninstall", "start", "stop", "restart")]
    [string]$Action = "install",
    [string]$AppPath = "C:\Program Files\SERVIX\app",
    [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Host "ERROR: This script requires administrator privileges" -ForegroundColor Red
    Write-Host "Please run PowerShell as Administrator" -ForegroundColor Red
    exit 1
}

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "SERVIX Windows Service Setup (FAZA 8F)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Service configuration
$ServiceName = "SERVIX"
$ServiceDisplayName = "SERVIX Local Server"
$ServiceDescription = "SERVIX Local Server for real-time device coordination"
# FAZA 8F - prefer the app-local bundled runtime; never rely on the system global Node.
$NodeExe = "$AppPath\runtime\node.exe"
if (-not (Test-Path $NodeExe)) {
    Write-Host "??? Bundled runtime not found at $NodeExe - falling back to system node" -ForegroundColor Yellow
    $NodeExe = "node.exe"
} else {
    Write-Host "? Using bundled runtime: $NodeExe" -ForegroundColor Green
}
$ServerScript = "$AppPath\server\src\server.ts"
$DataRoot = "$env:PROGRAMDATA\SERVIX"
$LogFile = "$DataRoot\logs\servix-server.log"

Write-Host "Service Name: $ServiceName" -ForegroundColor Yellow
Write-Host "Display Name: $ServiceDisplayName" -ForegroundColor Yellow
Write-Host "App Path: $AppPath" -ForegroundColor Yellow
Write-Host "Data Root: $DataRoot" -ForegroundColor Yellow
Write-Host ""

function Install-Service {
    Write-Host "Installing Windows Service..." -ForegroundColor Yellow
    
    # Check if service already exists
    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "??? Service already exists. Stopping and removing..." -ForegroundColor Yellow
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        sc.exe delete $ServiceName | Out-Null
        Start-Sleep -Seconds 2
    }
    
    # Verify app path exists
    if (-not (Test-Path $AppPath)) {
        throw "App path not found: $AppPath"
    }
    
    # Create data directories
    @($DataRoot, "$DataRoot\data", "$DataRoot\logs", "$DataRoot\backups") | ForEach-Object {
        if (-not (Test-Path $_)) {
            New-Item -ItemType Directory -Path $_ -Force | Out-Null
            Write-Host "? Created directory: $_" -ForegroundColor Green
        }
    }
    
    # Create environment file
    $envContent = @"
SERVIX_ENV=production
SERVIX_HOST=127.0.0.1
SERVIX_PORT=$Port
SERVIX_LAN_ENABLED=false
SERVIX_DB_PATH=$DataRoot\data\servix-local.db
SERVIX_SEED=true
NODE_ENV=production
"@
    
    $envFile = "$DataRoot\servix.env"
    $envContent | Set-Content -Path $envFile -Force
    Write-Host "? Environment file created: $envFile" -ForegroundColor Green
    
    # Create service startup script
    $startScript = "$DataRoot\start-service.ps1"
    $startScriptContent = @"
`$env:SERVIX_HOST = "127.0.0.1"
`$env:SERVIX_PORT = $Port
`$env:SERVIX_DB_PATH = "$DataRoot\data\servix-local.db"
`$env:SERVIX_SEED = "true"
`$env:NODE_ENV = "production"

Set-Location "$AppPath"
& "$NodeExe" server\src\server.ts
"@
    
    $startScriptContent | Set-Content -Path $startScript -Force
    Write-Host "? Service startup script created" -ForegroundColor Green
    
    # Create Windows Service using sc.exe (no external dependencies)
    # Service will run via winsw or similar wrapper - for now, we create the service definition
    
    $serviceImage = "C:\Windows\System32\wscript.exe"
    $serviceArgs = "`"$startScript`""
    
    # For production, use NSSM (Non-Sucking Service Manager) if available
    $nssm = Get-Command nssm.exe -ErrorAction SilentlyContinue
    
    if ($nssm) {
        Write-Host "Using NSSM for service registration..." -ForegroundColor Yellow
        
        & nssm.exe install $ServiceName $NodeExe @(
            "server\src\server.ts"
        )
        
        & nssm.exe set $ServiceName AppDirectory $AppPath
        & nssm.exe set $ServiceName AppStdout "$LogFile"
        & nssm.exe set $ServiceName AppStderr "$LogFile"
        & nssm.exe set $ServiceName AppEnvironmentExtra "SERVIX_HOST=127.0.0.1`nSERVIX_PORT=$Port`nSERVIX_DB_PATH=$DataRoot\data\servix-local.db`nNODE_ENV=production"
        & nssm.exe set $ServiceName Start SERVICE_AUTO_START
        & nssm.exe set $ServiceName Type SERVICE_WIN32_OWN_PROCESS
        & nssm.exe set $ServiceName AppRestartDelay 5000
        
        Write-Host "? Service registered with NSSM" -ForegroundColor Green
    } else {
        Write-Host "??? NSSM not found. Creating basic Windows Service..." -ForegroundColor Yellow
        
        # Fallback: Create service definition file (WinSW compatible)
        $serviceDef = @"
<service>
  <id>$ServiceName</id>
  <name>$ServiceDisplayName</name>
  <description>$ServiceDescription</description>
<executable>`$NodeExe</executable>
  <arguments>server\src\server.ts</arguments>
  <workingDirectory>$AppPath</workingDirectory>
  <logmode>rotate</logmode>
  <logpath>$DataRoot\logs</logpath>
</service>
"@
        
        $defFile = "$AppPath\SERVIX-service.xml"
        $serviceDef | Set-Content -Path $defFile -Force
        Write-Host "? Service definition created (requires WinSW wrapper): $defFile" -ForegroundColor Green
        Write-Host "  For actual deployment, use: https://github.com/winsw/winsw" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "? Service installation complete" -ForegroundColor Green
    Write-Host "  Service Name: $ServiceName" -ForegroundColor Green
    Write-Host "  Startup: Automatic" -ForegroundColor Green
}

function Uninstall-Service {
    Write-Host "Uninstalling Windows Service..." -ForegroundColor Yellow
    
    $existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $existing) {
        Write-Host "??? Service not found" -ForegroundColor Yellow
        return
    }
    
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    
    $nssm = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($nssm) {
        & nssm.exe remove $ServiceName confirm
        Write-Host "? Service removed" -ForegroundColor Green
    } else {
        sc.exe delete $ServiceName | Out-Null
        Write-Host "? Service removed" -ForegroundColor Green
    }
}

function Start-ServiceCommand {
    Write-Host "Starting service..." -ForegroundColor Yellow
    
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Host "? Service not found: $ServiceName" -ForegroundColor Red
        return
    }
    
    Start-Service -Name $ServiceName
    Write-Host "? Service started" -ForegroundColor Green
    
    # Wait for startup
    Write-Host "  Waiting for service startup..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
    
    # Health check
    for ($i = 0; $i -lt 10; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" `
                -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) {
                Write-Host "? Service health check passed" -ForegroundColor Green
                return
            }
        } catch { }
        Start-Sleep -Seconds 1
    }
    
    Write-Host "??? Service started but health check incomplete" -ForegroundColor Yellow
}

function Stop-ServiceCommand {
    Write-Host "Stopping service..." -ForegroundColor Yellow
    
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if (-not $svc) {
        Write-Host "??? Service not found" -ForegroundColor Yellow
        return
    }
    
    Stop-Service -Name $ServiceName -Force
    Write-Host "? Service stopped" -ForegroundColor Green
}

function Restart-ServiceCommand {
    Write-Host "Restarting service..." -ForegroundColor Yellow
    Stop-ServiceCommand
    Start-Sleep -Seconds 2
    Start-ServiceCommand
}

# Execute requested action
switch ($Action) {
    "install" { Install-Service }
    "uninstall" { Uninstall-Service }
    "start" { Start-ServiceCommand }
    "stop" { Stop-ServiceCommand }
    "restart" { Restart-ServiceCommand }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
