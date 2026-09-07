import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const outDir = path.join(root, '.tmp-tests');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'clock-inactivity.test.mjs');

await build({
  entryPoints: [path.join(root, 'tests', 'clock-inactivity.test.ts')],
  outfile: outFile,
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

execFileSync(process.execPath, [outFile], { stdio: 'inherit' });