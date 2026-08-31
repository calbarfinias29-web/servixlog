// ============================================================
// SERVICEX — generator ilustrații vehicule (per Marcă + Model)
//
// Creează public/vehicles/<marca>/<model>.svg pentru fiecare model
// din catalog. Ilustrațiile sunt create de proiect (fără drepturi
// terți), în aceeași proporție 320×240 (4:3), cu siluetă potrivită
// tipului de caroserie și culoarea tipică a modelului.
// Rulare: node tools/gen-vehicle-art.cjs
// ============================================================
const fs = require('fs');
const path = require('path');

const CATALOG = [
  { make: 'Mercedes', models: [
    ['Clasa A', 'hatch', '#B9BEC9'], ['Clasa B', 'hatch', '#AEB6C2'], ['Clasa C', 'sedan', '#20242E'],
    ['Clasa E', 'sedan', '#7C8593'], ['Clasa S', 'sedan', '#1B2436'], ['GLA', 'suv', '#C9BFAE'],
    ['GLC', 'suv', '#6E7B74'], ['GLE', 'suv', '#2A2F3A'],
  ]},
  { make: 'BMW', models: [
    ['Seria 1', 'hatch', '#2E6DB4'], ['Seria 3', 'sedan', '#2F6FBA'], ['Seria 5', 'sedan', '#5E6672'],
    ['Seria 7', 'sedan', '#15181F'], ['X1', 'suv', '#C6CBD4'], ['X3', 'suv', '#24486E'], ['X5', 'suv', '#23272F'],
  ]},
  { make: 'Audi', models: [
    ['A3', 'hatch', '#B4242C'], ['A4', 'sedan', '#828A96'], ['A6', 'sedan', '#1E2A44'],
    ['A8', 'sedan', '#14171E'], ['Q3', 'suv', '#C05A2E'], ['Q5', 'suv', '#75808A'], ['Q7', 'suv', '#22262E'],
  ]},
];

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Siluete 3/4 — propoții diferențiate pe caroserie.
function bodyPaths(type, paint) {
  const glass = '#171A24';
  const shade = 'rgba(0,0,0,0.28)';
  if (type === 'suv') {
    return { body: `M48 170 L44 118 Q44 102 60 98 L92 92 L112 62 Q118 52 132 52 L204 52 Q220 52 228 62 L252 90 L276 96 Q292 100 292 116 L288 170 Z`, glass: `M118 66 L148 66 L148 90 L100 90 Z`, glass2: `M156 66 L200 66 Q208 66 213 73 L230 90 L156 90 Z`, line: `M70 126 L262 126`, wheel: 22, wx1: 96, wx2: 244, wy: 174 };
  }
  if (type === 'hatch') {
    return { body: `M66 172 L62 132 Q62 118 76 114 L104 108 L124 80 Q130 72 142 72 L198 72 Q210 72 218 80 L240 104 L260 110 Q272 114 272 128 L268 172 Z`, glass: `M130 84 L158 84 L158 106 L114 106 Z`, glass2: `M166 84 L196 84 Q202 84 206 89 L220 106 L166 106 Z`, line: `M86 128 L254 128`, wheel: 19, wx1: 104, wx2: 236, wy: 176 };
  }
  if (type === 'coupe') {
    return { body: `M56 172 L52 132 Q52 118 66 114 L96 108 L120 78 Q128 66 142 66 L192 66 Q206 66 214 76 L240 106 L266 112 Q278 116 278 130 L274 172 Z`, glass: `M128 82 L154 82 L154 106 L110 106 Z`, glass2: `M162 82 L190 82 Q198 82 203 88 L222 106 L162 106 Z`, line: `M78 128 L258 128`, wheel: 20, wx1: 100, wx2: 240, wy: 176 };
  }
  // sedan (implicit)
  return { body: `M58 172 L54 134 Q54 120 68 116 L98 110 L120 80 Q127 70 140 70 L200 70 Q213 70 221 79 L246 106 L270 112 Q282 116 282 130 L278 172 Z`, glass: `M128 84 L156 84 L156 108 L110 108 Z`, glass2: `M164 84 L196 84 Q203 84 208 90 L226 108 L164 108 Z`, line: `M80 130 L260 130`, wheel: 20, wx1: 100, wx2: 240, wy: 176 };
}

function svg(makeLabel, modelName, type, paint) {
  const b = bodyPaths(type);
  const y = b.wy;
  const glass = '#171A24';
  const shade = 'rgba(0,0,0,0.28)';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2C3442"/><stop offset="1" stop-color="#232A36"/></linearGradient>
    <linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${paint}"/><stop offset="1" stop-color="${shade}"/></linearGradient>
  </defs>
  <rect width="320" height="240" rx="14" fill="url(#bg)"/>
  <ellipse cx="160" cy="196" rx="120" ry="10" fill="rgba(0,0,0,0.35)"/>
  <path d="${b.body}" fill="url(#p)" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>
  <path d="${b.glass}" fill="${glass}"/><path d="${b.glass2}" fill="${glass}"/>
  <path d="${b.line}" stroke="rgba(255,255,255,0.14)" stroke-width="2" fill="none"/>
  <circle cx="${b.wx1}" cy="${y}" r="${b.wheel}" fill="#171A24" stroke="#C9CDD6" stroke-width="5"/>
  <circle cx="${b.wx2}" cy="${y}" r="${b.wheel}" fill="#171A24" stroke="#C9CDD6" stroke-width="5"/>
  <circle cx="${b.wx1}" cy="${y}" r="${Math.max(4, b.wheel - 10)}" fill="#59606D"/><circle cx="${b.wx2}" cy="${y}" r="${Math.max(4, b.wheel - 10)}" fill="#59606D"/>
  <text x="160" y="224" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="12" font-weight="700" fill="#A8B0BF" letter-spacing="2">${makeLabel.toUpperCase()} ${modelName.toUpperCase()}</text>
</svg>
`;
}

let count = 0;
for (const brand of CATALOG) {
  const dir = path.join(__dirname, '..', 'public', 'vehicles', slug(brand.make));
  fs.mkdirSync(dir, { recursive: true });
  for (const [model, type, paint] of brand.models) {
    fs.writeFileSync(path.join(dir, `${slug(model)}.svg`), svg(brand.make, model, type, paint));
    count++;
  }
}
console.log(`Generated ${count} vehicle SVGs.`);
