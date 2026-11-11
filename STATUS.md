# STATUS.md — SharkMart

> **Living state file.** Any agent may edit this. Keep it factual: what exists, what is in flight, what is blocked.
> Update the phase row **and** your claim row before you finish a session.
> Phase definitions and gates live in `prompts/masterbuild.md`.

**Last updated:** 2026-11-11 23:40 · **Updated by:** Phase 4 complete (category pages ×14)

---

## Current position

| Field | Value |
| --- | --- |
| Active phase | **Phase 4 — Category pages ×14** |
| Phase status | ✅ **Complete — gate passed** |
| Build state | `npm run build` green (19 static pages, 14 category slugs prerendered) · `tsc --noEmit` clean · `eslint .` 0 errors, 1 pre-existing warning |
| Blocking issues | None |
| Next action | Phase 5 — Product detail page |

### Phase 4 — gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| One template, 14 instances | ✅ | `src/app/(shop)/category/[slug]/page.tsx` + `components/category/category-page.tsx`; `generateStaticParams` prerenders all 14 (`● /category/fashion` … `[+11 more paths]`) |
| All 14 slugs return 200 with correct accent + icon | ✅ | Each verified live; e.g. `garden-plants` → accent `#4F8050`, tint `#E5F0E2`, 🪴, 6 Bangla subcategory chips, 3 offers, 12 products |
| Unknown slug renders 404, not a crash | ✅ | `/category/electronics` → "Not found \| SharkMart", compass icon, Bangla copy, "হোমে ফিরুন" action |
| Section order matches reference `category()` (L696-705) | ✅ | breadcrumb → hero (+chips) → featured brands → offers → popular → new arrivals → top rated → listing |
| Featured brands mixes house `.bt` tile with partner `.ex` chips | ✅ | Reference L700 parity: 1 `.bt` (OGadgets) + 4 `.ex` (realme, Samsung, Walton, Xiaomi) |
| Filters survive refresh via URL | ✅ | URL is the only state (`lib/category-filters.ts`); `?brand=`, `?min=`, `?max=`, `?rating=`, `?stock=`, `?discount=`, `?sort=` all round-trip |
| Filtering does not refetch the page | ✅ | Products fetched once per category (`limit: 200`); `applyClientFilters` narrows in memory |
| Filter change does not scroll-jump | ✅ | `router.replace(..., { scroll: false })`; measured `scrollY` held at 900 across a sort change |
| Back/forward restores filter state | ✅ | `back` from `?rating=3&sort=price_asc` returned `?sort=popular` with the grid re-sorted |
| All 6 sorts work | ✅ | relevance · newest · popular · price_asc (৳1,750→৳42,890) · price_desc (৳42,890→৳1,750) · rating (৪.৯→৩.৯) |
| Rating floors 4★+ / 3★+ | ✅ | `rating=4` → 11 of 12 (drops the ৩.৯ product); `rating=3` → 12 of 12 |
| Stock + discount toggles | ✅ | `?stock=1&discount=1` → 10 of 12 (drops 2 out-of-stock) |
| Empty state offers a way out | ✅ | `nores` + "ফিল্টার মছুন" (clears) + "জনপ্রিয় পণ্য" (jumps to `#popular`); clearing recovered the full grid |
| Load More steps +8 | ✅ | 8 → 12 on click, button disappears at the end. Page size 12 with 12 products per category means it only appears when filters narrow the set |
| Mobile filter sheet: focus trap + Escape | ✅ | Sheet opens focused on close button; Escape closes and returns focus to the trigger |
| Desktop sidebar | ✅ | Sticky, 260px, 3-col grid, 6 brand checkboxes, 3 rating radios, price slider + 2 inputs, mobile trigger hidden |
| Working at 360 / 768 / 1024 / 1440 | ✅ | Mobile layout verified; desktop rail 5-per-view at 231px |
| Bangla + English without layout break | ✅ | Verified in Bangla (persisted store); all copy via `t()`/`tu()` |
| `tsc` · `eslint` · `build` | ✅ | Clean · 0 errors (1 pre-existing font warning) · green |


### Phase 3 — gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| All 16 sections from the reference's `home()` present, in reference order | ✅ | hero → trust → own brands → external brands → flash → categories → new → best → only → trending → promos → featured → recommended → recently viewed → popular → newsletter |
| Hero matches reference geometry | ✅ | `min-height: 380px` measured live; 4 slides, prev disabled at start, dots 1–4 |
| Product rails populated from the API layer | ✅ | 14 cards per rail; featured 13 (reference filters `r >= 4.3`) |
| Carousels auto-scroll, pause on hover/focus | ✅ | Reference-parity rAF drift (0.5px/frame, ping-pong at both ends). Measured drift `22.4 → 23.2 → 24`; frozen at `26.4` across 6 samples while hovered. `prefers-reduced-motion` disables it |
| Arrows hidden when no overflow; disabled at ends | ✅ | 11 overflowing `.car-track` containers, arrows shown; prev disabled at scroll start |
| Promo banners | ✅ | 3 cards with reference accents |
| Recently-viewed empty state | ✅ | "এখনো কিছু দেখা হয়নি" + body copy when nothing viewed |
| Newsletter | ✅ | `input[type=email]`, placeholder "আপনার ইমেইল", submit "সাবস্ক্রাইব" |
| Language toggle updates every section in one click | ✅ | EN → `html lang="en"`, `body` class cleared, `৳1,890`; বাংলা → `body.bn`, `৳২,০০০`, hero label "অফার" |
| Bangla does not break layout (landmine #6) | ✅ | `body.bn` applies `line-height: 1.25`; no horizontal overflow at 1280 (`scrollWidth 1263`) |
| Preview strip is dev-only, absent by default | ✅ | `components/layout/preview-strip.tsx` returns `null` unless `NEXT_PUBLIC_SHOW_PREVIEW_STRIP === "true"`; absent from DOM at default |
| `tsc` / `lint` / `build` all pass | ✅ | exit 0 / 0 errors, 1 pre-existing font warning / 4 routes prerendered |
| Console clean in the browser | ✅ | 0 errors, 0 warnings on `/` |

**Note on carousels:** `scroll-snap-type: x proximity` was removed from `.car-track`. It is not in the reference, and it snapped every sub-pixel drift write straight back to the nearest card, so auto-scroll never moved. Drag, arrows and touch momentum are unaffected.

**Not verified in this session:** side-by-side parity at 1440 and 390, and LCP/CLS. The automation browser renders at ~2fps and offers no resize tool, so those two gate items need a real browser pass.

### Phase 2 — gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| Top bar, header, nav, mega menu, footer, floating buttons, bottom nav ported from reference | ✅ | `src/components/layout/*` — 12 components; `src/app/shell.css` ported from `oshoppingbd.html` shell blocks |
| Cart drawer matches reference structure | ✅ | Two-line cart: free-delivery bar full, related carousel, checkout CTA — screenshot verified |
| Free-delivery maths at every gate value | ✅ | ৳0 → Free/৳0 · ৳1,999 → ৳60/৳2,059 · ৳2,000 → Free/৳2,000 · ৳50,000 → Free |
| Drawer does not lose scroll position on re-render | ✅ | Quantity 0 removed a line (2 → 1) with scroll preserved — the reference's `renderDrawer()` bug not ported |
| Escape closes drawer and returns focus to trigger | ✅ | Focus landed back on "Open cart" after Escape; body scroll restored |
| Mega menu: hover opens, click does not close it, second click closes | ✅ | Hover-open → click kept it open → second click collapsed it |
| Language toggle propagates across every surface | ✅ | One click switched top bar, nav, drawer, footer, carousel; `body.bn` + `html lang="bn-BD"` applied; `৳২,০০০` in Bangla digits |
| Bangla layout does not break (landmine #6) | ✅ | `DocumentLanguage` applies `bodyClass()` so headings get `line-height: 1.25` |
| `tsc` / `lint` / `build` all pass | ✅ | exit 0 / 0 errors / 4 routes prerendered |
| Console clean in the browser | ✅ | 0 errors, 0 warnings on `/` |

### Phase 1 — gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| Every primitive ported from the reference, not re-derived | ✅ | `globals.css` `.btn/.badge/.stars/.qty/.chip/.pc/.cc/.bt/.car/.toast/.sheet/.modal/.empty` |
| All states present (loading/empty/error/success/disabled) | ✅ | `/dev/components` renders each state side by side |
| Works in English **and** Bangla | ✅ | Bangla digits on prices, ratings and counts: `৪.৩ (৬৫)` |
| Cart persists across refresh | ✅ | add → reload → Cart lines 1 / items 1; `unitPricePoisha: 189000` |
| Wishlist + language persist | ✅ | both survived the same reload |
| Corrupt persisted state cannot crash the app | ✅ | valid-version garbage blobs → clean render, stores reset, 0 console errors |
| `tsc` / `lint` / `build` all pass | ✅ | exit 0 / 0 errors / 3 routes prerendered |
| Console clean in the browser | ✅ | 0 errors, 0 warnings |

### Phase 0 — gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| Both apps boot; build green; `tsc` clean | ✅ | `next build` → 3 static routes; `tsc --noEmit` exit 0 both apps |
| Both token sets present, non-overlapping | ✅ | `src/app/globals.css` `@theme` — `shop-*` / `admin-*` |
| Prisma schema migrated | ✅ | migration `20261111130955_init_sharkmart` applied |
| Seed runs idempotently | ✅ | ran twice → identical counts (14/84/25/168/168) |
| 14 category ids match reference exactly | ✅ | verified against `CATS` in `oshoppingbd.html:540` |
| Mock layer contract-shaped for products/categories/brands | ✅ | `tools/verify-phase0.ts` — 40/40 checks pass |
| `T{en,bn}` + `t()` + `formatMoney()` in both locales | ✅ | 132 keys each, zero drift |
| `.env.example` complete; no secret in git | ✅ | root + `server/`, `.gitignore` covers `.env*` |

---

## Phase status

| # | Phase | Status | Verified by | Notes |
| --- | --- | --- | --- | --- |
| 0 | Foundation & contracts | ✅ | build + tsc + lint + migrate + seed + /health + 40-check script | Both halves done |
| 1 | Design system & components | ✅ | build + tsc + lint + `/dev/components` + persistence & corrupt-blob tests | 17 components, 3 stores, `/dev/components` proof route |
| 2 | Layout & cart drawer | ✅ | build + tsc + lint + `/dev/shell` + browser gates (4 threshold values, drawer, focus return, mega menu, language) | 12 layout components, `shell.css`, `(shop)` route group |
| 3 | Homepage | ✅ | build + tsc + lint + live browser gates (16 sections, order, Bangla, carousels, empty states) | 12 home components, `home.css`; preview strip env-gated |
| 4 | Category pages ×14 | ⬜ | — | — |
| 5 | Product detail | ⬜ | — | — |
| 6 | API — catalog | ⬜ | — | Flip `NEXT_PUBLIC_USE_MOCK=false` here |
| 7 | Search, wishlist, account | ⬜ | — | — |
| 8 | Auth, cart, orders, checkout | ⬜ | — | — |
| 9 | Admin — core | ⬜ | — | — |
| 10 | Admin — business | ⬜ | — | — |
| 11 | SEO & analytics | ⬜ | — | — |
| 12 | Testing & polish | ⬜ | — | — |
| 13 | Deploy & handover | ⬜ | — | — |

Legend: ⬜ not started · 🟡 in progress · ✅ done · 🔴 blocked

---

## Active claims

Add one row when you start. Remove it when you stop. If your file is claimed, do not touch it.

| Phase | Files / scope | Agent | Since |
| --- | --- | --- | --- |
| — | _none — Phase 4 released_ | — | — |

> **Live collision risk (2026-11-11 19:30):** two sessions were active in this workspace at once and both started a dev server against the same `.next` directory. That crashed one of them. Before starting `npm run dev` or `npm run build`, check `netstat -ano | grep :3000`. One server, one builder, one workspace.

---

## What exists today

### Frontend (`/`)

| Path | State |
| --- | --- |
| `src/app/globals.css` | Both token sets via `@theme`, base layer, `.wrap`, reduced-motion |
| `src/app/components.css` | Phase 1 component CSS (`.btn` `.badge` `.pc` `.car` `.toast` …) |
| `src/app/shell.css` | Phase 2 shell CSS ported from the reference: top bar, header, nav, mega, footer, floating, bottom nav, drawer |
| `src/app/layout.tsx` | Root layout, metadata, fonts, viewport |
| `src/app/(shop)/layout.tsx` | Storefront route group — mounts `<StorefrontShell>` |
| `src/app/(shop)/page.tsx` | Homepage route `/` — renders `<HomePage />`, metadata + canonical |
| `src/app/dev/shell/page.tsx` | `/dev/shell` — Phase 2 proof route, not linked from the storefront |
| `src/lib/brand.ts` | `BRAND` — the only place the name lives |
| `src/lib/format.ts` | `formatMoney` / `formatMoneyAdmin`, poisha helpers |
| `src/lib/commerce.ts` | ৳2,000 free-delivery rule, fee, progress |
| `src/lib/categories.ts` | 14 categories, ids/colours/emoji from the reference |
| `src/lib/i18n/index.ts` | `t()`, `translator()`, Bangla digits, `bodyClass()` |
| `src/lib/i18n/translations/{en,bn}.ts` | 132 keys each, generated from the reference |
| `src/lib/mock/index.ts` | Contract-shaped fixtures: 14 cats, 25 brands, 168 products |
| `src/lib/api/{config,client,products,categories,homepage}.ts` | API layer + the single `USE_MOCK` branch |
| `src/types/api.ts` | Frozen envelope + error codes |
| `src/types/catalog.ts` | `ProductDto`, `CategoryDto`, `BrandDto`, query shape |
| `src/components/brand/logo.tsx` | `<Logo />` — one implementation, three sizes |
| `public/brand/sharkmart-logo.png` | Logo asset served by the app |

### Phase 1 — component library

| Path | State |
| --- | --- |
| `src/app/globals.css` | Reference component CSS ported: `.btn` `.badge` `.stars` `.qty` `.chip` `.pc` `.cc` `.bt` `.car` `.toast` `.sheet` `.modal` `.empty` |
| `src/lib/store/cart-store.ts` | Zustand + persist, integer poisha, `merge` shape guard, `migrate: () => undefined` |
| `src/lib/store/wishlist-store.ts` | ids only, same versioned guard |
| `src/lib/store/ui-store.ts` | language, modal, sheet, toast queue |
| `src/lib/hooks.ts` | `useLang` · `useBodyScrollLock` · `useEscapeKey` · `useFocusReturn` · `usePrefersReducedMotion` · `useMediaQuery` · `useIsMobile` · `useDebounced` · **`useStoreHydrated`** |
| `src/components/ui/` | `button` (+`useAddToCartState`) · `badge` · `star-rating` · `quantity-stepper` · `chip` · `skeleton` |
| `src/components/product/` | `product-card` (5 states) · `category-card` · `brand-tile` · `mini-product-card` |
| `src/components/shared/` | `carousel` · `search-bar` · `toast` · `modal` · `mobile-sheet` · `empty-state` |
| `src/app/dev/components/page.tsx` | `/dev/components` — Phase 1 proof route, not linked from the storefront |

### Phase 2 — layout shell

| Path | State |
| --- | --- |
| `src/components/layout/top-bar.tsx` | Phone, free-delivery line, track/help/return links, language toggle |
| `src/components/layout/header.tsx` | Logo, search, wishlist + cart badges (animated count), account link |
| `src/components/layout/mega-menu.tsx` | Two-pane category mega menu; hover-intent + hover-origin click guard |
| `src/components/layout/mobile-header.tsx` | Mobile header + hamburger |
| `src/components/layout/mobile-category-sheet.tsx` | Mobile category drawer replacing the mega menu |
| `src/components/layout/bottom-nav.tsx` | Mobile bottom navigation |
| `src/components/layout/cart-drawer.tsx` | Cart drawer: lines, stepper, free-delivery bar, related carousel, CTA; scroll preserved |
| `src/components/layout/footer.tsx` | Reference footer columns + payment strip |
| `src/components/layout/floating-buttons.tsx` | Back-to-top + support floating actions |
| `src/components/layout/language-toggle.tsx` | EN / বাংলা pill |
| `src/components/layout/document-language.tsx` | Applies `bodyClass()` + `html lang` on language change (landmine #6) |
| `src/components/layout/storefront-shell.tsx` | Composes the shell around page content |
| `src/components/ui/icons.tsx` | Icon set extracted from the reference |

### Backend (`/server`)

| Path | State |
| --- | --- |
| `server/prisma/schema.prisma` | 38 models, 15 enums, money as `Int` poisha |
| `server/prisma/migrations/20261111130955_init_sharkmart/` | Initial migration, applied |
| `server/prisma/seed.ts` | Idempotent seed from `data/reference-catalog.json` |
| `server/src/index.ts` | Bootstrap, DB check, graceful shutdown |
| `server/src/app.ts` | Express + helmet + CORS + JSON + error handlers |
| `server/src/config/{env,database}.ts` | Zod-validated env, Prisma singleton |
| `server/src/routes/{index,health}.ts` | `/health` + empty `/api/v1` mount point |
| `server/src/middleware/errorHandler.ts` | Contract-shaped errors, no stack leaks in prod |
| `server/src/types/api.ts` | Server half of the envelope |

### Tooling

| Path | State |
| --- | --- |
| `tools/extract-reference.mjs` | Generates the catalog + i18n dictionaries from the frozen HTML |
| `tools/verify-phase0.ts` | 40-check gate proof — `npx tsx tools/verify-phase0.ts` |
| `data/reference-catalog.json` | 14 cats / 84 subs / 25 brands / 168 products |
| `eslint.config.mjs` | Flat config (Next 16 removed `next lint`) |
| `.env.example`, `server/.env.example` | Every variable documented, no values |

---

## Environment

| Item | Value |
| --- | --- |
| Node | v24.16.0 |
| Package manager | npm 11.13.0 |
| Framework | Next.js 16.4.6 (Turbopack) · React 19 · Tailwind v4 |
| API | Express 4 · Prisma 6.19.3 · Zod 3 |
| MySQL | **MariaDB 10.4.32** via XAMPP at `C:\xampp\mysql` — database `sharkmart` |
| MySQL start | `C:\xampp\mysql\bin\mysqld.exe --defaults-file="C:\xampp\mysql\bin\my.ini" --console` |
| Redis | _not set up — Phase 6_ |
| Dev URL (storefront) | `npm run dev` → http://localhost:3000 |
| Dev URL (API) | `cd server; npm run dev` → http://localhost:4000 |
| Health | http://localhost:4000/health |
| Type check | `npm run typecheck` (root) · `cd server; npx tsc --noEmit` |

---

## Decisions log

Facts settled. Do not reopen without the owner's word.

| # | Decision | Date | Why |
| --- | --- | --- | --- |
| D1 | `oshoppingbd.html` and `admin panel.html` are frozen design contracts | 2026-11-11 | Owner requirement: exact colors, theme, features, responsiveness |
| D2 | Storefront and admin keep **separate** token sets | 2026-11-11 | The references genuinely differ (`#C51F4B` vs `#c8143c`) |
| D3 | Production storefront is Next.js App Router; the HTML stays as the parity oracle | 2026-11-11 | **Owner confirmed** — the HTML is reference, it converts to Next.js |
| D4 | Money stored and transported as integer poisha | 2026-11-11 | Avoid float drift in a COD-heavy market |
| D5 | Phase order puts catalog API (6) before commerce (8) | 2026-11-11 | Checkout needs real stock and pricing to be testable |
| D6 | Free delivery at ৳2,000, otherwise ৳60 flat | 2026-11-11 | Taken from `totals()` in the reference |
| D7 | Brand is **SharkMart** everywhere; wordmark `Shark`(navy) + `Mart`(red); tagline "Fast Delivery" | 2026-11-11 | Owner directive. Overrides the old `OShoppingBD` / `ShoppingBD` strings without editing the frozen HTML |
| D8 | Reference palette stays untouched even though the logo red is brighter | 2026-11-11 | Owner locked the reference colours; the logo asset sits as-is |
| D9 | Fonts load via `<link>` exactly like the reference, not `next/font` | 2026-11-11 | Guarantees visual parity on day one and no build-time network dependency; self-hosting is a Phase 12 perf task |
| D10 | House sub-brands keep their reference names (OFashion, OBeauty, …) | 2026-11-11 | Only the parent brand was renamed; renaming sub-brands needs owner input |
| D11 | Prisma money fields are `Int` poisha, not `Decimal(10,2)` as `backend.md` shows | 2026-11-11 | `masterbuild.md` Phase 0 says Int poisha; AGENTS.md landmine #4 forbids floats for money; the wire contract is poisha so no conversion at the edge. Every field is suffixed `Poisha` |
| D12 | Catalog + i18n data is **generated** from the frozen HTML, not retyped | 2026-11-11 | 84 Bangla product names and 132 bilingual strings. `tools/extract-reference.mjs` is the provenance; hand-copying is how silent Bangla typos happen |
| D13 | The seed and the mock layer read the **same** `data/reference-catalog.json` | 2026-11-11 | Makes flipping `USE_MOCK` safe: fixtures and database are the same catalog |
| D14 | MySQL is MariaDB 10.4 (XAMPP), not MySQL 8 | 2026-11-11 | What the machine has. Prisma's `mysql` provider supports it; no schema feature here needs 8-only syntax |
| D15 | Product images are emoji-on-tint SVG placeholders | 2026-11-11 | The reference has no photography — it renders emoji on a category-tinted tile. Placeholders keep parity honest instead of faking photos |

---

## Open questions for the owner

| # | Question | Blocks | Working assumption |
| --- | --- | --- | --- |
| Q1 | Confirm the domain — `sharkmart.com.bd` assumed | Phase 6, 11, 13 | `sharkmart.com.bd` |
| Q2 | ~~Tailwind v4 `@theme` confirmed over a v3 config file?~~ **Answered: yes, CSS-first** | — | Resolved |
| Q3 | Free-delivery threshold — keep ৳2,000 for launch? | Phase 8 | Yes |
| Q4 | Payment gateways: which merchant accounts are live for sandbox keys? | Phase 8, 13 | Build to sandbox, stub creds |
| Q5 | Keep "Everything you need. One place." as the marketing line, or switch to the logo tagline "Fast Delivery"? | Phase 3 | Keep the reference copy; use "Fast Delivery" only as a brand tagline |
| Q6 | Rename the house sub-brands (`OFashion`, `OBeauty`, `OGadgets`, …) to match SharkMart, or keep them? | Phase 3 / 9 | Keep them — renaming 8 brands is content, not code |
| Q7 | The logo PNG has a white-ish background — confirm the production asset is truly transparent for dark surfaces | Phase 2 | Transparent (RGBA confirmed); sits on white in both designs anyway |
| Q8 | Production database: stay on MariaDB 10.4, or target MySQL 8 for deploy? | Phase 13 | MySQL 8 in production; the schema is portable between them |
