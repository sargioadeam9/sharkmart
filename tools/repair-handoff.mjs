/**
 * One-off repair for HANDOFF.md after a PowerShell 5.1 `Set-Content` round-trip
 * wrote the file as cp1252. Characters outside cp1252 became '?':
 *   →  (U+2192)   ৳ (U+09F3)   ✓ (U+2713)   Bangla digits
 * Em-dash, middle dot and § survived (they are in cp1252).
 *
 * The repair is context-driven, not guesswork: an arrow sits between spaces,
 * a taka sign sits before a number, and two known literals are restored whole.
 * Anything still ambiguous is reported rather than silently rewritten.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, 'HANDOFF.md');

// The file currently on disk is cp1252 bytes. Decode it as such to get back the
// characters that DID survive, then repair the '?' placeholders.
const raw = readFileSync(path);
const text = new TextDecoder('windows-1252').decode(raw);

let out = text;

// 1. Known whole-line literals that lost non-cp1252 characters.
const LITERALS = [
  ['idle?loading?success', 'idle→loading→success'],
  ['`? Compiled successfully', '`✓ Compiled successfully'],
  ['(`?.? (??)`', '(৪.৩ (৬৫))'],
  ['`t(\'bn\',\'left\',{n:4})` ?', "`t('bn','left',{n:4})` →"],
];

for (const [from, to] of LITERALS) {
  out = out.split(from).join(to);
}

// 2. A taka sign: '?' immediately followed by a digit or a digit group.
out = out.replace(/\?(?=[0-9][0-9,]*)/g, '৳');

// 3. An arrow: '?' with whitespace on both sides.
out = out.replace(/(\s)\?(\s)/g, '$1→$2');

// 4. Report anything left, so nothing is silently mangled.
const leftovers = [];
const lines = out.split(/\r?\n/);
lines.forEach((line, i) => {
  if (line.includes('?')) leftovers.push(`L${i + 1}: ${line.slice(0, 110)}`);
});

writeFileSync(path, out, 'utf8');

console.log(`repaired: ${path}`);
console.log(`remaining '?' lines: ${leftovers.length}`);
for (const l of leftovers) console.log(l);
