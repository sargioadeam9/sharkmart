import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const cwd = process.cwd();

function git(args, opts = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    console.error(`FAILED: git ${args.join(' ')}`);
    console.error(r.stdout || '');
    console.error(r.stderr || '');
    process.exit(1);
  }
  return r.stdout;
}

function commit(message, paths, msgFile) {
  git(['add', '--', ...paths]);
  writeFileSync(msgFile, message, 'utf8');
  const out = git(['commit', '-F', msgFile]).trim();
  unlinkSync(msgFile);
  const sha = git(['rev-parse', '--short', 'HEAD']).trim();
  const subject = out.split('\n')[0];
  console.log(`\n[${sha}] ${subject}`);
  console.log(`   files: ${paths.length}`);
}

// ─────────────────────────────────────────────────────────────────────────────
const P0 = [
  '.gitignore',
  '.env.example',
  'AGENTS.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'next.config.ts',
  'postcss.config.mjs',
  'eslint.config.mjs',
  'oshoppingbd.html',
  'admin panel.html',
  'prompts/masterbuild.md',
  'prompts/frontend.md',
  'prompts/backend.md',
  'Logo/SharkMart Fast Delivery Logo.png',
  'public/brand/sharkmart-logo.png',
  'data/reference-catalog.json',
  'tools/extract-reference.mjs',
  'tools/verify-phase0.ts',
  'src/app/globals.css',
  'src/app/layout.tsx',
  'src/lib/brand.ts',
  'src/lib/format.ts',
  'src/lib/commerce.ts',
  'src/lib/categories.ts',
  'src/lib/utils.ts',
  'src/lib/i18n/index.ts',
  'src/lib/i18n/translations/en.ts',
  'src/lib/i18n/translations/bn.ts',
  'src/lib/mock/index.ts',
  'src/lib/api/config.ts',
  'src/lib/api/client.ts',
  'src/lib/api/products.ts',
  'src/lib/api/categories.ts',
  'src/lib/api/homepage.ts',
  'src/types/api.ts',
  'src/types/catalog.ts',
  'src/components/brand/logo.tsx',
  'server/.env.example',
  'server/package.json',
  'server/package-lock.json',
  'server/tsconfig.json',
  'server/prisma/schema.prisma',
  'server/prisma/seed.ts',
  'server/prisma/migrations/migration_lock.toml',
  'server/prisma/migrations/20261111130955_init_sharkmart/migration.sql',
  'server/src/index.ts',
  'server/src/app.ts',
  'server/src/config/env.ts',
  'server/src/config/database.ts',
  'server/src/routes/index.ts',
  'server/src/routes/health.ts',
  'server/src/middleware/errorHandler.ts',
  'server/src/types/api.ts',
];

const P1 = [
  'src/app/components.css',
  'src/app/components.css.bak',
  'src/app/dev/components/page.tsx',
  'src/components/ui/button.tsx',
  'src/components/ui/badge.tsx',
  'src/components/ui/chip.tsx',
  'src/components/ui/icons.tsx',
  'src/components/ui/quantity-stepper.tsx',
  'src/components/ui/skeleton.tsx',
  'src/components/ui/star-rating.tsx',
  'src/components/product/product-card.tsx',
  'src/components/product/category-card.tsx',
  'src/components/product/brand-tile.tsx',
  'src/components/product/mini-product-card.tsx',
  'src/components/shared/carousel.tsx',
  'src/components/shared/search-bar.tsx',
  'src/components/shared/toast.tsx',
  'src/components/shared/modal.tsx',
  'src/components/shared/mobile-sheet.tsx',
  'src/components/shared/empty-state.tsx',
  'src/lib/store/cart-store.ts',
  'src/lib/store/wishlist-store.ts',
  'src/lib/store/ui-store.ts',
  'src/lib/hooks.ts',
];

const P2 = [
  'src/app/shell.css',
  'src/app/(shop)/layout.tsx',
  'src/app/dev/shell/page.tsx',
  'src/components/layout/top-bar.tsx',
  'src/components/layout/header.tsx',
  'src/components/layout/mega-menu.tsx',
  'src/components/layout/mobile-header.tsx',
  'src/components/layout/mobile-category-sheet.tsx',
  'src/components/layout/bottom-nav.tsx',
  'src/components/layout/cart-drawer.tsx',
  'src/components/layout/footer.tsx',
  'src/components/layout/floating-buttons.tsx',
  'src/components/layout/language-toggle.tsx',
  'src/components/layout/document-language.tsx',
  'src/components/layout/storefront-shell.tsx',
  'src/lib/cart-totals.ts',
];

const P3 = [
  'src/app/home.css',
  'src/app/(shop)/page.tsx',
  'src/components/home/hero-slider.tsx',
  'src/components/home/trust-badges.tsx',
  'src/components/home/brand-rails.tsx',
  'src/components/home/flash-sale.tsx',
  'src/components/home/flash-countdown.tsx',
  'src/components/home/category-rail.tsx',
  'src/components/home/product-rail.tsx',
  'src/components/home/promo-banners.tsx',
  'src/components/home/recently-viewed.tsx',
  'src/components/home/newsletter.tsx',
  'src/components/home/section-header.tsx',
  'src/components/home/home-page.tsx',
  'src/components/layout/preview-strip.tsx',
  'src/lib/home/hero-slides.ts',
  'src/lib/store/viewed-store.ts',
  'src/lib/i18n/ui.ts',
];

const TOOLS = [
  'tools/inspect-handoff.mjs',
  'tools/repair-handoff.mjs',
  'tools/repair-handoff2.mjs',
  'tools/repair-handoff3.mjs',
  'tools/repair-handoff4.mjs',
  'tools/update-status.mjs',
  'tools/add-phase3-evidence.mjs',
  'tools/fix-phase3-evidence.mjs',
  'tools/append-handoff-phase3.mjs',
  'tools/verify-docs.mjs',
];

const DOCS = ['STATUS.md', 'HANDOFF.md'];

// ─────────────────────────────────────────────────────────────────────────────
commit(
  `feat(phase-0): foundation, contracts and reference extraction

Phase 0 complete — gate passed.

Frozen design contracts and the provenance for every generated value:
- oshoppingbd.html and admin panel.html are read-only visual truth (AGENTS.md §2)
- prompts/{masterbuild,frontend,backend}.md are the build law
- tools/extract-reference.mjs generates data/reference-catalog.json and the
  bilingual dictionaries from the frozen HTML, so 84 Bangla product names are
  never hand-retyped (decision D12)

Contracts and tokens:
- Both token sets in globals.css via @theme: shop-* and admin-* (decision D2)
- BRAND is the single source of the name (decision D7)
- Money is integer poisha end to end (decisions D4, D11)
- formatMoney and formatMoneyAdmin keep the two grouping conventions apart
- 132 i18n keys per locale, generated, zero drift

Backend:
- Prisma schema (38 models, 15 enums), initial migration, idempotent seed
- Express app with helmet, CORS, Zod-validated env, contract-shaped errors
- /health

Gate: next build green, tsc clean on both apps, migration applied, seed ran
twice with identical counts (14/84/25/168/168), all 14 category ids match the
reference, tools/verify-phase0.ts 40/40 checks pass.`,
  P0,
  '.msg0.txt',
);

commit(
  `feat(phase-1): design system, stores and component library

Phase 1 complete — gate passed.

Primitives ported from the reference rather than re-derived, in components.css:
.btn .badge .stars .qty .chip .pc .cc .bt .car .toast .sheet .modal .empty

Components:
- ui/: button (+useAddToCartState), badge, chip, icons, quantity-stepper,
  skeleton, star-rating
- product/: product-card with all five states, category-card, brand-tile,
  mini-product-card
- shared/: carousel, search-bar, toast, modal, mobile-sheet, empty-state

State:
- Zustand stores with persist and a versioned shape guard: cart (integer
  poisha), wishlist (ids only), ui (language, modal, sheet, toast queue)
- hooks.ts: useLang, useBodyScrollLock, useEscapeKey, useFocusReturn,
  usePrefersReducedMotion, useMediaQuery, useIsMobile, useDebounced,
  useStoreHydrated

Gate: /dev/components renders every state side by side; cart, wishlist and
language persist across refresh; corrupt persisted blobs cannot crash the app;
Bangla digits on prices, ratings and counts (৪.৩ (৬৫)); tsc, lint and build
green; console clean.

Note: carousel.tsx and components.css are committed here at their creation
phase. Their Phase 3 changes (auto-scroll drift, scroll-snap removal) are
reflected in this final file state and described in the Phase 3 commit.`,
  P1,
  '.msg1.txt',
);

commit(
  `feat(phase-2): layout shell and cart drawer

Phase 2 complete — gate passed.

Shell ported from the reference, in shell.css:
TopBar -> Header (main row + nav row + mega) -> MobileHeader -> page -> Footer
-> BottomNav -> FloatingButtons -> CartDrawer -> MobileCategorySheet

- Mega menu with hover-intent and a hover-origin click guard, so the click that
  follows a hover-open does not immediately close it
- Cart drawer: lines, stepper, free-delivery bar, related carousel, CTA.
  Scroll position survives re-render, so the reference's renderDrawer() bug is
  not ported
- document-language.tsx applies bodyClass() and html lang from the store, which
  is what makes Bangla headings get line-height 1.25 (landmine #6)
- cart-totals.ts mirrors the reference's totals(): free delivery at ৳2,000,
  otherwise ৳60 flat (decision D6)

Gate: free-delivery maths exact at ৳0, ৳1,999, ৳2,000 and ৳50,000; Escape
closes the drawer, restores body scroll and returns focus to the trigger; mega
menu hover/click behaviour correct; one-click language toggle across top bar,
nav, drawer, footer and carousel; tsc, lint and build green; console clean.`,
  P2,
  '.msg2.txt',
);

commit(
  `feat(phase-3): homepage

Phase 3 complete — gate passed.

All 16 sections from the reference's home(), in reference order:
hero -> trust -> own brands -> external brands -> flash sale -> all categories
-> new arrivals -> best sellers -> only for you -> trending -> promo banners ->
featured -> recommended -> recently viewed -> popular -> newsletter

- home.css ported from the reference's hero, trust, section header, carousel
  presets, flash panel, countdown, category card, promo and newsletter blocks
- Hero: 4 slides, 380px min-height, dots, arrows, 5.5s auto-advance, pause on
  hover, swipe over 40px, no autoplay under reduced motion
- Flash sale with a real-time countdown that does not re-render the page
- Recently viewed reads the store and shows an empty state when nothing has
  been opened (the reference seeds demo ids at boot — landmine #12 — so this
  store starts empty)
- PreviewStrip is the reference's .pv bar, gated on
  NEXT_PUBLIC_SHOW_PREVIEW_STRIP === "true" and absent from the DOM by default
- Hero aria-label reads "Offers" / "অফার", matching the reference's t('offers')

Carousel auto-scroll, matching the reference at oshoppingbd.html L796-806:
continuous 0.5px/frame drift that ping-pongs at both ends and pauses on hover,
focus, wheel, touch and drag. scroll-snap-type was removed from .car-track
because it snapped every sub-pixel write straight back to the nearest card, so
the track never moved; the reference has no snap.

Gate: 16 sections in order; hero 380px measured live; 14 cards per rail and 13
for featured (the reference filters r >= 4.3); drift measured 22.4 -> 23.2 ->
24 and frozen at 26.4 across six samples while hovered; 11 overflowing tracks
with arrows shown and prev disabled at start; language toggle updates every
section in one click; no horizontal overflow (scrollWidth 1263 at 1280); tsc,
lint and build green; console clean.

Not verified in this session: side-by-side parity at 1440 and 390, and LCP/CLS.
The automation browser renders at ~2fps and has no resize tool.`,
  P3,
  '.msg3.txt',
);

commit(
  `chore(tools): session repair and doc verification scripts

One-off scripts kept for the record, plus one that is reusable:

- verify-docs.mjs: checks UTF-8 round-trip, BOM, U+FFFD and lost characters in
  STATUS.md and HANDOFF.md. Worth keeping — PowerShell 5.1 Set-Content rewrote
  HANDOFF.md as cp1252 during this session and destroyed every arrow, taka sign
  and Bangla digit in it
- repair-handoff*.mjs: the recovery passes that rebuilt those characters
- inspect-handoff.mjs: byte-level dump used to tell a real mangled glyph from a
  literal question mark
- update-status.mjs, add-phase3-evidence.mjs, fix-phase3-evidence.mjs,
  append-handoff-phase3.mjs: wrote the Phase 3 status and handoff entries with
  Node instead of PowerShell, for the same encoding reason`,
  TOOLS,
  '.msg4.txt',
);

commit(
  `docs: record phases 0-3 as complete

STATUS.md:
- Current position moved to Phase 3 complete, next action Phase 4
- Phase 3 gate evidence table added
- Phase table rows 0-3 marked done with their verification method
- Active claims released
- (shop)/page.tsx row corrected: it is the homepage now, not the Phase 0 proof
  page

HANDOFF.md:
- Phase 3 entry appended: what was completed, what was verified, what is not
  done, assumptions, landmines and the exact next step
- Landmines recorded: PowerShell Set-Content destroys UTF-8 in these docs;
  scroll-snap-type silently kills carousel auto-scroll; Get-Content renders
  UTF-8 as mojibake so the console can lie about a healthy file; the automation
  browser runs at ~2fps so a 0.5px/frame drift looks frozen; the cart drawer is
  always in the DOM with aria-hidden and inert, so snapshots always report a
  dialog open`,
  DOCS,
  '.msg5.txt',
);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== status ===');
console.log(git(['status', '--porcelain']).trim() || '(clean)');
console.log('\n=== log ===');
console.log(git(['log', '--oneline', '--stat', '--format=%h %s']).trim().split('\n').slice(0, 40).join('\n'));
