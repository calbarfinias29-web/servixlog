# SERVIX — Windows Installer (SERVIX-Setup.exe)

Ghid consolidat pentru generarea, instalarea, actualizarea și dezinstalarea
SERVIX Local ca aplicație Windows (installer Inno Setup + Windows Service).
Consolidează rezultatele fazelor 8A–8H. Nu schimbă arhitectura Web/Supabase;
Local și Supabase rămân complet independente, fără sincronizare.

## 1. Ce instalează installerul

```
SERVIX-Setup.exe
    ↓
C:\Program Files\SERVIX\
    ├── app\
    │   ├── frontend\            (UI built — servit static de Local Server)
    │   ├── server\src\          (server TypeScript, zero-dependency)
    │   ├── src\version.ts       (versiune comună UI + server)
    │   ├── runtime\node.exe     (Node.js v24.18.0 bundled — NU cere Node instalat)
    │   └── .env.production      (config implicit)
    └── scripts\
        ├── start-service.ps1    (pornește serverul cu runtime-ul bundled)
        ├── install-service.ps1  (înregistrează serviciul SERVIX via sc.exe)
        ├── health-check.ps1     (verificare instalație)
        ├── backup-db.ps1        (backup SQLite cu timestamp)
        └── uninstall.ps1        (oprește serviciul, PĂSTREAZĂ datele)

%PROGRAMDATA%\SERVIX\
    ├── data\servix-local.db     (SQLite — datele utilizatorului, persistent)
    ├── backups\                 (backup-uri cu timestamp, PĂSTRATE la update/uninstall)
    ├── logs\servix-server.log   (loguri; rotație >5MB → .old)
    └── config\.env              (suprascrideri locale fără reinstalare)
```

Scurtături: `Start Menu\SERVIX\SERVIX Admin` → `http://127.0.0.1:8787/`.
URL-ul Admin UI în production = `http://127.0.0.1:8787/` (servit de Local Server,
nu de Cloudflare). Config port: `SERVIX_PORT` (implicit 8787).

## 2. Ce trebuie instalat pe PC-ul de generare (dev)

| Componentă | Rol | Obligatoriu? |
|---|---|---|
| Node.js v24+ (dev machine) | `npm run build` + bundling runtime | DA |
| npm packages (`npm install`) | build frontend | DA |
| **Inno Setup 6 (ISCC.exe)** | compilarea efectivă `SERVIX-setup.exe` | **DA pentru .exe** |

Inno Setup 6 NU este instalat pe acest PC de dezvoltare — de aceea `SERVIX-setup.exe`
NU poate fi generat încă. Pentru a-l genera: descarci Inno Setup 6 de la
https://jrsoftware.org/isdl.php, apoi:

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-installer.ps1
ISCC.exe dist-installer\staging\SERVIX-setup.iss
→ dist-installer\installer\SERVIX-<versiune>-setup.exe
```

Versiunea installerului se citește automat din `src\version.ts` (`SERVIX_VERSION`);
parametrul `-Version "x.y.z"` o poate suprascrie. Fără ISCC, scriptul generează
doar staging + `.iss` (compilare omisă cu avertisment, NU eșec).

## 3. Instalare pe PC-ul client

1. Rulează `SERVIX-Setup.exe` (necesită drepturi de Administrator).
2. Fără Node.js, npm, VS Code sau orice componentă de dezvoltare — runtime-ul
   Node este bundled în `app\runtime\`.
3. La final, installerul rulează automat: `backup-db.ps1` (siguranță la update),
   `install-service.ps1` (serviciu `SERVIX`, pornire automată + crash recovery
   5s/30s/60s) și `health-check.ps1`.
4. Deschide `http://127.0.0.1:8787/` (scurtătura SERVIX Admin).

Serviciul (dacă este activ) va lansa `start-service.ps1`, care:
- creează directoarele ProgramData (data/logs/backups/config);
- încarcă config din `app\.env.production` + suprascrideri din
  `config\.env` din ProgramData;
- oprește un instance-orfan anterior (PID file `servix-node.pid`, verificat:
  oprește DOAR procese numite "node");
- pornește `runtime\node.exe server\src\server.ts` și înregistrează PID-ul exact;
- rămâne activ cât rulează node (SCM = "Running").

Comenzi service: `net stop SERVIX` / `net start SERVIX` / `sc.exe query SERVIX`.
La oprirea/repornirea PC-ului, SQLite (WAL) se recuperează la pornirea următoare —
datele tranzacționate nu se pierd.

## 4. SQLite — locație și persistență

Baza de date NU stă în directorul aplicației. Stă în
`%PROGRAMDATA%\SERVIX\data\servix-local.db`:
- supraviețuiește update-urilor (fișierele aplicației se înlocuiesc, datele nu);
- supraviețuiește uninstall-ului (data/backups/logs PĂSTRATE — se șterg doar la
  cerere manuală explicită);
- supraviețuiește repornirii PC-ului (WAL recovery la open).

## 5. Update la versiuni viitoare

Fluxul principal de update = rulează `SERVIX-Setup.exe` nou (același AppId):
1. `[Run]` execută `backup-db.ps1` ÎNAINTE de orice (backup pre-upgrade);
2. fișierele din Program Files se înlocuiesc (frontend + server + runtime);
3. serviciul se reînregistrează idempotent (oprește orphan node din PID file);
4. `health-check.ps1` verifică serviciul pornit.

Suplimentar: `scripts\update-servix.ps1 -NewInstallerPath <path>` — face backup
DB + aplicație, oprește serviciul, verifică compatibilitatea, aplică, pornește,
verifică health și face ROLLBACK automat la eșec.
Log: `%PROGRAMDATA%\SERVIX\logs\update.log`.

Schema SQLite NU se schimbă în afară de mecanismul existent de upgrade din
`server\src\schema.ts` (SCHEMA_VERSION + forward migrations, cu backup
`pre-schema-v<N>` generat automat la upgrade). Update-ul NU creează migrații
Supabase și NU atinge Supabase.

## 6. Dezinstalare

`Panou de control → Uninstall` (sau `uninst.exe`):
1. `uninstall.ps1` oprește serviciul + oprește node-ul activ din PID file;
2. fișierele din Program Files se șterg;
3. `%PROGRAMDATA%\SERVIX\` (SQLite, backup-uri, loguri, config) **se PĂSTREAZĂ**.
   Ștergerea datelor se face doar manual, explicit (documentat în
   PRODUCTION-CONFIGURATION.md).

## 7. LAN (opțional, opt-in)

Implicit serverul ascultă DOAR `127.0.0.1` (`SERVIX_LAN_ENABLED=false`). Pentru
tablete/PC-uri angajați prin LAN: activează `SERVIX_LAN_ENABLED=true` în
`config\.env` din ProgramData, repornește serviciul (pași în
PRODUCTION-CONFIGURATION.md). Firewall-ul trebuie configurat manual.

## 8. Pagina de descărcare

`https://servixlog.com/descarcare` rămâne funcțională; butonul este dezactivat
până când installerul real există și e găzduit. Integrarea este deja pregătită:
- build-time: `VITE_SERVIX_DOWNLOAD_URL=<url-installerului>`;
- sau direct în `src\pages\DescarcarePage.tsx` → `DOWNLOAD_URL_FALLBACK`.

## 9. Starea actuală (2026-09-11)

| Verificare | Rezultat |
|---|---|
| `npm run typecheck` | PASS |
| `npm run typecheck:tests` | PASS |
| `npm run build` | PASS |
| `npm run test:regression` | PASS (inclusiv SESSION PAIRING 10/0, EMPLOYEE REPORTS 7/0) |
| `scripts\test-production-install.ps1` | PASS 14/0 (instalare production simulată) |
| `scripts\validate-installer.ps1` | 32 PASS / 1 FAIL (unicul FAIL = Inno Setup absent, BLOCATOR de mediu) |
| `node --test server/tests server/tests-local` | **PASS 168/168** (după fixurile de igienă din 2026-09-11: K2 determinist + testele schema-upgrade actualizate la v6) |

Probleme rămase:
1. **SERVIX-setup.exe necompilat** — Inno Setup 6 absent pe acest PC (unicul FAIL din validate-installer).
2. ~~Teste schema-upgrade STALE~~ — **REZOLVAT (2026-09-11, doar teste)**: `server\tests\schema-upgrade.test.ts` actualizat de la v5 la v6 (assert `SCHEMA_VERSION`/`user_version` = 6, tabelele v6 de inactivitate, redenumiri „schema v6"/„upgrade v2 → v6", backup `pre-schema-v${SCHEMA_VERSION}`). Schema SQLite reală (`server\src\schema.ts`) NEATINSĂ.
3. ~~Test K2 flaky orar~~ — **REZOLVAT (2026-09-11, doar test)**: `server\tests\faza8g-e2e.test.ts` K2 folosește `nowMs` fix, determinist (`FIXED_PRIOR_DAY_NOW_MS` = 2026-09-04T09:00Z) în loc de `Date.now()`. Logica reală de auto-sync (`server\src\timer.ts`) NEATINSĂ.
4. **`dist-installer\staging` (incluzând node.exe de 92MB) este comis în git** —
   recomandare viitoare: gitignore `dist-installer\` (arhive mari în istoric git).
