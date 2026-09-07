import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const f = path.join(here, '..', 'src', 'agent', 'agent-write.ts');
let s = fs.readFileSync(f, 'utf8');

// Minimal SYNTAX-ONLY repairs so typecheck/build can pass.
// No execution-flow / logic changes.
const repls = [
  ['direct de AgentModal.', 'direct de AgentModal.\n */'],         // close unclosed header block-comment
  ['p.license_plate as string);', 'p.license_plate as string;'],  // unbalanced ')'
  ['p.client_name as string);', 'p.client_name as string;'],      // unbalanced ')'
];

let applied = 0;
for (const [a, b] of repls) {
  if (!s.includes(a)) {
    console.log('NOT FOUND (skipped): ' + JSON.stringify(a));
    continue;
  }
  s = s.split(a).join(b);
  applied += 1;
}

fs.writeFileSync(f, s, 'utf8');
console.log('applied ' + applied + ' replacements to agent-write.ts');