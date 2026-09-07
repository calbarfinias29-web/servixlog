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
