import { readFileSync } from 'node:fs';

const text = readFileSync('HANDOFF.md', 'utf8');
const lines = text.split(/\r?\n/);

function dump(label, s) {
  const cps = [...s].map((ch) => {
    const cp = ch.codePointAt(0);
    const hex = cp.toString(16).toUpperCase().padStart(4, '0');
    const shown = cp >= 32 && cp <= 126 ? ch : '<non-ascii>';
    return `U+${hex}(${shown})`;
  });
  console.log(`--- ${label} ---`);
  console.log(cps.join(' '));
}

// L146 context
const i146 = text.indexOf("Unexpected token '");
dump('L146 around "Unexpected token \'"', text.slice(i146, i146 + 22));

// L318 context
const i318 = text.indexOf('prices render as');
dump('L318 around "prices render as"', text.slice(i318, i318 + 30));

// any remaining literal ? adjacent to non-ascii in the whole file
console.log('--- lines containing "??" ---');
lines.forEach((l, n) => {
  if (l.includes('??')) console.log(`L${n + 1}: ${l.slice(0, 140)}`);
});
