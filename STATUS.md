# STATUS.md — SharkMart

> **Living state file.** Any agent may edit this. Keep it factual: what exists, what is in flight, what is blocked.
> Update the phase row **and** your claim row before you finish a session.
> Phase definitions and gates live in `prompts/masterbuild.md`.

**Last updated:** 2026-11-13 · **Updated by:** Phase 9 pass B5 — Categories and Brands shipped (API + both screens). **Phase 9 complete, B1 through B5.**

---

## Current position

| Field | Value |
| --- | --- |
| Active phase | **Phase 9 — Admin panel: core modules** |
| Phase status | ✅ **PHASE 9 COMPLETE** — B1 products, B2 orders, B3 inventory, B4 reviews, B5 categories + brands. All five modules shipped, API and screen |
| Build state | Server: `npm test` **230/230** (11 files) · `tsc --noEmit` clean. Storefront: `npm run build` green (`ƒ /admin/categories`, `ƒ /admin/brands`) · `tsc --noEmit` clean. `prisma migrate status` clean, 8 migrations |
| Blocking issues | Redis not installed locally — cache/limiter run on the in-process fallback (correct, tested, single-process only). `Product` has no cost field, so neither the reference's "Estimated profit" KPI nor a stock-value column is computable (see HANDOFF). **The "flaky under parallel execution" note is resolved** — `vitest.config.ts` used `poolOptions.threads.singleThread`, a silent no-op since Vitest 4; suites were racing on shared MySQL rows. Now `fileParallelism: false`, three consecutive 201/201 runs. **`WarehouseStock` is written by nothing except the inventory adjust endpoint** — checkout decrements `ProductVariant.stock` only, so the two totals drift (**5,183 vs 4,736, a 447-unit gap** as of the B3 follow-up; it widens per checkout, so re-measure rather than trusting this figure). The intake number is no longer shown as availability in the admin table — it is collapsed under "Received at intake" in the drawer. See HANDOFF for the exact reconciliation |
| Next action | Phase 10 — not started. Phase 9 closed; see the B5 section below and the HANDOFF entry for the three delete rules |

### Phase 6 — gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| All endpoints return the exact contract envelope | ✅ | `tests/envelope.test.ts` — 7 success routes asserted `{ success, data }`; 404/422 asserted `{ success:false, error:{code} }`. No route returns a bare array |
| Nine endpoints live under `/api/v1` | ✅ | `products` · `products/slugs` · `products/:slug` · `categories` · `categories/:slug` · `brands` · `brands/:slug` · `search` · `flash-sale` · `homepage` · `landing/:slug` |
| Bilingual search returns sensible results in both scripts | ✅ | `tests/search.test.ts` — `যোগা` and `yoga` both resolve the same product slug; SKU and brand-name search verified |
| Pagination correct at page 1, last page, and beyond | ✅ | `tests/products.test.ts` — page 1 = exactly `limit`; last page = remainder; beyond last = empty array with honest `total`; consecutive pages do not overlap |
| `/homepage` is one request, not eight | ✅ | `tests/cache-and-limits.test.ts` — exactly one `cache:homepage:*` key after a call; 9 parallel `findMany` + 1 stock query, fixed count |
| p95 < 200ms on seeded data | ✅ | Warm p95: `/products` **12.9ms**, `/homepage` **44.1ms**, `/categories` **8.8ms**. Cold p95: `/products` 33.2ms, `/homepage` 117.3ms |
| Indexes proven by EXPLAIN | ✅ | All four heavy queries use an index (`range`/`ref`/`index`), no full scan. Plans pasted in `HANDOFF.md` |
| Draft/unpublished products never appear in public responses | ✅ | `tests/products.test.ts` creates a real draft and proves it is absent from listing, search, slug list, and 404s on direct access |
| No N+1 | ✅ | Warehouse stock summed in one `groupBy` per page (`warehouseStockFor`), not per row |
| Never `SELECT *` | ✅ | Explicit `PRODUCT_LIST_SELECT` in `mappers.ts`; every `findMany` names its fields |
| Public responses never leak `costPrice` | ✅ | `tests/products.test.ts` asserts the serialized payload contains no `costPrice` |
| Unknown slug is 404 with the envelope, never 500 | ✅ | Asserted for product and landing page |
| Redis cache with tag-based invalidation | ✅ | `cache.ts` — TTLs 300/600/120/60s; `invalidateTag` proven to delete registered keys and leave other tags intact |
| Rate limiting returns 429 | ✅ | Search bucket (30/min) trips 429 with `RATE_LIMITED` + `Retry-After`; `X-RateLimit-*` on every response |
| Zod validation on every query param | ✅ | Every schema `.strict()` — `?catgory=fashion` is a 422, not a silently ignored typo; `min>max` rejected with field detail |
| helmet · CORS allowlist · gzip · pino logging | ✅ | `app.ts`; gzip confirmed by `content-encoding: gzip` on `/homepage` |
| `npm run lint && npx tsc --noEmit && npm test` | ✅ | 0 errors (1 pre-existing font warning) · exit 0 · 57/57 |
| Server is actually linted | ✅ | `eslint.config.mjs` — the server was excluded from lint before this phase; a `server/**/*.ts` block was added |


### Phase 5 — gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| One route, every product | ✅ | `src/app/(shop)/product/[slug]/page.tsx`; `generateStaticParams` prerenders 168 slugs (`● /product/osb-1001` … `[+165 more paths]`) |
| Unknown slug renders 404, not a crash | ✅ | `/product/does-not-exist` → HTTP 404 |
| Section order matches reference `product()` (L720-771) | ✅ | breadcrumb → gallery+info → tabs → reviews → FBT → related → similar → also-viewed → from-brand → recently-viewed |
| All 8 tabs, reference order | ✅ | Overview · Description · Key Features · Specifications · How to Use · Size Guide · Delivery & Returns · FAQ |
| Tabs are a real tablist | ✅ | `role="tablist"`, roving tabindex, Arrow/Home/End move focus + selection, `aria-selected` + `aria-controls` |
| Variant selection drives price, stock and cart payload from one derivation | ✅ | `resolveVariant()` in `variant-selector.tsx`; live: base ৳1,890 → XL ৳2,570 → XL · Sand ৳3,251 (delta = `round(price × .12 × i / 10) × 10` poisha, reference formula). Since Phase 8 a variant is a full combination; `variantId` resolves through `variantGroups[].combinations` |
| Quantity clamped to the selected variant's stock | ✅ | Derived (`effectiveQuantity`), not an effect — no stale window, no cascading render |
| Gallery shows the reference's 5 angles | ✅ | Front · 1/5 · Back · 2/5 · Side · 3/5 · Detail · 4/5 · In use · 5/5. Data-URI SVG placeholders are treated as "no photo" so the angle fallback runs; real photo URLs flip it automatically |
| Add to cart writes a real variant line | ✅ | Live click: button → ✓, cart badge 2 → 3, toast fires |
| Recently viewed recorded once per mount | ✅ | `recordView(product.id)` in an effect, after hydration |
| Specs render once each, no invented rows | ✅ | SKU · Brand · Category · Warranty · Origin. No fabricated barcode, no invented warranty (both are in the reference, neither is in the data) |
| Money matches the reference formatter | ✅ | `formatMoney` rounds to whole taka like `fmt = n => '৳' + nf(Math.round(n))`; poisha stays the stored unit |
| Bangla + English without layout break | ✅ | Verified in both; all copy via `t()`/`tu()` |
| No horizontal overflow at 1280 | ✅ | `scrollWidth 1263` vs `clientWidth 1280` |
| `tsc` · `eslint` · `build` | ✅ | Clean · 0 errors (1 pre-existing font warning) · green |


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

### Phase 7 — search + guest wishlist gate evidence

Scope note: Phase 7 in `masterbuild.md` covers search, wishlist and account **plus** "replace the mock layer with real data for everything already built". The catalog flip half landed earlier. This session completed `/search` and the guest wishlist. The account surface needs a session and is deferred to Phase 8 — see the deferred list below.

| Gate requirement | State | Evidence |
| --- | --- | --- |
| Mock layer off for the catalog routes | ✅ | `.env.local` `NEXT_PUBLIC_USE_MOCK=false`; `npm run build` prerendered 189 pages from `http://localhost:4000/api/v1` |
| Zero component signature changes | ✅ | No existing component's props changed. `SearchBar`'s `products` prop is now documented `@deprecated` and ignored, not removed — callers keep compiling |
| Five surfaces match the frontend DTOs | ✅ | `node tools/parity-check.mjs` → **611 field assertions, 5/5 PASS** |
| Detail endpoint serves the flat `ProductDetailDto` | ✅ | `variantGroups`/`reviews`/`ratingBreakdown`/`featuresEn`/`featuresBn`/`specs`/`tintColor`/`accentColor` on the wire; nested shape removed |
| Seeded content is real, not just declared | ✅ | 747 variants (full cartesian product) · 840 specifications · 168 feature blocks |
| Variant stock agrees with warehouse stock | ✅ | All 168 products: `Σ variant.stock === WarehouseStock.quantity`, 0 mismatches (3 `CONC-*` test leftovers excluded — see HANDOFF) |
| `/search` renders results in the first HTML response | ✅ | `curl localhost:3000/search?q=panjabi` → 2 product cards, 1 line containing `৳`, 0 `aria-busy`. Server component loads via `initialData`, no effect |
| Search works in both scripts | ✅ | `?q=panjabi` → 2 results · `?q=পাঞ্জাবি` → 2 results, both 1 `৳` line |
| Empty state, not a skeleton | ✅ | `?q=zzzzzz` → `aria-busy` count 0, `Nothing matched` present, 0 product cards, 3 escapes (browse all, popular, category links) |
| Missing/1-char query is not a 404 | ✅ | `/search` → 200 with the "Type at least 2 characters" prompt; `?q=a` → 200, 0 cards |
| Result pages are not indexed | ✅ | `robots: { index: false, follow: true }` → `noindex` present exactly once |
| Autocomplete sources from the API | ✅ | Header box, `panjabi` → 2 live products (`Cotton Panjabi`, `Premium Cotton Panjabi`); the mock-era product set is no longer consulted |
| Type-ahead does not trip the limit | ✅ | 12-character query typed key-by-key → no 429; bucket raised 30→90/min |
| Failed request leaves the box usable | ✅ | API stopped, `panjabi` typed → value retained, no throw, list closed, Enter still navigated to `/search?q=panjabi` |
| Guest wishlist toggles from card and PDP | ✅ | Card heart → count 1; PDP `♥ Wishlist` → count 1 |
| Wishlist persists across reload | ✅ | Reload → `sharkmart.wishlist` intact, count 1, product rendered |
| Header count matches the list | ✅ | After pruning a stale id: count `1`, exactly 1 product rendered |
| Remove works, empty state has an action | ✅ | Remove → empty state with "Browse all products" |
| Build, typecheck, lint green | ✅ | `next build` green · `tsc --noEmit` clean both apps |

**Bug found and fixed during the gate — pagination cap.** The catalog is 168 products and `MAX_PAGE_LIMIT` is 100, so a single `listProducts` read silently omitted every product past the first hundred. A wishlist item or a search match living on page 2 rendered as "empty". Both `/search` and `/wishlist` now page through to the server's own `total`, bounded by a hard ceiling.

**Bug found and fixed during the gate — stale ids inflate the count.** A saved id can outlive its product (the mock-era `prd_osb-1001` is one). The page dropped the unresolvable id but the header badge still counted it, so the badge said 2 while one product showed. `/wishlist` now prunes ids that a *complete* catalog read proves are gone.

**Deliberate omission — reviews are not seeded.** A fabricated customer review with a person's name on it is not demo data, it is a lie. `reviewCount` still carries the catalog's aggregate, so the rating badge renders; the review list shows its empty state until real reviews exist.

#### Deferred to Phase 8 (needs a session)

`/login` · `/register` · `/profile` · `/profile/addresses` · `/orders` ·
`/orders/[id]` · `/track` · guest→login cart/wishlist merge · the IDOR gate item.

The wishlist merge hook point is marked in `src/components/wishlist/wishlist-page.tsx`
with a `PHASE 8:` comment at the exact place the local list must be POSTed and
cleared only after the server confirms.

---

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

### Phase 9 pass B3 — inventory gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| Stock-of-record rule written down, not invented | ✅ | `inventory.service.ts` header + `stockOfRecordOf()`. The rule is `cart.service.ts:191-200` and `mappers.ts:277-282` restated — no new concept |
| Storefront badge unchanged by the rule | ✅ | `totalStock()` in `mappers.ts:277` already prefers variant sum when variants exist. No public contract touched |
| `GET /admin/inventory` returns both numbers + derived status | ✅ | Live: `warehouseQty`, `variantStock`, `stockOfRecord`, `stockSource`, `stockStatus` on every row |
| Sorting by stock sorts on `stockOfRecord` | ✅ | Test asserts the returned `stockOfRecord` sequence is monotonic under `sort=stock_asc` |
| `stock=out` count equals a direct DB count | ✅ | Live: endpoint `total` **15**, independent recompute **15**; all 15 rows `stockOfRecord === 0` |
| KPI strip computed server-side | ✅ | `/alerts` → `{out:15, low:21, in:132, total:168, units:4966, skus:168}`; matches an independent recompute exactly. Browser counts nothing |
| adjust +5 on a variant product | ✅ | `variant.stock` +5, **1** StockMovement, **1** AuditLog. Live: units 4,961 → 4,966 |
| adjust +5 on a no-variant product | ✅ | Test creates a variant-less fixture (the seed has none) → `WarehouseStock.quantity` +5, no variant touched |
| adjust to a negative result | ✅ | Live 422: *"That would take stock to -50. The current quantity is 23…"*; row unchanged, nothing written |
| adjust without a reason | ✅ | 422 from Zod (`min(5)`), and a 2-char reason is a 422 too |
| A no-op adjustment writes nothing | ✅ | `changed:false`, zero movement rows, **zero audit rows** — the no-op check runs before the transaction opens |
| Every mutation writes both logs | ✅ | Counted against the live DB: 1 movement / 1 audit per real adjustment |
| MARKETING_STAFF can read, cannot write | ⚠️ **conflict** | The matrix gives MARKETING_STAFF **no** `inventory:read`, so GET is 403 as well as POST. Brief said "can GET". Matrix left alone — see HANDOFF |
| `npx tsc --noEmit` both packages | ✅ | exit 0, no output |
| `npm test` | ✅ | **183/183**, 9 files, three consecutive green runs |
| `npm run build` | ✅ | `✓ Compiled successfully`; `/admin/inventory` present as a dynamic route |
| `npm run lint` | ✅ | 0 errors, 15 pre-existing warnings |
| No horizontal scroll at 1440 / 1024 / 720 / 360 | ✅ | `scrollWidth - clientWidth = 0` at all four widths |
| Table stacks to cards at 720 | ✅ | `thead` display `none`, `tr` `block`, `td` `flex`, `::before` content `"Product"` from `data-label` |
| Dark mode: no surface under 3:1 | ✅ | Lowest measured pair **3.95:1** (`th`), most 6.5–14:1 |
| Port 3000 is `npm run dev` | ✅ | Killed the orphaned `next start` (PID 19520) first — landmine 15 |

---

### Phase 9 pass B5 — categories and brands gate evidence

**Phase 9 is complete.** B5a (API) and B5b (both screens) shipped as two separate
commits. The API half was verified before the screens started and was not
re-opened.

| Gate requirement | State | Evidence |
| --- | --- | --- |
| `/admin/categories` returns 200 with 14 roots | ✅ | Live: `14 roots · 84 sub-categories · 98 total`. Tree expands per root; 84 children is the reference structure and was deliberately not pruned |
| The three "Accessories" are distinguishable | ✅ | Live at `?q=Accessories`: `Fashion / Accessories`, `Automotive & Motorbike / Accessories`, `Gadgets & Electronics / Accessories`. Every child row renders its `path`; a root renders it too when its name collides |
| Delete a category with products | ✅ | Live on Fashion (12 products): 409 `CATEGORY_IN_USE` → dialog states "12 products use this category", lists Cotton Panjabi / Denim Jeans / Ladies Handbag + "and 9 more…", Delete button disables, **row survives (98 rows after)** |
| Delete a parent with children | ✅ | Live on a temporary parent with one child: 409 `CATEGORY_HAS_CHILDREN` → dialog states the child count and offers "Reparent and delete". Ran it: parent deleted, child promoted to root (`1 roots · 0 sub-categories`) |
| Delete a brand with products | ✅ | Live on Samsung (2 products): 409 `BRAND_IN_USE` → dialog offers "Detach 2 products and delete". Ran it: brand gone (25 → 24), **both products still exist with `brandId: null`**, 168 products total unchanged. Seed restored afterwards |
| Reorder via buttons | ✅ | Moved Women above Men: `sortOrder` came back dense `0..5` with no gaps and the order persisted across reload. Original order restored |
| Reorder refuses a partial group | ✅ | The endpoint 422s unless `orderedIds` is the complete sibling set, so the buttons are disabled whenever a search or active filter is on, and the toolbar says why |
| Search + active filter | ✅ | `q` and `active=all|true|false` both wired to the URL on both screens; brand screen adds `sort=sortOrder|name|products` |
| Mobile stacking under 720px | ✅ | All 7 `.cat-*` rules inside the 720px media query load and parse; `data-label` on every `td` supplies the stacked header. **Not visually confirmed** — no viewport-resize tool in this session, see HANDOFF |
| No horizontal scroll | ✅ | `scrollWidth - clientWidth = 0` on the document and on `.table-wrap` at 1280 |
| Dark mode | ✅ | Measured contrast on the new surfaces: name 14.12:1, count 6.52:1, search input 12.84:1. The active toggle was 3.23:1 at 12px text — below the 4.5:1 that size needs — and was raised to `#a7f3d0` on a 0.3 alpha fill |
| `npx tsc --noEmit` both packages | ✅ | exit 0, no output |
| `npm test` | ✅ | **230/230**, 11 files |
| `npm run build` | ✅ | `✓ Compiled successfully`; `ƒ /admin/categories` and `ƒ /admin/brands` both present |
| Encoding survived the edit | ✅ | **Defect found and fixed:** a PowerShell `Get-Content`/`Set-Content` round-trip double-encoded `categories-tree.tsx` (Bangla strings and the `·` placeholder rendered as mojibake). Reversed programmatically and re-verified; the other four files were clean |

**The three delete rules, in one place:**

1. **Category with products → RESTRICT.** 409 `CATEGORY_IN_USE` with the count and
   three product names. There is no bulk move for products, so this is a manual
   step and the dialog says so.
2. **Category with children → refuse unless `?reparent=true`.** 409
   `CATEGORY_HAS_CHILDREN`; reparenting promotes the children to root first.
3. **Brand with products → SET NULL, behind an explicit `?detach=true`.** 409
   `BRAND_IN_USE` by default; detaching keeps the products and nulls their brand,
   and the response carries `affectedCount` so the screen can report it.

**Deliberately cut in B5, not forgotten:** drag-and-drop reorder (the buttons hit
the same endpoint for the same `sortOrder` fix and work on touch), CSV export (98
categories and 25 brands do not need one), and bulk select with the sticky bulk
bar (the API exposes no bulk operation for either entity, so the bar would be
decoration). Create and edit forms were never in B5's scope.

---

### Phase 9 pass B4 — reviews gate evidence

| Gate requirement | State | Evidence |
| --- | --- | --- |
| "Never moderated" and "rejected" are distinguishable | ✅ | Two nullable columns, `Review.moderatedAt` + `moderatedBy` — migration `20261113103358_phase9_review_moderation`, applied by hand-written SQL then `migrate resolve` (landmine 16: history stays honest, no `db push`). No status enum: a third state would have to be kept in sync with these two and would eventually disagree |
| `moderatedBy` survives a deleted staff account | ✅ | `String?` with **no FK**, matching `AuditLog` — a cascade would erase the record of who moderated what. Documented in the schema comment |
| Pending queue is exactly "unmoderated" | ✅ | Live: 6 pending in the fixture → approve one → 5 pending / 2 rejected. A rejected review does not reappear in the queue |
| Approve / reject / delete / bulk, all four live | ✅ | Approve moved counts 6→5 pending, 1→2 rejected over real HTTP. Bulk approve from the UI: "1 updated", pending 5→4, approved 2→3 |
| Delete removes the row and writes an audit row | ✅ | Live DELETE + audit row verified against the DB, not just the response |
| Permission gates are real, both directions | ✅ | `phase9e-reviews.test.ts` asserts **both** ways because a gate that only proves one direction is untested: MARKETING_STAFF **can** moderate (200, state `approved`); INVENTORY_STAFF **can** read list/counts/detail but gets 403 on approve, reject, flag and delete, and the row is still `isApproved:false / isFlagged:false / moderatedAt:null` afterwards; CUSTOMER is refused at the staff gate. Note this is the *opposite* split from inventory, where MARKETING_STAFF has no `inventory:read` — the matrix is per-permission, not per-role |
| Rating aggregate is honest about what is stored | ✅ | Drawer shows "Stored: 4.30 · 65, Actually approved: 3" with the explanation. Under the shipped decision nothing writes `Product.ratingAvg`, so the stored figure can disagree with the approved-review average — the screen says so instead of hiding it |
| Screen renders at 360 / 720 / 1024 / 1440 | ✅ | `scrollWidth - clientWidth = 0` at all four widths; table stacks to cards at 720 |
| Bulk bar reachable at 360 | ✅ | **Defect found and fixed:** the bar sat at `bottom: 8px` / `z-index: 20` under the `fixed` bottom nav (`z-index: 30`). Lifted above it; buttons now tappable |
| Star rating reads as filled | ✅ | **Defect found and fixed:** "on" stars were stroke-only, so a 5-rating looked identical to an empty one. Now filled |
| Stars stay inline | ✅ | **Defect found and fixed:** stars stacked vertically in the drawer; now inline |
| No orphaned control in the stacked layout | ✅ | **Defect found and fixed:** the row checkbox floated unlabelled at top-right; now carries a "Select" label |
| Server → client boundary is legal | ✅ | **Defect found and fixed:** a `hrefFor` function was passed from a server component into a client component, which threw at runtime. Replaced with precomputed hrefs |
| Dark mode readable | ✅ | Verified visually; no surface under 3:1 |
| `npx tsc --noEmit` both packages | ✅ | exit 0, no output |
| `npm test` | ✅ | **201/201**, 10 files, three consecutive green runs |
| `npm run build` | ✅ | `✓ Compiled successfully`; `ƒ /admin/reviews` present as a dynamic route |
| `npm run lint` | ✅ | 0 errors, 15 pre-existing warnings |
| Test-runner flake root-caused, not worked around | ✅ | `vitest.config.ts` set `poolOptions.threads.singleThread` — **a silent no-op since Vitest 4** (still type-valid, so it fails quietly). Files were running in parallel against one MySQL database. Replaced with `fileParallelism: false`; the "different test fails each run" pattern stopped |

---

## Phase status

| # | Phase | Status | Verified by | Notes |
| --- | --- | --- | --- | --- |
| 0 | Foundation & contracts | ✅ | build + tsc + lint + migrate + seed + /health + 40-check script | Both halves done |
| 1 | Design system & components | ✅ | build + tsc + lint + `/dev/components` + persistence & corrupt-blob tests | 17 components, 3 stores, `/dev/components` proof route |
| 2 | Layout & cart drawer | ✅ | build + tsc + lint + `/dev/shell` + browser gates (4 threshold values, drawer, focus return, mega menu, language) | 12 layout components, `shell.css`, `(shop)` route group |
| 3 | Homepage | ✅ | build + tsc + lint + live browser gates (16 sections, order, Bangla, carousels, empty states) | 12 home components, `home.css`; preview strip env-gated |
| 4 | Category pages ×14 | ✅ | build + tsc + lint + 14 live slugs + 404 + filter round-trip | 1 template, 14 instances |
| 5 | Product detail | ✅ | build + tsc + lint + live browser (variant price, tabs, add-to-cart, 404, 5-angle gallery) | 168 product pages prerendered |
| 6 | API — catalog | ✅ | build + tsc + lint + `npm test` 57/57 + parity-check 611 assertions | Flip `NEXT_PUBLIC_USE_MOCK=false` done here |
| 7 | Search, wishlist, account | ✅ | build + tsc + live browser (both scripts, type-ahead, wishlist toggle/reload/remove) | `/search` + guest wishlist; account surface landed in Phase 8 |
| 8 | Auth, cart, orders, checkout | ✅ | `npm test` 89/89 · tsc clean (both) · build green · live browser (merge, badge, drawer, `/cart` agree) | 747 variants (cartesian) · 3 follow-ups closed 2026-11-12 |
| 9 | Admin — core | 🟡 | B1 products + B2 orders + B3 inventory + B4 reviews: `npm test` **201/201** (10 files, 3 consecutive runs) · tsc clean (both) · build green · live browser (tabs, drawer, approve, bulk bar, 4 widths, dark mode) | B5 (categories, brands) remains |
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
| — | _none — Phase 5 released_ | — | — |

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
| D16 | Storefront routes load data on the **server** and pass it to the client page component as `initialData` | 2026-11-11 | Before this, `/` and all 14 category pages shipped an empty skeleton (31 KB, 0 product cards) and the crawler saw nothing. Measured after: `/` 492 KB / 222 product cards, `/category/fashion` 96 KB / 60 product links. Client components stay client for the language toggle and carousels — they just no longer *start* empty |
| D17 | `CategoryListing` sits inside a `<Suspense>` boundary | 2026-11-11 | It calls `useSearchParams()`, which cannot run during prerender; without the boundary `next build` fails with "useSearchParams() should be wrapped in a suspense boundary". Scoping it to the listing keeps the hero, breadcrumb and three product rails server-rendered |
| D18 | Security rules consolidated in `prompts/security.md`; `frontend.md` §16 renamed to make "never authorize in the browser" explicit | 2026-11-12 | Rules were split across three files and one heading implied frontend-side security |
| D19 | House brands drop the `O` prefix: `OFashion`→`Fashion`, `OBeauty`→`Beauty`, `OFragrance`→`Fragrance`, `OGadgets`→`Gadgets`, `ONature`→`Nature`, `OHome`→`Home`, `OFood`→`Food`, `OBooks`→`Books` | 2026-11-12 | Owner decision. The prefix was inherited from the old OShoppingBD brand. Slugs follow the names (`ofashion`→`fashion`), so brand `fashion` now shares a slug with category `fashion` — separate tables and separate routes, so nothing collides, but never resolve both out of one map |
| D20 | The rename lives in `HOUSE_RENAMES` in `tools/extract-reference.mjs`, and the DB rows were renamed in place | 2026-11-12 | `data/reference-catalog.json` is generated; hand-editing it would be undone by the next run. Renaming in place (migration `20261112063500_rename_house_brands`) keeps `brandId` foreign keys on 74 products intact — deleting and re-seeding would orphan or duplicate 8 brand rows |
| D21 | Search rate limit raised **30 → 90 per 60s** | 2026-11-12 | The bucket also serves the header type-ahead, and a 12-character query is ~12 requests on its own. At 30 a normal shopper got a 429 mid-word — the limiter blocking the user it exists to protect. 90 still bounds a `contains` scan at 1.5 req/s per IP. `prompts/security.md` §3 updated in the same commit |
| D22 | `SearchBar` suggestions come from `searchProducts` (the API), not the local mock catalog | 2026-11-12 | `USE_MOCK` is false, so the mock catalog and the live catalog are no longer the same set. The header was suggesting products the real catalog might not contain, and clicking one landed on a 404. The server's bilingual `contains` is the only source that agrees with what `/search` returns. Categories stay local — they are the 14 fixed reference records, not catalog data |

---

## Open questions for the owner

| # | Question | Blocks | Working assumption |
| --- | --- | --- | --- |
| Q1 | Confirm the domain — `sharkmart.com.bd` assumed | Phase 6, 11, 13 | `sharkmart.com.bd` |
| Q2 | ~~Tailwind v4 `@theme` confirmed over a v3 config file?~~ **Answered: yes, CSS-first** | — | Resolved |
| Q3 | Free-delivery threshold — keep ৳2,000 for launch? | Phase 8 | Yes |
| Q4 | Payment gateways: which merchant accounts are live for sandbox keys? | Phase 8, 13 | Build to sandbox, stub creds |
| Q5 | Keep "Everything you need. One place." as the marketing line, or switch to the logo tagline "Fast Delivery"? | Phase 3 | Keep the reference copy; use "Fast Delivery" only as a brand tagline |
| Q6 | ~~Rename the house sub-brands (`OFashion`, `OBeauty`, `OGadgets`, …) to match SharkMart, or keep them?~~ **Answered: renamed, `O` prefix dropped — see D19** | — | Resolved |
| Q7 | The logo PNG has a white-ish background — confirm the production asset is truly transparent for dark surfaces | Phase 2 | Transparent (RGBA confirmed); sits on white in both designs anyway |
| Q8 | Production database: stay on MariaDB 10.4, or target MySQL 8 for deploy? | Phase 13 | MySQL 8 in production; the schema is portable between them |
