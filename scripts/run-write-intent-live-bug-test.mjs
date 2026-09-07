import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.tmp-tests');
const outFile = path.join(outDir, 'write-intent-live-bug.test.mjs');
fs.mkdirSync(outDir, { recursive: true });
await build({ entryPoints: [path.join(root, 'tests', 'write-intent-live-bug.test.ts')], outfile: outFile, bundle: true, platform: 'node', format: 'esm', sourcemap: false, alias: { '@': path.join(root, 'src') }, external: ['@supabase/supabase-js'], define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(process.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY ?? 'placeholder-anon-key') } });
execFileSync(process.execPath, [outFile], { stdio: 'inherit' });
