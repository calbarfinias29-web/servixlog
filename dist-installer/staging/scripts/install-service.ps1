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
