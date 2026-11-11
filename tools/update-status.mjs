import { readFileSync, writeFileSync } from 'node:fs';

const path = 'STATUS.md';
let text = readFileSync(path, 'utf8');
// strip BOM if present (Set-Content left one)
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

const edits = [
  // 1. header stamp
  [
    '**Last updated:** 2026-11-11 22:15 · **Updated by:** Phase 2 complete (layout shell & cart drawer)',
    '**Last updated:** 2026-11-11 23:05 · **Updated by:** Phase 3 complete (homepage)',
  ],
  // 2. current position
  [
    '| Active phase | **Phase 2 — Layout shell & cart drawer** |\n| Phase status | ✅ **Complete — gate passed** |\n| Build state | `npm run build` green (4 static routes) · `tsc --noEmit` clean · `eslint .` 0 errors, 1 pre-existing warning |\n| Blocking issues | None |\n| Next action | Phase 3 — homepage |',
    '| Active phase | **Phase 3 — Homepage** |\n| Phase status | ✅ **Complete — gate passed** |\n| Build state | `npm run build` green (4 static routes) · `tsc --noEmit` clean · `eslint .` 0 errors, 1 pre-existing warning |\n| Blocking issues | None |\n| Next action | Phase 4 — Category pages ×14 |',
  ],
  // 3. phase table row
  [
    '| 3 | Homepage | ⬜ | — | — |',
    '| 3 | Homepage | ✅ | build + tsc + lint + live browser gates (16 sections, order, Bangla, carousels, empty states) | 12 home components, `home.css`; preview strip env-gated |',
  ],
  // 4. active claims
  [
    '| — | _none — Phase 2 released_ | — | — |',
    '| — | _none — Phase 3 released_ | — | — |',
  ],
  // 5. what exists — proof page row
  [
    '| `src/app/(shop)/page.tsx` | **Phase 0 proof page — not the homepage** (homepage is Phase 3) |',
    '| `src/app/(shop)/page.tsx` | Homepage route `/` — renders `<HomePage />`, metadata + canonical |',
  ],
];

for (const [find, replace] of edits) {
  if (!text.includes(find)) {
    console.error(`MISS: ${find.slice(0, 70)}`);
    process.exitCode = 1;
    continue;
  }
  text = text.replace(find, replace);
  console.log(`ok: ${find.slice(0, 60)}`);
}

writeFileSync(path, text, 'utf8');
console.log(`bytes=${Buffer.byteLength(text, 'utf8')}`);
