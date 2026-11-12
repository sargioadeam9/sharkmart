/**
 * One-off doc update: mark Phase 8 complete in STATUS.md.
 * Written in Node because PowerShell 5.1 Set-Content destroys UTF-8 (HANDOFF landmine #1).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'STATUS.md';
let text = readFileSync(path, 'utf8');

const replacements = [
  [
    '| Active phase | **Phase 7 — Search, wishlist, account (real API)** |',
    '| Active phase | **Phase 9 — Admin panel: core modules** |',
  ],
  [
    '| Phase status | 🟡 **PARTIAL — catalog flip + `/search` + guest wishlist done; account surface deferred to Phase 8** |',
    '| Phase status | ✅ **Phase 8 COMPLETE — auth, cart, orders, checkout all green** |',
  ],
  [
    '| Build state | Server: `npm test` 57/57 · `tsc --noEmit` clean · `eslint .` 0 errors. Storefront: `npm run build` green (189 static pages + `/search` dynamic, all from the live API) · `tsc --noEmit` clean · `eslint .` 0 errors (1 pre-existing font warning) |',
    '| Build state | Server: `npm test` **89/89** · `tsc --noEmit` clean · `eslint .` 0 errors. Storefront: `npm run build` green (171 product pages + 14 categories, all from the live API) · `tsc --noEmit` clean · `eslint .` 0 errors (2 pre-existing warnings) |',
  ],
  [
    '| Next action | Phase 8 — auth first, then the deferred account surface (`/login`, `/register`, `/profile`, `/orders`, `/track`, wishlist merge) |',
    '| Next action | Phase 9 — admin shell + core modules (see `prompts/masterbuild.md:676`) |',
  ],
  [
    '| 7 | Search, wishlist, account | 🟡 | build + tsc + live browser (both scripts, type-ahead, wishlist toggle/reload/remove) | **PARTIAL** — `/search` + guest wishlist done; account surface deferred to Phase 8 |',
    '| 7 | Search, wishlist, account | ✅ | build + tsc + live browser (both scripts, type-ahead, wishlist toggle/reload/remove) | `/search` + guest wishlist; account surface landed in Phase 8 |',
  ],
  [
    '| 8 | Auth, cart, orders, checkout | ⬜ | — | — |',
    '| 8 | Auth, cart, orders, checkout | ✅ | `npm test` 89/89 · tsc clean (both) · build green · live browser (merge, badge, drawer, `/cart` agree) | 747 variants (cartesian) · 3 follow-ups closed 2026-11-12 |',
  ],
  [
    '**Last updated:** 2026-11-12 · **Updated by:** Phase 7 — catalog flipped to the real API',
    '**Last updated:** 2026-11-12 · **Updated by:** Phase 8 closed out — follow-ups fixed, gates re-run',
  ],
];

for (const [find, replace] of replacements) {
  if (!text.includes(find)) {
    console.error('MISS:', find.slice(0, 70));
    process.exitCode = 1;
    continue;
  }
  text = text.replace(find, replace);
}

writeFileSync(path, text, 'utf8');
console.log('STATUS.md updated');
