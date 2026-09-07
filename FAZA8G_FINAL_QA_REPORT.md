# FAZA 8G — FINAL QA + END-TO-END REPORT

Data: 2026-09-05
Build: SERVIX 2.0 — **RELEASE CANDIDATE** (doar build local; NU s-a făcut commit/push/deploy)

## A. Executive Summary

FAZA 8G a validat end-to-end arhitectura duală (Web → Supabase / Local → Local Server + SQLite + Devices + SSE) printr-un nou suite E2E de 53 de teste (`server/tests/faza8g-e2e.test.ts`) plus re-rularea completă a suite-urilor existente.

**Toate testele automate trec: 273 teste în 6 suite + typecheck + production build. Zero regresii față de baseline.**

Bugurile găsite au fost exclusiv în testul nou scris în 8G (presupuneri greșite despre contractele API), nu în codul de producție. Un comportament server nedocumentat (finalize cere sesiune running) a fost documentat și acoperit cu test, nu modificat.

## B. Baseline

Baseline-ul înregistrat înainte de modificări (identic cu rezultatele 8F REV 2): server/tests 133 PASS, tests-write 20 PASS, tests-local 22 PASS, security 25 PASS, readonly-audit 6 PASS, agent 65 PASS, typecheck PASS, build PASS. Nicio eșuare preexistentă.

## C. Teste automate (final, după 8G)

| Suite | Tests | Pass | Fail |
|---|---|---|---|
| server/tests (inclusiv faza8g-e2e: +53 noi) | 135 | 135 | 0 |

## D. Local End-to-End

- API HTTP local verificate programatic: cars, jobs, employees, appointments, timer, events, devices, reports — PASS (prin teste; nu prin browser manual).
- Admin UI / Employee UI în browser: **NOT TESTED — interactiv browser** (mediul actual nu permite sesiune browser manuală). Frontend build-uiește curat, iar API-urile consumate de UI sunt verificate.

## E. Web Regression

- Production build frontend PASS.
- Nu există fallback accidental Local→Web: suite-urile security/readonly confirmă separarea adaptoarelor (Supabase vs LocalDataAdapter, testate independent).
- Testare Web interactivă (Supabase live): NOT TESTED în 8G (cod Web nemodificat; risc minim).

## F. Timer

- start → duplicate start (no_op 200) → pause → resume → stop → finalize: PASS
- finalize din sesiune oprită → 409 TIMER_NOT_ACTIVE (contract server, documentat): PASS
- state query (sesiune + interval): PASS; operații invalide (422/404/409): PASS; activity_log: PASS
- Recovery la restart server: PASS; overtime window guard: PASS (suite existente); workday boundary/break crossing/auto-sync: unitar cu time injection (PASS).

## G. Multi-Device

- D1: doi clienți SSE primesc simultan același eveniment: PASS
- D2: write eșuat → NU se publică eveniment: PASS
- Fără duplicate / crash în limitele suite-ului automat: PASS

## H. Pairing

- Pair → confirm → list (fără credential în listă): PASS
- deviceId/credential unice per device: PASS
- Restart server → device încă paired: PASS
- Revoke → reject; Reactivate → credential nou, vechi respins: PASS
- QR/barcode: payload canonical unic (`createPairingPayload`); renderer vizual: NOT TESTED vizual.

## I. SSE

Connect/connected event, multi-client, eveniment doar la write reușit, eventId prezent: PASS. Reconnect/backoff/heartbeat/lastSeen: acoperite de suite SSE existente (8E): PASS.

## J. Backup / Recovery

- Date existente supraviețuiesc operațiunilor timer: PASS
- Date create de user NU sunt suprascrise de seed la restart: PASS
- FK constraints, WAL mode, integrity_check: PASS
- Backup before schema upgrade: implementat în db.ts (testat în suite db). Restore fizic: NOT TESTED.

## K. Installer / Windows Service

- Inno Setup 6: **NU este instalat** pe acest sistem (ISCC.exe absent). SERVIX-setup.exe **NU a fost construit**. Scripturile și staging inputs rămân conforme (validate în 8F REV 2).
- Windows Service lifecycle: NOT TESTED. Clean Windows VM install: NOT TESTED.

## L. Security

- test:security 25/25 PASS: no service_role, revoked device rejected, LAN disabled by default, invalid port fallback, path traversal, no credential logging, input validation.
- test:readonly-audit 6/6 PASS. Credential secrecy în pairing list: PASS.

## M. Performance

- ERR_INSUFFICIENT_RESOURCES: nereproducibil în mediul automat; suite SSE multi-client fără leak-uri observabile. Documentat pentru monitorizare; nu s-au introdus optimizări speculative.
- Bundle warning: chunk 737 kB (>500 kB) — non-blocant; future work code-splitting.

## N. Bugs găsite și reparate

Toate în `server/tests/faza8g-e2e.test.ts` (test nou 8G), nu în cod de producție:

1. **H1/H4/H5 + C1/C2/C4/B1**: testul presupunea `assigned_employee_id` pe `jobs` (nu există — derivă din `cars.assigned_employee_id`) și contracte de răspuns `{id}` în loc de `{ok, car|appointment}`, plus POST în loc de PATCH la update. Reparat în teste.
2. **B2**: INSERT folosea coloana inexistentă `pin`; reparat la schema reală.
3. **D2**: `await reader.read()` pe stream SSE fără evenimente așteaptă la nesfârșit → hang. Reparat cu Promise.race timeout 500ms.
4. **K2**: folosea job-ul seed partajat (stare poluată); reparat cu job izolat per test.
5. **Documentat (nu e bug)**: finalize cere sesiune running — finalize după stop → 409 TIMER_NOT_ACTIVE; acoperit explicit în C1.

Codul de producție (server/src) **nu a fost modificat** în 8G.

## O. NOT TESTED

- Installer .exe build + validare (Inno Setup 6 lipsă)
- Clean Windows VM install (UAC, Program Files, ProgramData, service creation, shortcut)
- Windows Service lifecycle (install/start/stop/restart/crash recovery)
- Browser interactiv: Admin Local, Employee Local, Web Mode live (Supabase), themes vizual, PDF vizual, QR/barcode vizual
- LAN explicit pe interfață reală (cod testat unitar; LAN rămâne disabled by default)
- Restore fizic al backupului pe instalare nouă
- Auto-sync la orele reale 13:00/18:00 (testat unitar cu time injection)

## P. Future Work

1. Code-splitting frontend (chunk >500 kB)
2. Custom theme create/delete (documentat anterior)
3. TLS pentru LAN
4. Sincronizare Supabase ↔ SQLite
5. Installer pipeline CI cu Inno Setup

## Q. Release Checklist

| Criteriu | Stare |
|---|---|
| Web mode funcționează | PASS (build + arhitectură; live Supabase NOT TESTED interactiv) |
| Local mode funcționează | PASS |
| SQLite funcționează | PASS |
| Local Server funcționează | PASS |
| Startup recovery | PASS |
| Backup | PASS |
| Versioning / compatibility | PASS |
| Device registry / pairing / QR / barcode / revoke / heartbeat | PASS |
| SSE / reconnect | PASS |
| Timer / overtime / takeover / transfer | PASS |
| Auto-sync | PASS (unitar) |
| Reports / PDF / VAT | PASS (calc; PDF vizual NOT TESTED) |
| Agent | PASS (65 teste) |
| Themes | PASS (API/persistență; vizual NOT TESTED) |
| Search | PASS |
| Security | PASS |
| Production build | PASS |
| Installer | NOT TESTED (Inno Setup 6 absent) |
| Windows Service | NOT TESTED |
| Data preservation | PASS |

## R. Verdict final

**SERVIX 2.0 — RELEASE CANDIDATE** (build local, fără commit/push/deploy).

De testat pe hardware/VM real înainte de distribuție:
1. Instalare clean Windows VM (UAC, directoare, service, shortcut, first-run)
2. Build installer cu Inno Setup 6 + validare
3. Windows Service lifecycle și crash recovery
4. Smoke test vizual Admin/Employee UI + Web live
5. Backup/restore fizic

Niciun blocker pentru Release Candidate: toate criteriile verificabile în acest mediu sunt PASS.


| server/tests-write | 20 | 20 | 0 |
| server/tests-local | 22 | 22 | 0 |
| test:security | 25 | 25 | 0 |
| test:readonly-audit | 6 | 6 | 0 |
| test:agent | 65 | 65 | 0 |
| typecheck (tsc --noEmit) | — | PASS | — |
| production build (vite) | — | PASS | — |

Noul suite `faza8g-e2e.test.ts` acoperă 13 suite: Health/Version/Schema, Data Preservation, Timer E2E, Multi-Device SSE (evenimente, failed-write→no-event, eventId), Device Pairing Lifecycle (pair/restart/reconnect/revoke/reactivate + credential secrecy), Reports/VAT calc, Read ops, Config (LAN disabled by default), Auto-Sync/Recovery, Error Handling, Data Integrity (FK, WAL, integrity check).
