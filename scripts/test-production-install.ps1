# SERVIX Production Install Simulation Test (FAZA 8F)
# Tests the production flow end-to-end WITHOUT touching ProgramData or the real DB:
#   1. Stage an app layout identical to the installed one (app/server/src, app/src, app/frontend, app/runtime)
#   2. First run  -> health, version, schema, seed rules
#   3. Existing data -> backup -> simulated update -> restart -> data preservation
#   4. Static frontend serving + path-traversal protection
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-production-install.ps1

$ErrorActionPreference = "Stop"
$root = (Get-Location).Path
$work = Join-Path $env:TEMP "servix-prodtest-$PID"
$app = Join-Path $work "app"
$data = Join-Path $work "ProgramData\SERVIX"
$port = 8811
$passed = 0; $failed = 0

function Check([string]$Name, [bool]$Condition) {
    if ($Condition) { Write-Host "  PASS  $Name" -ForegroundColor Green; $script:passed++ }
    else { Write-Host "  FAIL  $Name" -ForegroundColor Red; $script:failed++ }
}

function Start-ProdServer {
    $env:SERVIX_PORT = "$port"
    $env:SERVIX_HOST = "127.0.0.1"
    $env:SERVIX_DB_PATH = Join-Path $data "data\servix-local.db"
    $env:SERVIX_SEED = "true"
    $env:SERVIX_LAN_ENABLED = "false"
    $env:SERVIX_STATIC_DIR = Join-Path $app "frontend"
    $p = Start-Process -FilePath $script:nodeExe -ArgumentList "server\src\server.ts" -WorkingDirectory $app -PassThru -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $h = Invoke-WebRequest "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($h.StatusCode -eq 200) { return $p }
        } catch {}
        Start-Sleep -Milliseconds 500
    }
    return $p
}

function Stop-ProdServer($p) {
    if ($p -and -not $p.HasExited) {
        $p.CloseMainWindow() | Out-Null; Start-Sleep -Seconds 1
        if (-not $p.HasExited) { $p.Kill() }
        $p.WaitForExit()
    }
}

function Invoke-Json([string]$path) {
    (Invoke-WebRequest "http://127.0.0.1:$port$path" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
}

try {
    Write-Host "================================================" -ForegroundColor Cyan
    Write-Host "SERVIX Production Install Simulation (FAZA 8F)" -ForegroundColor Cyan
    Write-Host "================================================" -ForegroundColor Cyan

    # --- 1. Stage the app layout exactly like the installer does ---
    Write-Host "`n[1] Staging production app layout..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path "$app\server", "$app\src", "$app\frontend", "$app\runtime", "$data\data", "$data\backups", "$data\logs" -Force | Out-Null
    Copy-Item server\src "$app\server\src" -Recurse
    Copy-Item src\version.ts "$app\src\version.ts"
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) { Copy-Item $nodeCmd.Source "$app\runtime\node.exe" -Force }
    $script:nodeExe = if (Test-Path "$app\runtime\node.exe") { "$app\runtime\node.exe" } else { "node.exe" }
    if (Test-Path "dist\index.html") {
        Copy-Item dist\* "$app\frontend\" -Recurse -Force
    } else {
        # Minimal frontend stand-in if dist/ is not built
        '<html><body>SERVIX</body></html>' | Set-Content "$app\frontend\index.html"
    }
    Write-Host "  App: $app | Data: $data | Runtime: $($script:nodeExe)"

    # --- 2. First run: health / version / schema / seed ---
    Write-Host "`n[2] First run: startup + health + version + schema..." -ForegroundColor Yellow
    $proc = Start-ProdServer
    $health = Invoke-Json "/api/health"
    $version = Invoke-Json "/api/version"
    Check "GET /api/health returns ok=true" ([bool]$health.ok)
    Check "health reports sqlite connected" ($health.sqlite -eq "connected")
    Check "schemaVersion reported" ([bool]$health.schemaVersion)
    Check "GET /api/version returns apiVersion" ($version.apiVersion -eq "1")
    Check "version schema matches health" ($version.currentSchemaVersion -eq $health.schemaVersion)
    $emps = (Invoke-Json "/api/employees").employees
    Check "seed inserted demo employees (idempotent seed rules)" ($emps.Count -gt 0)

    # --- 3. Simulate user data (angajat custom) + backup before update ---
    Write-Host "`n[3] Injecting user data + backup before update..." -ForegroundColor Yellow
    Stop-ProdServer $proc
    $inject = Join-Path $work "inject.mjs"
    @"
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.env.SERVIX_DB_PATH);
db.prepare("INSERT INTO employees (id, name, role, active, created_at) VALUES ('emp-userdata-test','ANGAJAT TEST USERDATA','mecanic',1,?)").run(new Date().toISOString());
db.close();
console.log('injected');
"@ | Set-Content $inject
    & $script:nodeExe $inject | Out-Null
    # Backup exactly like backup-db.ps1 / update-servix.ps1 do (timestamped, never overwrites)
    $stamp = Get-Date -Format "yyyyMMddTHHmmss"
    $backup = Join-Path $data "backups\servix-local-pre-update-$stamp.db"
    Copy-Item (Join-Path $data "data\servix-local.db") $backup
    Check "backup created before update" (Test-Path $backup)
    Check "backup is a real SQLite file" ((Get-Item $backup).Length -gt 4096)

    # --- 4. Update simulation: restart, verify data preservation ---
    Write-Host "`n[4] Update simulation: restart + verify data preservation..." -ForegroundColor Yellow
    $proc = Start-ProdServer
    $health2 = Invoke-Json "/api/health"
    Check "server healthy after update" ([bool]$health2.ok)
    $emps2 = (Invoke-Json "/api/employees").employees
    $names = $emps2 | ForEach-Object { $_.name }
    Check "original seed data preserved" ($names.Count -ge $emps.Count)
    Check "user-injected employee preserved" ($names -contains "ANGAJAT TEST USERDATA")

    # --- 5. Static frontend + path traversal protection ---
    Write-Host "`n[5] Static frontend + security..." -ForegroundColor Yellow
    $homeResp = Invoke-WebRequest "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 5
    Check "GET / serves frontend (SPA entry)" ($homeResp.Content -match "html")
    $admin = Invoke-WebRequest "http://127.0.0.1:$port/admin" -UseBasicParsing -TimeoutSec 5
    Check "SPA fallback serves /admin" ($admin.StatusCode -eq 200)
    $trav = $null
    try { $trav = Invoke-WebRequest "http://127.0.0.1:$port/..%2f..%2f..%2fWindows%2fwin.ini" -UseBasicParsing -TimeoutSec 5 } catch {}
    $leaked = ($trav -ne $null) -and ($trav.Content -match "\[fonts\]")
    Check "path traversal rejected" (-not $leaked)

    Stop-ProdServer $proc

    # --- Summary ---
    Write-Host "`n================================================" -ForegroundColor Cyan
    Write-Host "Results: $passed passed, $failed failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
    if ($failed -eq 0) { Write-Host "PRODUCTION INSTALL SIMULATION: ALL CHECKS PASSED" -ForegroundColor Green }
    exit $(if ($failed -eq 0) { 0 } else { 1 })
} catch {
    Write-Host "FATAL: $_" -ForegroundColor Red
    exit 2
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}