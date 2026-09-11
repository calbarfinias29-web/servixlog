import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outDir = path.join(root, '.tmp-tests');
const outFile = path.join(outDir, 'faza2a.mjs');

import fs from 'node:fs';
fs.mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [
    path.join(root, 'tests', 'faza2a-confirmation.test.ts'),
    path.join(root, 'tests', 'faza2b-write-flow.test.ts'),
    path.join(root, 'tests', 'faza2b-etapa2-cars.test.ts'),
    path.join(root, 'tests', 'faza2-final.test.ts'),
    path.join(root, 'tests', 'search-normalize.test.ts'),
    path.join(root, 'tests', 'faza3b-phase3.test.ts'),
    path.join(root, 'tests', 'faza4-full-test-mode.test.ts'),
    path.join(root, 'tests', 'session-pairing.test.ts'),
    path.join(root, 'tests', 'employee-reports-aggregation.test.ts'),
    path.join(root, 'tests', 'angajat-device-gate.test.ts'),
  ],
  outdir: outDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: false,
  alias: { '@': path.join(root, 'src') },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'),
  },
  external: ['@supabase/supabase-js'],
});

for (const f of ['faza2a-confirmation.test.js', 'faza2b-write-flow.test.js', 'faza2b-etapa2-cars.test.js', 'faza2-final.test.js', 'search-normalize.test.js', 'faza3b-phase3.test.js', 'faza4-full-test-mode.test.js', 'session-pairing.test.js', 'employee-reports-aggregation.test.js', 'angajat-device-gate.test.js']) {
  execFileSync(process.execPath, [path.join(outDir, f)], { stdio: 'inherit' });
}
