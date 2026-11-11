import { readFileSync, writeFileSync } from 'node:fs';

const path = 'HANDOFF.md';
let text = readFileSync(path, 'utf8');

// L146: the '?' inside the quoted Turbopack error is a literal BOM character.
text = text.replace(
  "(`Unexpected token '?'`)",
  "(`Unexpected token '\uFEFF'`)",
);

// L318: the Bangla price that was destroyed.
text = text.replace(
  'prices render as `??,???`.',
  'prices render as `\u09F3\u09E7,\u09EE\u09EF\u09E6`.',
);

writeFileSync(path, text, 'utf8');

const left = text
  .split(/\r?\n/)
  .map((line, i) => (line.includes('?') ? `L${i + 1}: ${line.slice(0, 110)}` : null))
  .filter(Boolean);

console.log(`remaining '?' lines: ${left.length}`);
for (const l of left) console.log(l);
