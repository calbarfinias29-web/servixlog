# FAZA 8C Verification Report

## Status

PASS for the requested Local LAN and persistent device-pairing infrastructure. LAN remains disabled by default and no UI, installer, Windows Service, general Local Auth, Supabase change, or synchronization was added.

## Device registry architecture

SQLite schema version is now `4`. A new `devices` table stores only:

- Stable UUID `device_id`
- `device_type`: `MAIN_PC`, `PC_COMPANION`, `TABLET`, or `PHONE`
- Human-readable `device_name`
- `status`: `pending`, `paired`, or `revoked`
- Per-device credential salt and SHA-256 hash
- API version and lifecycle timestamps: created, paired, last seen, revoked

Plaintext credentials are never stored. Device listing responses omit both credential material and its hash. Device history remains after revocation.

## Pairing flow

1. The Main PC calls `POST /api/devices/pair` with device type and name.
2. The server generates a UUID identity plus a cryptographically random 32-byte credential.
3. The server stores only a salted SHA-256 credential hash and returns the credential once, for later QR/barcode transport.
4. The device calls `POST /api/devices/pair/confirm` with device ID and credential.
5. The server validates it with constant-time comparison, marks the device `paired`, and sets `pairedAt`/`lastSeenAt`.
6. Reconnects use `x-servix-device-id` and `x-servix-device-credential` through `POST /api/devices/heartbeat`.
7. Restart does not affect a stored pairing.

No daily credential regeneration or re-pairing is required.

## Revoke/reactivate flow

- `POST /api/devices/revoke` marks the device server-side as `revoked` and preserves its record.
- Heartbeat with an old credential is rejected after revocation.
- `POST /api/devices/reactivate` creates a new salted credential hash, clears paired/last-seen/revocation timestamps, and returns a new credential once.
- The reactivated device must confirm pairing again. The old credential remains invalid.

## Endpoints

| Endpoint | Purpose | Boundary |
|---|---|---|
| `GET /api/devices` | List safe device metadata | Main-PC loopback only |
| `POST /api/devices/pair` | Initiate pairing; returns credential once | Main-PC loopback only |
| `POST /api/devices/pair/confirm` | Validate issued credential and activate device | Pairing public endpoint |
| `POST /api/devices/heartbeat` | Update `lastSeenAt` | Paired device credential required |
| `POST /api/devices/revoke` | Server-side revocation | Main-PC loopback only |
| `POST /api/devices/reactivate` | Issue replacement pairing credential | Main-PC loopback only |

Credentials are sent only in pairing confirmation bodies or device headers. They are neither returned by `GET /api/devices` nor printed by the server.

## LAN configuration

`SERVIX_LAN_ENABLED=false` is the default and retains `127.0.0.1` binding. When explicitly set to `true`, the default bind becomes `0.0.0.0`; callers may still set `SERVIX_HOST` explicitly. For LAN mode, requests from non-loopback clients to non-public data endpoints must present valid paired-device headers. The current Main PC loopback path remains compatible with existing Local Admin/frontend use.

This does not configure public internet access, router forwarding, discovery, TLS, firewall policy, companion UI, QR/barcode rendering, or device-management UI.

## Security boundaries

- Device pairing is device authorization, not user login/Auth.
- No user credential/JWT/password flow was introduced.
- No Supabase secret, service-role client, arbitrary SQL, database download endpoint, filesystem endpoint, or Agent change was introduced.
- Local and Supabase databases remain independent; there is no import/export/replication/synchronization.
- Management endpoints are loopback-only in this phase because a separate Local Admin authorization model is explicitly out of scope.

## Schema safety and backups

Before the actual upgrade of the existing development database, an integrity-checked snapshot was created:

```text
server/data/backups/servix-local-pre-faza8c-schema-20260905T070919Z.db
```

`createDatabase()` now also creates an integrity-checked backup automatically before a forward schema upgrade of an existing database, including legacy databases at `user_version = 0`. New databases are not backed up before first schema creation. Existing data is preserved by the forward migration.

## Tests

| Check | Result |
|---|---|
| Device/schema focused tests | PASS, 8/8 |
| Full server, LocalDataAdapter and write tests | PASS |
| Agent tests | PASS |
| Security tests | PASS |
| Readonly audit | PASS |
| Typecheck | PASS |
| Build | PASS |
| `/api/version` | PASS, schema v4 |
| `/api/devices` | PASS, safe empty/metadata registry response |

Device coverage includes identity creation, stable ID after restart, pair confirmation, invalid credential, authorized heartbeat, last-seen update, revoke, reactivation with replacement credential, multiple devices, simultaneous pairing, hidden credential data, LAN disabled-by-default, schema upgrade preservation, and pre-upgrade backup integrity.

## Files created

- `server/src/devices.ts`
- `server/tests/faza8c-devices.test.ts`
- `FAZA8C_VERIFICATION_REPORT.md`

## Files modified

- `server/src/schema.ts`
- `server/src/config.ts`
- `server/src/db.ts`
- `server/src/server.ts`
- `server/tests/schema-upgrade.test.ts`

## Known limitations and next recommendation

The future 8D should implement TLS/private-network firewall configuration, QR/barcode payload generation and display, device-management Admin UI, delivery/storage of pairing credentials, and an explicit client request middleware in `LocalDataAdapter` for device headers. SSE remains the recommended next real-time transport: the server sends change events and clients re-fetch via existing adapter APIs.

No commit, push, deploy, installer, Windows service, user Auth, Supabase migration, Supabase change, or synchronization was performed.
