# SERVIX — Local Server (FAZA 3)

Infrastructură LOCALĂ de test, **complet izolată** de aplicația WEB
(Web → Supabase rămâne neatins).

Stack: **Node.js 24** (built-in) — server `node:http` + SQLite `node:sqlite`.
**Zero dependențe externe** — nimic instalat în `package.json`.

## Cum pornește Local Server

```bash
node server/src/server.ts
```

Implicit ascultă pe `http://127.0.0.1:8787` și deschide/crează baza
`server/data/servix-local.db` (applică schema + seed DEMO).

Configurare prin variabile de mediu (opțional):
- `SERVIX_HOST` (implicit `127.0.0.1`)
- `SERVIX_PORT` (implicit `8787`)
- `SERVIX_DB_PATH` (implicit `server/data/servix-local.db`)
- `SERVIX_SEED` (implicit `true`; pune `false` pentru a nu insera DEMO)

## Unde este SQLite

- Fișier: `server/data/servix-local.db` (nu se urmărește în Git).
- Schema: `server/src/schema.ts` (tabele pilot: `employees`, `cars`,
  `jobs`, `appointments`, `rates`, `work_schedule`).
- Seed DEMO: `server/src/seed.ts` (marcat TEST/DEMO, izolat de Supabase).
- Inițializare: `server/src/db.ts` (`createDatabase`) — createază dir,
  aplică schema, inserează DEMO, închide corect.

## Cum se rulează testele serverului

```bash
node --test server/tests/server.test.ts
```

Teste izolate (bază TEMPORARĂ în tmpdir): pornire server, SQLite,
schema, seed, health + 6 endpoint-uri READ.

## Typecheck server (opțional)

```bash
tsc --noEmit -p server/tsconfig.json
```

## Endpoint-uri (READ-ONLY)

- `GET /api/health` — server pornit + SQLite conectat + versiunea schema
- `GET /api/cars`
- `GET /api/employees`
- `GET /api/jobs`
- `GET /api/rates`
- `GET /api/schedule`

Implicit ascultă **doar pe localhost**. Pentru testarea LAN, ar trebui
modificarea hostului (`SERVIX_HOST=0.0.0.0`) + reguli firewall; NU este
implementat acum (secretu/prioritate pornește security LAN într-o fază
viitoare).