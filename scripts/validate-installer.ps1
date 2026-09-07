# SERVIX Installer Validation Script (FAZA 8F)
# Validates build artifacts and installer prerequisites

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "SERVIX Installer Validation (FAZA 8F)" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$ProjectRoot = Get-Location
$BuildDir = ".\dist-installer"
$StagingDir = "$BuildDir\staging"
$InstallerDir = "$BuildDir\installer"
$TestsPassed = 0
$TestsFailed = 0

function Test {
    param(
        [string]$Name,
        [scriptblock]$Condition
    )
    
    Write-Host "  Testing: $Name..." -NoNewline
    try {
        if (& $Condition) {
            Write-Host " ✓" -ForegroundColor Green
            $script:TestsPassed++
        } else {
            Write-Host " ✗" -ForegroundColor Red
            $script:TestsFailed++
        }
    } catch {
        Write-Host " ✗ (Error: $_)" -ForegroundColor Red
        $script:TestsFailed++
    }
}

# Validation Suites
Write-Host "1. Project Structure" -ForegroundColor Yellow
Test "package.json exists" { Test-Path "package.json" }
Test "server/src/server.ts exists" { Test-Path "server\src\server.ts" }
Test "vite.config.ts exists" { Test-Path "vite.config.ts" }
Test "index.html exists" { Test-Path "index.html" }
Test "src directory exists" { Test-Path "src" -PathType Container }
Write-Host ""

Write-Host "2. Build Artifacts" -ForegroundColor Yellow
Test "dist directory exists" { Test-Path "dist" -PathType Container }
Test "dist/index.html exists" { Test-Path "dist\index.html" }
Test "dist/assets directory exists" { Test-Path "dist\assets" -PathType Container }
Write-Host ""

Write-Host "3. Staging Directory" -ForegroundColor Yellow
Test "Staging directory created" { Test-Path $StagingDir -PathType Container }
Test "Frontend copied" { Test-Path "$StagingDir\frontend" -PathType Container }
Test "Server copied" { Test-Path "$StagingDir\server\src" -PathType Container }
Test "Configuration file" { Test-Path "$StagingDir\.env.production" }
Test "Package.json in staging" { Test-Path "$StagingDir\package.json" }
Test "Bundled Node runtime present" { Test-Path "$StagingDir\runtime\node.exe" }
Test "Shared version module staged" { Test-Path "$StagingDir\src\version.ts" }
Write-Host ""

Write-Host "4. Setup Scripts" -ForegroundColor Yellow
Test "Inno Setup config" { Test-Path "$StagingDir\SERVIX-setup.iss" }
Test "Service startup script" { Test-Path "$StagingDir\scripts\start-service.ps1" }
Test "Health check script" { Test-Path "$StagingDir\scripts\health-check.ps1" }
Test "Backup script" { Test-Path "$StagingDir\scripts\backup-db.ps1" }
Test "Uninstall script" { Test-Path "$StagingDir\scripts\uninstall.ps1" }
Write-Host ""

Write-Host "5. Installer Artifacts" -ForegroundColor Yellow
$exeFiles = Get-ChildItem -Path $InstallerDir -Filter "*.exe" -ErrorAction SilentlyContinue
Test "Installer executable created" { $exeFiles.Count -gt 0 }
if ($exeFiles) {
    foreach ($exe in $exeFiles) {
        Write-Host "    Found: $($exe.Name) ($([math]::Round($exe.Length / 1MB, 2)) MB)" -ForegroundColor Cyan
    }
}
Write-Host ""

Write-Host "6. Configuration Files" -ForegroundColor Yellow
Test "Production env file" { Test-Path "$StagingDir\.env.production" }
if (Test-Path "$StagingDir\.env.production") {
    $envContent = Get-Content "$StagingDir\.env.production"
    Test "ENV has SERVIX_HOST" { $envContent -match "SERVIX_HOST" }
    Test "ENV has SERVIX_PORT" { $envContent -match "SERVIX_PORT" }
    Test "ENV has SERVIX_DB_PATH" { $envContent -match "SERVIX_DB_PATH" }
}
Write-Host ""

Write-Host "7. Server Code Quality" -ForegroundColor Yellow
Test "Server TypeScript compiles" { 
    & npm run typecheck 2>&1 | Select-String "error" | Measure-Object | Select-Object -ExpandProperty Count | ForEach-Object { $_ -eq 0 }
}
Write-Host ""

Write-Host "8. Windows Registry Simulation" -ForegroundColor Yellow
Test "Can create staging directory" { New-Item -ItemType Directory -Path "$env:TEMP\servix-test-$$" -Force | Test-Path }
Test "Can write files" { "test" | Set-Content "$env:TEMP\servix-test-write-$$.txt" -Force; Test-Path "$env:TEMP\servix-test-write-$$.txt" }
Write-Host ""

Write-Host "9. Prerequisites" -ForegroundColor Yellow
Test "Node.js available" { Get-Command node -ErrorAction SilentlyContinue }
Test "npm available" { Get-Command npm -ErrorAction SilentlyContinue }
Test "PowerShell 5.0+" { $PSVersionTable.PSVersion.Major -ge 5 }
Write-Host ""

Write-Host "10. File Size Validation" -ForegroundColor Yellow
if (Test-Path "$StagingDir\frontend") {
    $frontendSize = (Get-ChildItem "$StagingDir\frontend" -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host "  Frontend size: $([math]::Round($frontendSize, 2)) MB" -ForegroundColor Cyan
    Test "Frontend reasonable size" { $frontendSize -lt 100 }
}

if (Test-Path "$StagingDir\server") {
    $serverSize = (Get-ChildItem "$StagingDir\server" -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host "  Server size: $([math]::Round($serverSize, 2)) MB" -ForegroundColor Cyan
    Test "Server reasonable size" { $serverSize -lt 50 }
}
Write-Host ""

# Summary
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Validation Results" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "Passed: $TestsPassed" -ForegroundColor Green
Write-Host "Failed: $TestsFailed" -ForegroundColor Red
Write-Host ""

if ($TestsFailed -eq 0) {
    Write-Host "✓ ALL VALIDATIONS PASSED" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "1. Review Inno Setup script: $StagingDir\SERVIX-setup.iss" -ForegroundColor Yellow
    Write-Host "2. On Windows, run ISCC.exe to build .exe" -ForegroundColor Yellow
    Write-Host "3. Test installer on Windows system" -ForegroundColor Yellow
    Write-Host "4. Verify service startup and health checks" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "✗ VALIDATION FAILED" -ForegroundColor Red
    Write-Host "Fix the issues above before continuing" -ForegroundColor Red
    exit 1
}
