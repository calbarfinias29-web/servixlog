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
