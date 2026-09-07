# FAZA 8H — Installer Validation Report

Data: 2026-09-07
Build: SERVIX 2.0 — Release Candidate

## A. Executive Summary

FAZA 8H verified the packaging / installer / Windows Service infrastructure built in FAZA 8F and
re-ran the full automated baseline (8G). **A real installer `.exe` could NOT be compiled because
Inno Setup 6 is not installed on this machine.** All layers that *can* be validated without modifying
the Windows environment were validated and pass. One automated test (`server/tests/faza8g-e2e.test.ts`
**K2**) fails in this run for a **time-of-day-dependent** reason — it is a test-hygiene issue, not a
production-code defect (proof below).

**Verdict: RELEASE CANDIDATE — BLOCKED BY ENVIRONMENT** (installer compilation requires Inno Setup 6,
and physical Windows-Service / clean-install / LAN / interactive-browser testing require resources not
present or actions that modify the environment without approval).

No source code, schema, Agent, timer or configuration files were modified. Nothing was committed,
pushed or deployed.

## B. Environment

| Item | Value | Status |
|---|---|---|
| OS | Microsoft Windows 11 Pro (10.0.26200, x64) | PASS |
| Node | v24.18.0 | PASS |
| npm | 11.16.0 | PASS |
| PowerShell | 5.x+ (Windows PowerShell) | PASS |
| Inno Setup 6 | **NOT INSTALLED** — ISCC.exe absent (`C:\Program Files (x86)\Inno Setup 6\ISCC.exe`, `C:\Program Files\Inno Setup 6\ISCC.exe` both missing) | **MISSING** |
| System time at validation | 2026-09-07 20:03 +03:00 (Bucharest) | — |

Per the STOP rule, Inno Setup 6 was **not** installed automatically. Installer compilation is therefore
`BLOCKED`.

## C. Existing Packaging (FAZA 8F) — confirmed

Existing layout: `scripts/` (build-installer.ps1, windows-service-setup.ps1, validate-installer.ps1,
test-production-install.ps1, update-servix.ps1), `dist-installer/staging` (app layout + bundled runtime),
`dist-installer/installer` (**empty — no .exe**), `dist-installer/staging/SERVIX-setup.iss`.

| # | Criterion | Status |
|---|---|---|
| 1 | Node.js runtime bundled (app-local, not global) | PASS — `staging\runtime\node.exe` |
| 2 | Zero-dependency local server | PASS — `node:http` + `node:sqlite` only |
| 3 | Production server serves static frontend | PASS — prod-install sim `GET /` returns built frontend |
| 4 | GET-only static serving preserved | PASS — non-GET rejected (405) before static path |
| 5 | Path-traversal protection preserved | PASS — `safeStaticPath()`; e2e G2 + prod-install sim |
| 6 | SPA fallback preserved | PASS — `/admin` → 200 index.html (prod-install sim) |
| 7 | `nosniff` preserved | PASS — `X-Content-Type-Options: nosniff` in static responses |
| 8 | Log rotation preserved | PASS — `start-service.ps1` rotates >5 MB log to `.old` |
| 9 | Config from ProgramData supported | PASS — `ProgramData\SERVIX\config\.env` overrides loaded |
| 10 | SQLite DB separated from app files | PASS — `ProgramData\SERVIX\data\servix-local.db` |
| 11 | Backups separated from app files | PASS — `ProgramData\SERVIX\backups` |
| 12 | Logs separated from app files | PASS — `ProgramData\SERVIX\logs` |
| 13 | Local shortcut creatable | PASS (configured in `.iss` `[Icons]`); physical creation is install-time → NOT TESTED |
| 14 | Local port 8787 used | PASS — `config.ts` default `8787`, `SERVIX_PORT=8787` in `.env.production` |
| 15 | Health endpoint works | PASS — `/api/health` ok=true, sqlite connected (prod-install sim) |

Validation scripts executed (non-destructive, temp dirs only):

- `scripts/validate-installer.ps1` → **32 passed / 1 failed**. The single failure is
  *"Installer executable created"* — expected, because Inno Setup 6 is absent. Everything else passes.
- `scripts/test-production-install.ps1` → **14 / 14 PASS** (health, version, schema, idempotent seed,
  backup before update, data preservation after restart, static frontend, SPA fallback, path-traversal
  rejection), using fixed temp staging + temp ProgramData, bundled `runtime\node.exe`.

## D. Installer

- Staging is prepared and structurally valid (`frontend`, `server`, `runtime`, `src\version.ts`,
  `package.json`, `.env.production`, `scripts\*`, `SERVIX-setup.iss`).
- `.iss` was statically reviewed: targets `Program Files\SERVIX`, creates `ProgramData\SERVIX\{data,backups,logs,config}`,
  installs app files + bundled runtime + scripts, creates Start-Menu/Desktop shortcuts to
  `http://127.0.0.1:8787/`, runs service registration + health check on install, and NEVER deletes
  `ProgramData\SERVIX` on uninstall (data/backups/logs preserved).
- **Compilation: BLOCKED** — `ISCC.exe` not installed. CLI needed:
  `iscc.exe dist-installer\staging\SERVIX-setup.iss` → `dist-installer\installer\SERVIX-2.0.0-setup.exe`.

## E. Windows Service

- Implemented with native `sc.exe` (no NSSM / no WinSW) — compliant with the requirement. Service name
  `SERVIX`, `start= auto`, crash recovery via `sc failure ... actions=restart/5000/restart/30000/restart/60000`,
  uses bundled `runtime\node.exe` with a system-node fallback warning, runs `start-service.ps1`.
- All service logic validated statically and through the prod-install simulation (config load, ProgramData
  dirs, bundled runtime, health). **Physical service install / start / crash-restart was NOT performed** —
  it requires Administrator rights and modifies the live Windows environment (STOP rule). → **NOT TESTED (env-blocked)**.

## F. Clean Install Test

No clean Windows VM / clean environment is available, and a real install would modify the system.
→ **NOT TESTED**.

## G. Browser Smoke Test

No interactive browser is available in this environment. UI screens (Admin dashboard, Employee local,
themes, reports, pairing QR) remain covered by the automated API suites only. → **NOT TESTED**.

## H. LAN Test

LAN is disabled by default (`SERVIX_LAN_ENABLED=false`), no second physical device/interface available,
and exposing LAN + firewall changes are blocked by the STOP rule. → **NOT TESTED**. LAN authentication
code is covered by automated tests (pairing lifecycle, revoked device rejection).

## I. Backup / Restore

- `test-production-install.ps1` created a real timestamped SQLite backup and verified data preservation
  after simulated update/restart (14/14 PASS).
- A local restore smoke test on a **temporary** database (VACUUM INTO + `integrity_check` + pre-change data
  recovered) passed.
- **Restore on a real installed instance was not performed** (would require a real install). → **PASS (simulated, temp data) /
  NOT TESTED (physical install)**.

## J. Security

- Scanned `dist-installer\staging` for secrets. **No** `service_role`/`eyJ…` JWT, API key, credential,
  `.env` with secrets, development database, `.wrangler` folder, logs or backups are staged.
  Matches are benign: minified JS strings, `node.exe` licensing text, and source comments mentioning
  "Supabase". The only path-like artifact is `staging\frontend\wrangler.json` (a Cloudflare static
  config containing a local config path — no credential). `security` suite 25/25 PASS.
- Local server does not expose arbitrary SQL; frontend receives no service_role; static server blocks
  path traversal; LAN auth remains active; pairing credentials stored hash-only. → **PASS**.

## K. Versioning — **INCONSISTENCY FOUND (reported, not changed)**

| Source | Version |
|---|---|
| `src/version.ts` → `SERVIX_VERSION` | `0.1.0` |
| `src/version.ts` → `SERVIX_API_VERSION` | `1` |
| `package.json` → `version` | `0.0.0` |
| `dist-installer/staging/SERVIX-setup.iss` → `MyAppVersion` / installer filename | `2.0.0` |
| `scripts/build-installer.ps1` default `-Version` | `2.0.0` |

These are **not consistent**. Per FAZA 8H rules I did not invent or force a version; the discrepancy is
reported so the team can pick the single source of truth before release.

## L. Automated Tests (re-run in this environment)

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| server/tests | 135 | 134 | **1** |
| server/tests-write | 20 | 20 | 0 |
| server/tests-local | 22 | 22 | 0 |
| test:security | 25 | 25 | 0 |
| test:readonly-audit | 6 | 6 | 0 |
| test:agent | 65 | 65 | 0 |
| **Total** | **273** | **272** | **1** |

- Typecheck (`npm run typecheck`): **PASS**
- Production build (`npm run build`): **PASS** (pre-existing >500 kB chunk warning only)

## M. Issues Found

1. **`server/tests/faza8g-e2e.test.ts` — K2 "Auto-sync handles active session gracefully" FAILS
   (52/53)** — `TypeError: Cannot read properties of null (reading 'state')` at line 696.
   - **Root cause (proven, not a production regression):** the test calls
     `checkAutoSyncWindows(dx.db, Date.now())` and asserts the session stays `running`. When the suite
     runs **after 18:00 local time** (work_end), the auto-sync correctly reconciles the running session
     (→ closed, `session: null`), so the assertion fails.
   - Proof (isolated probe on a fresh temp DB): `nowMs=09:00` → session stays `running` (PASS path);
     `nowMs=Date.now()` at 20:03 → session becomes `NULL` (FAIL path).
   - This makes the 8G-reported `135/135` **time-of-day-dependent**. The production code is behaving
     correctly; the test hard-codes a non-deterministic `Date.now()`.
   - **Not modified** (rules: do not mask/delete/adjust tests to force green). Needs an approved fix:
     pass a fixed morning `nowMs` (e.g. `new Date('...T09:00:00Z')`) in K2.
2. **Installer `.exe` not compilable here** — Inno Setup 6 missing (env blocker).
3. **Versioning inconsistent** between `src/version.ts` (0.1.0), `package.json` (0.0.0) and the
   installer (2.0.0) — see Section K.

## N. Fixes Applied

- **None.** No source, schema, config, test, Agent or timer code was changed. The only artifact created
  during validation (a throwaway probe script + log) was removed. Everything was validated as-is.

## O. NOT TESTED / BLOCKED

| Item | Status |
|---|---|
| Installer `.exe` compilation | **BLOCKED** (Inno Setup 6 absent) |
| Windows Service lifecycle (install/start/stop/restart/crash-recovery) | **NOT TESTED** (env-blocked) |
| Clean Windows VM install (UAC, Program Files, ProgramData, first-run) | **NOT TESTED** |
| Interactive browser smoke (Admin / Employee UI, themes, reports, QR) | **NOT TESTED** |
| LAN physical test (second device, real interface) | **NOT TESTED** |
| Restore on a real installed instance | **NOT TESTED** (simulation PASS) |

## P. Release Checklist

| Criterion | Status |
|---|---|
| Frontend production build | PASS |
| Staging package valid (files, runtime, scripts, config, .iss) | PASS |
| Bundled Node runtime | PASS |
| Zero-dependency server | PASS |
| Static serving + SPA fallback + path traversal + nosniff | PASS |
| ProgramData config / data / backups / logs separation | PASS |
| Backup + data preservation (simulated update) | PASS |
| Health + version endpoints | PASS |
| Security / no secrets in package | PASS |
| Windows Service definition (sc.exe, auto, recovery) | PASS (static) — physical NOT TESTED |
| Installer `.exe` | **BLOCKED** |
| Automated baseline 273/273 | **272/273** (K2 time-of-day flaky test; prod code correct) |
| Version consistency | **FAIL** (0.1.0 / 0.0.0 / 2.0.0) |

## Q. Final Verdict

**RELEASE CANDIDATE — BLOCKED BY ENVIRONMENT**

The installable product cannot be produced/validated in this environment (Inno Setup 6 missing, no clean
VM, no second LAN device, no interactive browser, and physical service/system changes require approval).
The package itself is valid and the production core passes all non-environmental checks. One automated
test is wall-clock-dependent (K2) and must be fixed (approved change) to restore a fully deterministic
273/273 baseline; it is **not** a production defect.

---

*No commit, no push, no deploy.*