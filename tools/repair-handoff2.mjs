/**
 * Second pass: restore the six lines whose non-cp1252 content was destroyed
 * (Bangla text, Bangla digits, a taka sign). Every replacement value is taken
 * from the code, not guessed:
 *   t('bn','left',{n:4})      -> মাত্র ৪টি বাকি
 *   formatMoney(189000,'bn')  -> ৳১,৮৯০
 *   formatMoneyAdmin(48235000)-> ৳4,82,350
 *   categories[fashion]       -> ফ্যাশন / Fashion
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const path = resolve(root, 'HANDOFF.md');

let text = readFileSync(path, 'utf8');

const FIXES = [
  // L121 — the verify-phase0 evidence line.
  [
    "`t('bn','left',{n:4})` → `????? ??? ????`, `formatMoney(189000,'bn')` → `??,???`, `formatMoneyAdmin(48235000)` → `??,??,???`",
    "`t('bn','left',{n:4})` → `মাত্র ৪টি বাকি`, `formatMoney(189000,'bn')` → `৳১,৮৯০`, `formatMoneyAdmin(48235000)` → `৳4,82,350`",
  ],
  // L122 — the SQL round-trip line.
  [
    'Bangla round-trips correctly (`??????`, `???? → ????`).',
    'Bangla round-trips correctly (`ফ্যাশন`, `Fashion → ফ্যাশন`).',
  ],
  // L146 — the BOM landmine. The '?' is a literal in the quoted error text.
  [
    "(`Unexpected token '?')",
    "(`Unexpected token '\\uFEFF')",
  ],
  // L192 — formatMoney's poisha -> taka.
  [
    '`formatMoney` (poisha → ?, Bangla numerals in `bn`)',
    '`formatMoney` (poisha → ৳, Bangla numerals in `bn`)',
  ],
  // L204 — the curl proof line.
  [
    'and the Bangla category name `???? → ????`.',
    'and the Bangla category name `Fashion → ফ্যাশন`.',
  ],
  // L318 — the language-toggle line.
  [
    'prices render as `??,???,???`.',
    'prices render as `৳১,৮৯০`.',
  ],
];

for (const [from, to] of FIXES) {
  if (!text.includes(from)) {
    console.log(`MISS (not found): ${from.slice(0, 60)}`);
    continue;
  }
  text = text.split(from).join(to);
}

writeFileSync(path, text, 'utf8');

const left = text
  .split(/\r?\n/)
  .map((line, i) => (line.includes('?') ? `L${i + 1}: ${line.slice(0, 100)}` : null))
  .filter(Boolean);

console.log(`remaining '?' lines: ${left.length}`);
for (const l of left) console.log(l);
