import { readFileSync, writeFileSync } from 'node:fs';

const path = 'HANDOFF.md';
let text = readFileSync(path, 'utf8');
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

const entry = `---

## Phase 3 — Homepage (2026-11-11 23:05)

**What I completed**

- \`src/components/home/\` — 12 components: \`hero-slider\`, \`trust-badges\`, \`brand-rails\` (own + external), \`flash-sale\`, \`flash-countdown\`, \`category-rail\`, \`product-rail\`, \`promo-banners\`, \`recently-viewed\`, \`newsletter\`, \`section-header\`, \`home-page\`.
- \`src/app/(shop)/page.tsx\` — now renders \`<HomePage />\` with metadata + canonical, replacing the Phase 0 proof page.
- \`src/components/layout/preview-strip.tsx\` — the reference's \`.pv\` bar, gated on \`NEXT_PUBLIC_SHOW_PREVIEW_STRIP === "true"\`. Mounted in \`storefront-shell.tsx\`, absent from the DOM by default.
- \`NEXT_PUBLIC_SHOW_PREVIEW_STRIP=false\` documented in \`.env.example\`.
- \`src/lib/i18n/ui.ts\` — added \`offers\`, \`of\`, \`previous\`, \`next\`, \`errorTitle\`, \`errorBody\` in EN and BN.
- \`src/app/components.css\` — removed \`scroll-snap-type\` from \`.car-track\` (see landmines).

**What I verified**

- 16 sections, reference order: hero → trust → own brands → external brands → flash → categories → new → best → only → trending → promos → featured → recommended → recently viewed → popular → newsletter.
- Hero \`min-height: 380px\` measured live, 4 slides, prev disabled at start.
- 14 cards per rail; featured 13 (reference filters \`r >= 4.3\`); \`catalog\` 153 of 168 in stock.
- Carousel drift measured: \`22.4 → 23.2 → 24\`; frozen at \`26.4\` across 6 samples while hovered. \`prefers-reduced-motion\` disables it.
- 11 overflowing \`.car-track\` containers, arrows shown, prev disabled at scroll start.
- Language: EN → \`html lang="en"\`, no \`body\` class, \`৳1,890\`, hero label "Offers". বাংলা → \`body.bn\`, \`৳২,০০০\`, hero label "অফার".
- No horizontal overflow: \`scrollWidth 1263\` at viewport 1280.
- \`tsc --noEmit\` exit 0 · \`eslint .\` 0 errors, 1 pre-existing font warning · \`next build\` green, 4 routes · \`browser_console\` 0 errors, 0 warnings.

**What is NOT done**

- Side-by-side parity at **1440 and 390** was not done. The automation browser renders at ~2fps and has no resize tool. Needs a real browser pass.
- LCP / CLS were not measured.
- Mobile bottom nav and category sheet still unverified at 360px (carried from Phase 2).

**What I assumed**

- The hero aria-label should read "Offers" / "অফার" to match the reference's \`t('offers')\`, not "Flash Sale".
- \`autoScrollMs\` is the *hold duration after interaction* (the reference's \`pause(3500)\`), not an interval. The reference drifts continuously and ping-pongs; it never pages on a timer.

**Landmines I hit**

1. **PowerShell 5.1 \`Set-Content\` destroyed this file.** It rewrote \`HANDOFF.md\` as cp1252, turning every \`→\`, \`৳\`, \`✓\` and Bangla digit into \`?\`. Recovered by rewriting with Node (\`writeFileSync(path, text, 'utf8')\`). The destroyed Bangla price was reconstructed from \`src/lib/format.ts\` and \`Intl.NumberFormat('bn-BD')\`, not guessed. **Never edit these docs with \`Set-Content\`/\`Out-File\`; use Node or \`[System.IO.File]::WriteAllText\` with a no-BOM \`UTF8Encoding\`.**
2. **\`scroll-snap-type: x proximity\` silently kills auto-scroll.** Every sub-pixel \`scrollLeft\` write snaps back to the nearest card, so the track never moves and it looks like the rAF loop is dead. The reference has no snap. Removed from \`.car-track\`.
3. **\`Get-Content\` in PowerShell renders UTF-8 as mojibake** (\`â€”\`, \`à§³\`). The file is fine; the console is lying. Verify encoding with Node before "fixing" anything.
4. **The automation browser runs at ~2fps.** A 0.5px/frame drift looks frozen at that rate. Measure with repeated samples over seconds, not one reading.
5. **The cart drawer is always in the DOM** with \`aria-hidden\` + \`inert\` + an off-screen transform. Snapshots report "Dialog open" every time. That is correct, not a bug.

**Exact next step**

- Run the Phase 4 master prompt for the 14 category pages, then update the Phase 4 row in \`STATUS.md\` and append a new entry here.
`;

text = text.replace(/\s*$/, '\n\n') + entry;
writeFileSync(path, text, 'utf8');
console.log(`bytes=${Buffer.byteLength(text, 'utf8')}`);
console.log(`Phase 3 entries: ${(text.match(/## Phase 3 — Homepage/g) || []).length}`);
