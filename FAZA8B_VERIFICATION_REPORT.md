# FAZA 8B Verification Report

## Status

PASS. The Local Server now has version, compatibility and backup infrastructure without changing Web/Supabase behavior, SQLite schema, Local authentication, LAN exposure, or data synchronization.

## Implemented

### Single version source

`src/version.ts` is the single product version source. It defines:

- `SERVIX_VERSION`: `0.1.0`
- `SERVIX_API_VERSION`: `1`
- `SERVIX_MIN_CLIENT_VERSION`: `0.1.0`

The browser can import the same module and the Local Server imports it through `server/src/compatibility.ts`; the values are not duplicated in server code.

### New Local endpoints

- `GET /api/version`

```json
{
  "appVersion": "0.1.0",
  "serverVersion": "0.1.0",
  "apiVersion": "1",
  "minClientVersion": "0.1.0",
  "currentSchemaVersion": 3,
  "targetSchemaVersion": 3
}
```

- `GET /api/health` now additionally returns `serverVersion`, `apiVersion`, `startedAt`, and `uptimeSeconds`. It continues to report SQLite state and the current SQLite schema version. It exposes no database path or configuration.

### Backup infrastructure

`server/src/backup.ts` adds `createDatabaseBackup()`.

- Uses SQLite `VACUUM INTO` for a consistent snapshot while the database remains online.
- Stores snapshots in a sibling `backups/` directory beside the configured database path.
- Uses a timestamped, reason-tagged filename and rejects collisions rather than overwriting.
- Requires a non-empty output file.
- Opens the produced snapshot read-only and runs `PRAGMA integrity_check` on the backup itself.
- Does not remove old backups and is not wired to automated update/schema operations yet.

### Compatibility infrastructure

`server/src/compatibility.ts` exposes a report-only `checkClientCompatibility()` result:

- `compatible`
- `client_too_old`
- `server_too_old`
- `api_incompatible`

It validates Semantic Versioning and API version equality but deliberately does not gate client requests yet.

### Startup behavior

Existing database initialization, schema migration, WAL/FK setup, seed control and timer auto-sync recovery remain intact. `createApp()` now receives one startup timestamp, making server lifetime observable through health without changing request behavior.

## Tests added

`server/tests/faza8b-infrastructure.test.ts`

1. `/api/version` exposes the shared version and schema compatibility contract.
2. `/api/health` exposes version, schema, startup timestamp and uptime.
3. Backup is created, non-empty, integrity-checked, and cannot overwrite a same-name backup.
4. Compatibility reports each supported/unsupported state.

Existing FAZA 7B auto-sync/recovery coverage remains part of the full server suite.

## Verification

| Check | Result |
|---|---|
| FAZA 8B infrastructure tests | PASS, 4/4 |
| All server, LocalDataAdapter and write tests | PASS, 107/107 |
| Agent tests | PASS |
| Typecheck | PASS |
| Production build | PASS |
| Diagnostics in 8B files | PASS, no errors |

## Files created

- `src/version.ts`
- `server/src/compatibility.ts`
- `server/src/backup.ts`
- `server/tests/faza8b-infrastructure.test.ts`
- `FAZA8B_VERIFICATION_REPORT.md`

## Files modified

- `server/src/server.ts`

## Not implemented in 8B

- Windows installer, bundled runtime, Windows Service, or data relocation to `%ProgramData%`.
- Automatic/scheduled backups, retention, restore workflow, or update rollback.
- SQLite schema upgrade beyond the existing migration path.
- Request blocking based on compatibility state.
- Version display in Admin UI.
- LAN binding, device pairing, TLS, device management, real-time transport, PWA, or Local Auth.
- Any Supabase modification, Supabase-to-SQLite synchronization, commit, push, or deploy.

## Limitations

The current development database remains at its existing configured location. Backup placement follows that configured database path; the `%ProgramData%` move belongs to the future installer/service phase. `VACUUM INTO` requires sufficient free disk space for a full snapshot and is expected to be invoked before critical operations by the future updater.
