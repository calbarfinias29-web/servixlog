# SERVIX Production Configuration Management (FAZA 8F)

## Environment Variables for Production Windows Installation

This file documents the production environment configuration for SERVIX Local Server running as a Windows Service.

### Standard Locations

**Application Files:**
```
C:\Program Files\SERVIX\app\
├── frontend\          (built React app)
├── server\src\        (Node.js TypeScript server)
├── scripts\           (maintenance scripts)
├── package.json
└── .env.production    (configuration)
```

**User Data:**
```
%PROGRAMDATA%\SERVIX\
├── data\
│   └── servix-local.db      (SQLite database - user data)
├── backups\                 (database backups)
│   └── servix-local-backup-*.db
├── logs\
│   ├── servix-server.log    (service logs)
│   └── update.log           (update history)
└── config\
    └── .env                 (local overrides)
```

### Environment Variables (Production)

```ini
# Server Configuration
SERVIX_ENV=production
SERVIX_HOST=127.0.0.1           # Localhost only (default)
SERVIX_PORT=8787                # Local Server port
SERVIX_LAN_ENABLED=false         # LAN mode disabled by default

# Database
SERVIX_DB_PATH=C:\ProgramData\SERVIX\data\servix-local.db
SERVIX_SEED=true                # Initialize demo data (first run only)

# Runtime
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=512  # Memory limit if needed
```

### Loading Configuration

The Windows Service loads environment variables in this order:
1. System environment variables
2. `.env.production` in app directory
3. `.env` in ProgramData directory (local overrides)
4. Service-specific variables set via Windows Service manager

### Configuration Override

To override settings without reinstalling:
1. Edit `%PROGRAMDATA%\SERVIX\config\.env`
2. Restart SERVIX service: `net stop SERVIX` → `net start SERVIX`

Example override:
```ini
SERVIX_PORT=8888
SERVIX_LAN_ENABLED=true
SERVIX_LAN_ADDRESS=http://192.168.1.100:8787
```

### First Run Configuration

On first installation:
- Database is initialized in `%PROGRAMDATA%\SERVIX\data\`
- Demo data is seeded (marked as is_demo=1)
- Schema version is set to current version
- Health check verifies connectivity

### Backup Configuration

Before every update:
- Database is backed up to `%PROGRAMDATA%\SERVIX\backups\`
- Application files are backed up
- Backups are retained for 30 days (manual cleanup recommended)

### Logging

Logs are written to: `%PROGRAMDATA%\SERVIX\logs\servix-server.log`
- Service startup/shutdown events
- API access logs (optional)
- Error messages
- Recovery events

To view logs:
```powershell
Get-Content 'C:\ProgramData\SERVIX\logs\servix-server.log' -Tail 50
```

### Security Configuration

For production installations:
- Keep SERVIX_LAN_ENABLED=false (default)
- Use firewall to restrict port 8787 access
- Database backups should be included in system backup strategy
- No credentials or secrets in .env files (use system env vars if needed)

### Troubleshooting Configuration

If SERVIX doesn't start:
1. Check logs: `Get-Content 'C:\ProgramData\SERVIX\logs\servix-server.log'`
2. Verify database: `Test-Path 'C:\ProgramData\SERVIX\data\servix-local.db'`
3. Test health: `Invoke-WebRequest -Uri http://127.0.0.1:8787/api/health`
4. Check port conflict: `netstat -ano | findstr :8787`

### Production Best Practices

1. **Backup Strategy**
   - System should include `%PROGRAMDATA%\SERVIX\backups\` in backup policy
   - Database backups are created automatically before updates

2. **Monitoring**
   - Monitor `%PROGRAMDATA%\SERVIX\logs\` for errors
   - Set up Windows Event Viewer alerts for SERVIX service

3. **Updates**
   - Always run update script: `.\scripts\update-servix.ps1`
   - Never manually replace files - uses backup/rollback

4. **Disaster Recovery**
   - Database backups in backups directory
   - Application backups kept before each update
   - Full restore possible from any backup point

### Advanced: Enable LAN Access

To enable LAN access (optional, after initial setup):

```powershell
# Stop service
Stop-Service SERVIX

# Create config override
$config = @"
SERVIX_LAN_ENABLED=true
SERVIX_LAN_ADDRESS=http://192.168.1.100:8787
"@

$config | Set-Content 'C:\ProgramData\SERVIX\config\.env' -Force

# Restart service
Start-Service SERVIX

# Test local access (should still work)
Invoke-WebRequest -Uri http://127.0.0.1:8787/api/health

# Test LAN access (from another computer on network)
# Invoke-WebRequest -Uri http://192.168.1.100:8787/api/health
```

### Uninstall Configuration Preservation

When uninstalling:
- Application files are removed from `Program Files\SERVIX\`
- User data is PRESERVED in `%PROGRAMDATA%\SERVIX\`
- Re-installing uses existing database (no data loss)

To clean database during uninstall (optional):
```powershell
Remove-Item 'C:\ProgramData\SERVIX\data\servix-local.db' -Force
```
