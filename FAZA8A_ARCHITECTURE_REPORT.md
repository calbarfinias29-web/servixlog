# FAZA 8A - Architecture Report

## Scope and non-goals

This document designs the Windows-installed SERVIX Local product and its device model. It does not implement an installer, updater, LAN listener, device pairing, Local Auth, Supabase changes, or synchronization. Web remains `UI -> DataAdapter -> Supabase`; Local remains `UI -> DataAdapter -> LocalDataAdapter -> Local Server -> SQLite`. The databases remain independent.

## A. Main PC structure

Use a per-machine installation. Immutable application files and mutable service data must be separate.

```text
C:\Program Files\SERVIX\
  SERVIX.exe                    Desktop launcher / shell
  app\                          Versioned frontend assets
  server\                       Bundled Local Server and Node runtime
  version.json                  Product, UI and server versions

C:\ProgramData\SERVIX\
  config\
    service.json                service_id, bind mode, port, update channel
  data\
    servix-local.db             SQLite database
    servix-local.db-wal
    servix-local.db-shm
  logs\
    server-YYYY-MM-DD.log
    installer-YYYY-MM-DD.log
    updater-YYYY-MM-DD.log
  backups\
    servix-v1.2.0-preupdate-20260905T120000Z.db
    manifest.json
  devices\
    device-keys\                server-side encrypted pairing material
```

The Local Server runs as a Windows Service, for example `SERVIXLocalServer`, under a dedicated least-privilege local service account. It starts automatically after Windows boot and is configured for restart-on-failure. The desktop launcher checks `/api/health` before opening Local mode. If health fails, it shows a recovery screen with a service status and a safe retry/restart action; it must never silently fall back to Supabase.

Graceful stop sequence: stop accepting new requests, notify connected clients, finish/rollback in-flight SQLite transactions, close the HTTP server, close SQLite, then stop the process. On boot, open SQLite with WAL/FK checks, run a compatibility preflight, run only approved forward migrations, call timer recovery, then expose health as ready.

## B. Installer

Use one signed Windows installer, preferably MSIX only if service support and update policy are acceptable; otherwise use a signed WiX Burn/MSI bootstrapper. The installer bundles the frontend shell, Local Server executable, Node runtime, service registration, Start Menu/Desktop launchers and default configuration. The customer installs no Node.js, SQLite CLI, or server dependency manually.

Install: create `Program Files` binaries, create `ProgramData` data directories with restrictive ACLs, register/start the service, and open SERVIX.

Repair: verify installed hashes, restore missing immutable binaries, preserve `ProgramData` database/config/logs/backups, restart service, run health check.

Upgrade: stop controlled service, backup database, verify compatibility, replace immutable binaries, run schema upgrade when required, restart, health-check, retain rollback assets until success.

Uninstall: stop/remove service and remove application binaries. Default uninstall preserves `%ProgramData%\SERVIX` and offers a separate explicit data-removal option after warning and a final backup. Never delete SQLite automatically on upgrade/uninstall.

## C. Versioning

Adopt SemVer: `MAJOR.MINOR.PATCH` such as `1.0.0`, `1.0.1`, `1.1.0`, `2.0.0`.

A build artifact generates one `version.json` containing:

```json
{
  "productVersion": "1.0.0",
  "uiVersion": "1.0.0",
  "serverVersion": "1.0.0",
  "apiVersion": 1,
  "minClientApiVersion": 1,
  "maxClientApiVersion": 1,
  "sqliteSchemaVersion": 3,
  "buildId": "git-or-ci-build-id"
}
```

The server exposes this through `/api/health`. The UI reads it at startup and displays a compact Admin diagnostics version. A client may connect only when its supported API range overlaps the server API range. Schema version is checked server-side before ready. The future updater compares signed manifests and uses this contract before replacing binaries.

## D. Future update architecture

1. Download signed update manifest and payload.
2. Verify signer, product identity, version progression, disk capacity and client/server compatibility.
3. Place service in maintenance mode and reject new writes cleanly.
4. Create and verify SQLite backup.
5. Stop service and preserve previous immutable application directory.
6. Install new UI/server binaries.
7. Run idempotent forward schema upgrade only when declared by the manifest.
8. Start service and call health/readiness endpoint.
9. Start UI, verify API compatibility, mark update successful.
10. On any failure, stop new binary, restore previous binary, restore database only if schema migration was applied and failed, start old service, and retain diagnostic logs.

The updater must never use a cloud data sync or overwrite SQLite with Supabase data.

## E. SQLite backup architecture

Before every update or schema-changing operation, create a consistent snapshot using SQLite backup/VACUUM-into semantics while WAL is handled safely. Naming:

```text
servix-v{productVersion}-{reason}-{YYYYMMDDTHHMMSSZ}.db
```

Store sidecar metadata in `backups/manifest.json`: SHA-256, source schema version, target version, reason, timestamp, file size and integrity result. Validate each backup with `PRAGMA integrity_check` on a temporary read-only connection and checksum before proceeding.

Retention proposal: retain the latest 14 daily backups, 8 weekly backups, 12 monthly backups, and always the last known-good pre-update backup. Retention runs only after a successful verified backup; failed or currently referenced rollback backups are never purged.

## F. Device management model

Future SQLite records, introduced in a later approved schema change, should contain:

```text
services: service_id, display_name, created_at, server_public_key, api_version
devices: device_id, service_id, type, label, status, paired_at, last_seen_at, client_version, public_key, revoked_at, revoked_by
pairing_requests: pairing_id, service_id, device_type, expires_at, one_time_secret_hash, issued_at, consumed_at, revoked_at
```

Device types: `admin_companion`, `employee_tablet`, `employee_phone`. Status: `pending`, `active`, `revoked`, `expired`. Admin sees label, type, status, last connection, client version and revocation controls. Device authorization is independent from user login and Agent.

## G. Persistent QR/barcode pairing

A pairing code contains no long-term bearer secret. It carries a versioned bootstrap envelope:

```text
servix://pair/v1?service_id=...&pairing_id=...&server_hint=...&server_public_key=...&one_time_secret=...
```

The QR/barcode represents a one-time, short-lived enrollment secret. After scanning, the device generates a local keypair and submits the public key plus one-time secret over TLS to the server. The server consumes the secret once, creates a permanent `device_id`, and returns a device certificate/token bound to that public key. The device stores it in OS-protected storage. Normal reconnects use the device credential, not the printed/scanned code.

Revocation changes device state server-side and invalidates its credential immediately. A re-pair requires a newly issued code. The Admin UI can display/print the enrollment code but never displays the long-term credential.

## H. PC Companion flow

1. Main-PC Admin creates a pairing request labeled `PC Companion #01`.
2. Admin shows/prints a barcode encoding the one-time bootstrap envelope.
3. Companion scans/imports it, performs TLS key enrollment, then stores its device credential in Windows Credential Manager/DPAPI.
4. Companion opens the Admin UI in Local mode using the discovered/configured server URL.
5. It reconnects automatically with exponential backoff after Wi-Fi/service interruption. No daily re-pairing occurs.
6. Revocation blocks requests at the Local Server; companion displays "Device revoked" and removes its stored credential.

## I. Tablet and phone flow

1. Admin creates a pairing request labeled `Tablet #01` or `Phone #01`.
2. Device scans QR and validates server public-key fingerprint.
3. Device generates and registers its device key, receives a persistent credential, and opens Employee UI.
4. Reconnect is automatic after Wi-Fi changes. The server returns a clear revoked response when the device is disabled.

This is device authorization only. It does not add Local user passwords, JWT user sessions, or general Local Auth.

## J. LAN architecture

Future Local Server LAN mode is opt-in, never default. It changes bind address from `127.0.0.1` to a configured private-network interface, uses a fixed configurable port (default `8787`), firewall rules scoped to Private networks, TLS, device credential middleware, and an explicit origin allowlist.

Discovery priority:

1. Stable hostname such as `servix.local` using mDNS/DNS.
2. Pairing code server hint with public-key pinning.
3. Admin-visible manual URL fallback.

Dynamic DHCP IP changes are handled by hostname discovery. The pairing credential binds to `service_id` and server public key rather than IP. There is no public internet exposure, port forwarding, or cloud relay.

## K. Real-time recommendation

Use Server-Sent Events (SSE) for Local change notifications in the first LAN implementation. SQLite writes publish small typed events such as `car.updated`, `job.updated`, `timer.updated`, and `device.revoked`; clients re-fetch data through DataAdapter. SSE is simpler than WebSocket for server-to-client notifications, fits one-way dashboard refresh needs, preserves ordinary HTTP writes, and reconnects natively. Use a low-frequency bounded polling fallback only when SSE is unavailable. Do not implement it in 8A.

## L. Client/server compatibility

- Same API major: supported when version ranges overlap.
- Server API newer than a client range: client receives `UPDATE_REQUIRED` before normal operation.
- Client API newer than server: client receives `SERVER_UPDATE_REQUIRED` and does not send writes.
- PATCH releases must be wire-compatible.
- MINOR releases may add optional endpoints/fields.
- MAJOR/API changes require coordinated server-first update, then clients.
- Device records retain `client_version` and `last_seen_at` to show upgrade status in Admin.

A server must keep a compatibility window of at least the immediately preceding supported client minor version unless a security fix requires forced update.

## M. Security boundaries

- Local SQLite has no Supabase import/export/replication path.
- No Supabase service role or secrets in frontend/device code.
- Device credential is separate from user identity and Agent.
- Agent retains confirmation, allowlists, and no-arbitrary-SQL rules.
- Local server accepts writes only through validated endpoint allowlists.
- Pairing secrets are one-time and stored hashed server-side; permanent keys stay in OS-protected device storage.
- LAN mode requires TLS, key pinning during enrollment, device authorization, private-firewall scoping, and audit events for pair/revoke.

## N. Proposed Phase 8 subphases

| Subphase | Scope | Dependencies | Explicitly excluded | Required tests |
|---|---|---|---|---|
| 8A | Architecture, artifact and protocol design | Current Local adapter/server | Installer, LAN, pairing implementation | Document review, threat model review |
| 8B | Packaging foundation and version manifest | Signed CI artifacts | Auto-update, LAN | Fresh install, repair, uninstall-preserve-data, health/version contract |
| 8C | Windows service and data relocation | 8B | LAN, pairing | Boot recovery, service restart, locked DB, graceful shutdown |
| 8D | Backup/update engine | 8B, 8C | Cloud sync, device pairing | Backup integrity, interrupted update rollback, schema-forward migration |
| 8E | LAN transport and TLS | 8C | Device UI, public internet | Interface binding, private firewall, hostname/manual discovery, TLS pinning |
| 8F | Device pairing and revocation API | 8E, approved schema change | User Auth | One-time enrollment, persistent reconnect, revoke/reactivate, forged token rejection |
| 8G | Device management Admin UI | 8F | UI redesign, PWA | Status/last-seen rendering, revoke flow, printed code, compatibility warnings |
| 8H | SSE real-time and client compatibility gates | 8E, 8F | Supabase sync | Event ordering, reconnect, offline fallback, mixed client versions |
| 8I | Tablet/PWA deployment polish | 8F-8H | Public internet | Device viewport matrix, install/update behavior, revoked offline state |

## Decisions to approve before implementation

1. Packaging choice: WiX/MSI bootstrapper versus MSIX with service constraints.
2. Service account and exact `ProgramData` ACL policy.
3. Code-signing certificate and update-manifest signing key custody.
4. TLS certificate/private LAN trust model and mDNS hostname.
5. Device credential format and Windows/mobile secure-storage targets.
6. Backup retention numbers and whether backups may be encrypted at rest.

No installer, service, schema migration, pairing mechanism, LAN exposure, updater, Auth Local, synchronization, commit, push, or deploy was implemented in this phase.
