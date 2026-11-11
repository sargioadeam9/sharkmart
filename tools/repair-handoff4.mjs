import { readFileSync, writeFileSync } from 'node:fs';

const path = 'HANDOFF.md';
const before = readFileSync(path, 'utf8');

// L318: the Bangla price destroyed by the cp1252 rewrite.
// Value verified against src/lib/format.ts (line 6) and Intl bn-BD: 1284 -> ৳১,২৮৪
const broken = 'prices render as `??,???`.';
const fixed = 'prices render as `\u09F3\u09E7,\u09E8\u09EE\u09EA`.';

if (!before.includes(broken)) {
  console.error('ABORT: target string not found; file unchanged.');
  process.exit(1);
}

const after = before.replace(broken, fixed);
writeFileSync(path, after, 'utf8');

const lines = after.split(/\r?\n/);
console.log(`L318 now: ${lines[317]}`);
console.log(`remaining "??" lines: ${lines.filter((l) => l.includes('??')).length}`);
console.log(`bytes: ${Buffer.byteLength(after, 'utf8')}`);
