// One-shot encoding fixer for PowerShell scripts corrupted by ANSI round-trip.
import { readFileSync, writeFileSync } from 'node:fs';
const files = process.argv.slice(2);
// Mojibake sequences produced when UTF-8 was read as CP1252 and re-encoded:
const fixes = [
  ['\u00e2\u0153\u201c', '\u2713'], // ✓
  ['\u00e2\u0153\u2014', '\u2717'], // ✗
  ['\u00e2\u0153\u0161', '\u26a0'], // ⚠
  ['\u00e2\u20ac\u201c', '-'],      // – (en dash)
  ['\u00e2\u20ac\u201d', '-'],      // — (em dash)
  ['\u00e2\u20ac\u0161', ','],      // ‚
  ['\u00c2\u00a0', ' '],            // nbsp
  ['\u201c', "'"], ['\u201d', "'"],
  ['\u2018', "'"], ['\u2019', "'"],
];
for (const f of files) {
  let t = readFileSync(f, 'utf8');
  for (const [bad, good] of fixes) t = t.split(bad).join(good);
  t = t.replace(/[^\x00-\x7F]/g, '?');
  writeFileSync(f, t, 'utf8');
  const left = [...t].filter((c) => c.charCodeAt(0) > 127).length;
  console.log(`${f}: cleaned, remaining non-ascii: ${left}`);
}
