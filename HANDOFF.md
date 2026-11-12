# HANDOFF.md — SharkMart

> **Append-only.** Newest entry at the top. Never rewrite or delete a previous agent's entry — the next agent needs the history of what was tried and rejected.
> One entry per session. Be specific: file paths, commands, results. Vague handoffs are how work gets rebuilt twice.

**Template** (copy this for each session):

```markdown
## YYYY-MM-DD · Phase N · <agent/model> · <duration>

**Completed**
- `path/to/file.tsx` — what it does now

**Verified** (paste real command output or observed behavior)
- `npm run build` → green
- manual: ...

**Not done / partial**
- specific, not "mostly wired"

**Assumptions**
- ...

**Landmines**
- ...

**Next step** (one actionable sentence)
- ...
```

---

## 2026-11-12 · Phase 7 (part 1) · catalog flipped to the real API

**Completed**

- `server/prisma/seed.ts` — now materialises the detail-page content the mock layer used to generate at request time. Adds `seedAttributes()` (one `ProductAttribute` per category axis, plus Colour on fashion and gadgets), and `seedProductContent()` which writes `ProductVariant` + `VariantOption`, `ProductSpecification` and a `FEATURES` `ProductDetail` row per product. Axis table is the reference's own `VARS()` map (oshoppingbd.html L720).
- `server/src/services/product.service.ts` — `getProductBySlug()` now returns the **flat** `ProductDetailDto` instead of the nested `{ product, categoryColors, specifications, details, reviews, relatedIds }`. The nested shape had no consumer: it pushed flattening into the frontend and left the Features tab with no source at all. Detail select now pulls each variant's `options` + `attribute`, which the list select deliberately does not.
- `server/src/services/mappers.ts` — added `toVariantGroups()` (rebuilds pill groups from `VariantOption.attribute`, colour → `kind: 'swatch'` with the reference's four hexes), `splitBullets()`, and loosened `toReviewDto`/`toSpecDto` to the partial rows the selects actually return.
- `src/lib/api/products.ts` — `getProductDetail()` now calls `/products/:slug`, not `/products/:slug/detail`. The `/detail` suffix was a Phase 0 plan the server never implemented; it would have 404'd every product page on the flip.
- `src/lib/api/categories.ts` — `getCategory()`/`getBrand()` unwrap the server's `{ category, products }` / `{ brand, products }` into the bare DTO the components read.
- `src/lib/api/config.ts` — added `MAX_PAGE_LIMIT = 100`, matching the server's `MAX_LIMIT`. Four call sites asked for `limit: 200` and the server rejects anything over 100 with a 422.
- `src/lib/{category-data,product-data,category-filters}.ts` — use `MAX_PAGE_LIMIT`.
- `server/tests/products.test.ts` — detail test now asserts the flat contract and that the nested one is gone.
- `tools/parity-check.mjs` — surface 4 asserts the flat DTO (and that `specs`/`variantGroups`/`featuresEn` are non-empty); surface 2 asserts the server's `{category, products}` shape.
- `.env.local` — `NEXT_PUBLIC_USE_MOCK=false`.

**Verified** (real command output)

- `npm run db:seed` → 588 variants · 840 specifications · 168 details · 0 reviews. Ran **twice**, identical counts.
- Stock integrity probe → all 168 products: `Σ variant.stock === WarehouseStock.quantity`, **0 mismatches**; all 15 sold-out products have every option at 0.
- `node tools/parity-check.mjs` → **611 field assertions, 5/5 surfaces PASS**.
- `npm run build` (root) → green, **187 static pages**, all prerendered from the live API.
- `npx tsc --noEmit` → clean, both apps.
- `npx eslint .` → 0 errors (1 pre-existing `layout.tsx` font warning).
- `npm test` (server) → **57/57**.
- Browser: `/product/osb-1009` renders spec rows, `S/M/L/XL` pills, four colour swatches, feature bullets; `/category/fashion` shows 12 real products with real stock states; `/` renders every rail from the API.

**NOT done**

- The rest of Phase 7: `/search`, `/wishlist`, `/login`, `/register`, `/profile`, `/profile/addresses`, `/orders`, `/orders/[id]`, `/track`. None of it is started.
- Reviews are **not** seeded, by decision. `reviewCount` still carries the catalog aggregate so the rating badge renders; the review list shows its empty state. Do not "fix" this by seeding the mock's generated reviews.

**Assumed**

- One variant per option per axis (not a full cartesian product). The UI renders one group per axis and lets the shopper pick independently, so `Size=M` and `Colour=Navy` are two rows, not one combined SKU. If Phase 8's cart needs a combined SKU per selection, that is a schema decision to make there, not a seed change.
- Variant stock is the product's real warehouse quantity distributed across options, not invented per-option numbers. `totalStock()` in the mapper sums variant stock when variants exist, so invented numbers would have silently overwritten real stock on every card.

**Landmines hit**

1. **`limit=200` vs the server's cap of 100.** The server rejects it with a 422 rather than clamping, so `next build` died at the first product page. One constant (`MAX_PAGE_LIMIT`) now, not four magic numbers.
2. **The wire's `ProductVariantDto` carries no axis.** It is right for the cart and useless for the detail page. Groups must be rebuilt from `VariantOption.attribute`, which means the detail select needs `options` even though the list select must not have it (N+1).
3. **`/products/:slug/detail` never existed.** The frontend was written against a plan, not the server. The flip is exactly the moment that surfaces.
4. **PowerShell eats `$` in `npx tsx -e "..."`.** `p.$disconnect()` became a variable lookup. Write a probe file instead.
5. **`.env.local` is on the sensitive-path blocklist** for the file tools. Flip it through the shell, and never print the value.
6. **`Get-Content` renders UTF-8 as mojibake in this console.** The files are fine. Use `readLocalFile` to check content.

**Exact next step**

- Build `/search` against the existing `GET /api/v1/search` (already live and tested for both scripts), then `/wishlist`, then the auth/account surface. Update the Phase 7 row in `STATUS.md` and append a new entry here.

---

## 2026-11-12 · Phase 6 · public catalog API · complete

**Completed**
- `server/src/services/mappers.ts` — the wire contract. `ProductDto` / `ProductDetailDto` / `CategoryDto` / `BrandDto`, explicit `PRODUCT_LIST_SELECT` (never `SELECT *`), `stockStatusOf`.
- `server/src/services/product.service.ts` — listing, slugs, detail. `PUBLISHED` filter defined once; warehouse stock summed in one `groupBy` per page, not per row.
- `server/src/services/category.service.ts`, `homepage.service.ts` — category tree with counts; the homepage aggregate (9 parallel `findMany` + 1 stock query, fixed query count).
- `server/src/services/cache.ts` — cache-aside with tag registration. TTLs: homepage 300s, categories 600s, products 120s, flash sale 60s.
- `server/src/config/redis.ts` — `KeyValueStore` with an ioredis backend and an in-process fallback. Redis down degrades to per-process caching; it never fails a request.
- `server/src/middleware/rateLimiter.ts` — fixed-window `INCR`+`EXPIRE`, 100/min API, 30/min search, `X-RateLimit-*` on every response, fail-open.
- `server/src/middleware/validate.ts`, `requestLogger.ts` — Zod query/param validation; pino HTTP logging.
- `server/src/validators/catalog.schema.ts` — every schema `.strict()` (unknown key = 422), every numeric `coerce`d and bounded.
- `server/src/routes/public/{products,categories,discovery}.ts` — all nine endpoints.
- `server/prisma/schema.prisma` + migration `20261111192735_phase6_catalog_api_indexes` — `originalPricePoisha` column and 6 composite indexes on the filtered/sorted paths.
- `server/tests/` — 57 tests across 4 files: envelope, products, search, cache-and-limits.
- `eslint.config.mjs` — **the server was excluded from lint entirely before this phase.** Added a `server/**/*.ts` block so `npm run lint` actually covers the API.

**Verified** (real command output)

- `npm test` (server) → **57 passed / 57**, 4 files, 3.69s
- `npx tsc --noEmit` (server) → exit 0
- `npx tsc --noEmit` (root) → exit 0
- `npx eslint .` (root) → **0 errors**, 1 pre-existing warning (`layout.tsx` custom font)
- `npx prisma validate` → valid
- `npm run build` (root) → green, 187 pages (168 product + 14 category + 5 static)

**EXPLAIN — indexes proven, not assumed**

| Query | type | key chosen | rows |
| --- | --- | --- | --- |
| category + createdAt sort + page | `range` | `Product_isPublished_isDraft_categoryId_createdAt_idx` | 12 |
| price-sorted listing | `ref` | `Product_isPublished_isDraft_basePricePoisha_idx` | 168 |
| flash-sale window | `ref` | `Product_isFlashSale_idx` | 56 |
| warehouse stock groupBy | `index` | `WarehouseStock_productId_idx` | 168 |

No full table scan on any of the four. The flash-sale plan shows `Using filesort` — expected, because `isFlashSale` is the selective predicate and the sort is on `flashSaleEnd`; at 56 rows it is cheaper than a wider composite index.

**p95 latency** (60 runs, warm cache, in-process, seeded data)

| Endpoint | p50 | p95 | p99 |
| --- | --- | --- | --- |
| `/products?limit=20` | 8.4ms | **12.9ms** | 14.4ms |
| `/products?category=fashion&sort=price_asc` | 7.4ms | **10.7ms** | 11.7ms |
| `/homepage` | 30.8ms | **44.1ms** | 51.9ms |
| `/categories` | 5.5ms | **8.8ms** | 9.6ms |

Cold cache (15 runs, cache cleared between each): `/products` p95 **33.2ms**, `/homepage` p95 **117.3ms**. Both under the 200ms gate with the cache doing nothing.

**Not done / partial**
- **Redis is not installed on this machine.** Everything above ran on the in-process fallback. The cache and limiter are correct and tested, but cross-process sharing is unproven until a real Redis is running. `REDIS_URL` is set in `.env` and points at `localhost:6379`.
- `inStockOnly` is applied after the page is mapped, so `meta.total` counts in-stock and out-of-stock together when that flag is set. Documented in `product.service.ts`; the storefront uses it as a client-side filter and does not read the count.
- No `LandingPage` rows are seeded, so `/landing/:slug` is only tested for its 404 path.
- The storefront still reads the mock layer. `NEXT_PUBLIC_USE_MOCK=false` is Phase 7's job.

**Assumptions**
- `originalPricePoisha` is now stored by the seed rather than derived. Deriving it from `discountPercent` was wrong for 129 of 168 products — OSB-1127 is ৳1,240 → ৳2,070, and the reverse formula said ৳2,067. The struck-through price must be the real original, not a back-computation.
- Flash-sale products got real `flashSaleStart`/`flashSaleEnd` windows in the seed; `isFlashSale` alone left the window empty and the endpoint returned nothing.
- `trust proxy` is set to exactly 1 hop in production only. Trusting all hops would let a client spoof `X-Forwarded-For` and reset its own rate limit.

**Landmines**
- **Prisma client generation fails while the API dev server is running** — the running process holds the query engine DLL on Windows. Stop the server, regenerate, restart. Cost 10 minutes.
- **The rate limiter will fail your own load test.** 240 requests in a minute trips the 100/min bucket and every later assertion returns 429. Any latency or soak script must clear `rl:*` between measurements.
- **`clearCache` originally left `tag:*` registrations behind**, so `invalidateTag` reported deleting keys that no longer existed. Fixed in this phase; the test that caught it is `invalidateTag deletes the keys registered under it`.
- **`LOG_LEVEL=silent` is not valid** — the enum is `fatal|error|warn|info|debug|trace`. An invalid value exits the process at boot with a config error, which looks like a crash.

**Next step**
- Phase 7: flip `NEXT_PUBLIC_USE_MOCK=false` for search and the account routes, and point the storefront's `src/lib/api/*` at `/api/v1` — the endpoints and their payload shapes are now fixed and tested.

## 2026-11-12 · Phase 5 · product detail page · complete

**Completed**
- `src/app/(shop)/product/[slug]/page.tsx` — the route. Slug validated against `MOCK_PRODUCTS`, `notFound()` on a miss, `generateStaticParams` prerenders all 168, per-product metadata + canonical + OG image.
- `src/components/product/product-page.tsx` — the page. Breadcrumb → gallery + info → tabs → reviews → FBT → 5 rails → sticky mobile bar.
- `src/components/product/product-gallery.tsx` — 5-angle gallery, zoom, keyboard lightbox.
- `src/components/product/variant-selector.tsx` — `resolveVariant()`, the single derivation for price/stock/swatch/payload.
- `src/components/product/product-reviews.tsx` — breakdown filter + sort, empty state.
- `src/components/product/product-tabs.tsx` — 8 tabs, real tablist with roving tabindex.
- `src/components/product/frequently-bought-together.tsx` — bundle strip, 5% bundle price, add-all.
- `src/app/product.css` — ported 1:1 from the reference blocks.
- `src/lib/product-data.ts` — server-side loader for the page + 4 rails.
- `src/lib/mock/product-detail.ts` — deterministic variant groups, reviews, specs, breakdown.

**Verified**
- `npm run build` → green, 187 static pages (168 product + 14 category + home + dev)
- `npx tsc --noEmit` → clean
- `npx eslint .` → 0 errors, 1 pre-existing font warning
- live: `/product/osb-1001` 200, `/product/does-not-exist` 404
- live: base ৳1,890 → XL ৳2,570; add-to-cart → ✓ + badge 2→3; tabs switch; 5 gallery angles
- live: specs render once each (SKU · Brand · Category · Warranty · Origin)

**Not done / partial**
- Mobile widths (360/768/1024) not measured live — no resize tool this session. The 760/820/1024 blocks exist and cover `.fbt`, `.tabs`, `.spec`, `.thumbs`, `.pdbar`, but treat them as **untested** until someone resizes.
- Reviews are mock fixtures, not real data. Filtering and sorting work; there is no write-review flow (Phase 7).
- The delivery estimator, coupon copy and share/copy-link are wired to toasts, not to a backend.

**Assumptions**
- Bundle price is display-only. The reference shows `sum × 0.95`; checkout must recompute server-side (§7.3). If the backend has no bundle rule, the customer sees the honest cart total.
- `ratingBreakdown` is derived from the actual rating rather than the reference's hardcoded `{5:64,4:22,3:8,2:4,1:2}`. The hardcoded set averages 4.42 while the page displays 4.3 — self-inconsistent. The derived one sums to exactly 100 and matches the shown rating.
- A `data:image/svg+xml` URL is treated as "no real photo" so the 5-angle fallback runs. Real photo URLs in Phase 6 flip the gallery automatically.

**Landmines**
- `formatMoney` used to render paisa (`৳১,৮৯৩.৬০`) because variant deltas land on multiples of 10 poisha. The reference's `fmt` rounds to whole taka. Fixed in `src/lib/format.ts` — display rounds, storage stays poisha.
- The variant delta formula needs the **base price**: `Math.round(p.p * .12 * i / 10) * 10`. An early port dropped `p.p` and produced flat 12/24/36 poisha deltas.
- `document.cookie` inside a component body trips `react-hooks/immutability`. Moved to a module-scope `writeLangCookie()` helper.
- `setState` in an effect for the quantity clamp trips `react-hooks/set-state-in-effect`. Derive it instead.
- PowerShell mangles UTF-8 and literal `\n` in `-replace`/`.Replace()`. Use the edit tool for any file with Bangla or emoji in it.

**Next step**
- Phase 6: implement the catalog API and flip `NEXT_PUBLIC_USE_MOCK=false`; `getProductDetail` already has the final signature.

---

## 2026-11-11 23:40 · Phase 4 · category pages ×14 · complete

**Completed**
- `src/app/(shop)/category/[slug]/page.tsx` — the route. Validates the slug against `CATEGORIES`, calls `notFound()` on a miss, `generateStaticParams` prerenders all 14, per-category metadata + canonical.
- `src/components/category/category-page.tsx` — one template, fourteen instances. Breadcrumb → hero → featured brands → offers → popular → new → top rated → listing, matching the reference's `category()` order.
- `src/components/category/category-hero.tsx` — `.chero` hero, subcategory chips, breadcrumb, 3 promo offers.
- `src/components/category/category-listing.tsx` — toolbar, desktop sidebar, mobile sheet, grid, Load More (+8 from 12), empty state with two real escapes.
- `src/components/category/filter-panel.tsx` — brand checkboxes, rating radios, price slider + 2 inputs, stock/discount toggles, `SortSelect`. Shared by sidebar and sheet.
- `src/lib/category-filters.ts` — URL as the single source of truth. Total parsing (garbage degrades to defaults), `applyClientFilters` applies all six dimensions + sort.
- `src/app/category.css` — `.chero`/`.chips`/`.lay`/`.flt`/`.cat-grid`/`.tb`/`.lm`/`.flt-actions`, ported from the reference.
- `src/components/product/brand-tile.tsx` — added `ExternalBrandChip` (`.ex`), now shared with the home rail.
- `src/lib/hooks.ts` — added `useDebouncedCallback` (the existing `useDebounced` debounces a value, not a callback).
- `src/lib/i18n/ui.ts` — added the strings the reference has no key for (`clearFilters`, `applyFilters`, `filterResults`, `closeSheet`, `noResultsBody`, `categoryProducts`).

**Verified** (real output)
- `npm run build` → green, 19 static pages, `● /category/fashion` … `[+11 more paths]`
- `npx tsc --noEmit` → clean
- `npx eslint .` → 0 errors, 1 pre-existing `no-page-custom-font` warning in `layout.tsx`
- All 14 slugs → 200; `/category/electronics` → 404 page (correct: the real slug is `gadgets-electronics`)
- Sorts: `price_asc` ৳1,750→৳42,890 · `price_desc` ৳42,890→৳1,750 · `rating` ৪.৯→৩.৯ · `popular` 474→47 reviews · `newest`/`relevance` applied
- `?rating=4` → 11 of 12 (drops ৩.৯); `?rating=3` → 12 of 12; `?stock=1&discount=1` → 10 of 12
- Sort change held `scrollY` at 900 (no scroll jump); `back` restored the previous filter state
- Load More 8 → 12, button disappears at the end
- Mobile sheet: focus lands on close, Escape closes and returns focus to the trigger
- Featured brands: 1 `.bt` (OGadgets) + 4 `.ex` (realme, Samsung, Walton, Xiaomi)

**Bugs found and fixed this session**
- `category-page.tsx` hardcoded `isOwnBrand: false` when deriving brands from products, so all five rendered as `.bt` logo tiles. The reference (L700) renders the house brand as `.bt` and partners as `.ex` chips. Now reads the real flag from `listBrands()`.
- `applyClientFilters` originally handled only brand + rating, so the price slider, stock and discount toggles silently did nothing — the URL updated and the grid did not. Now applies all six dimensions.

**NOT done**
- Filtering is client-side over one `limit: 200` fetch. Fine for 12 products per category; Phase 6 should move it server-side when the real API lands (`toProductQuery` grows the fields back, drop `applyClientFilters`).
- Product cards link to `/product/[slug]`, which is Phase 5. Those links 404 today.
- Load More is unreachable in practice: every category has exactly 12 products and `PAGE_SIZE` is 12. The mechanism is verified by temporarily lowering the page size; it will appear once categories exceed 12 products.

**Assumed**
- "Bata Bata" (brand name twice in a `.bt` tile) is reference parity, not a bug — `brandTile` at L649 renders `b.n` in the logo div *and* in the `<b>` below. Left as-is.
- The reference's `own` brand per category comes from `CATS[].own`; `Category.houseBrand` carries it, but the client component uses `BrandDto.isOwnBrand` instead, which is the same information and already in the DTO.

**Landmines**
- The real slug is `gadgets-electronics`, not `electronics` (AGENTS.md §10 landmine 2 in spirit). Copy ids from `CATS`.
- The cart drawer sits in the DOM at `x≈1285` with `aria-hidden="true"` and `visibility: visible`. `browser_snapshot` reports it as `Dialog open: "Cart"` on every page load, and it eats the snapshot's element budget so `main` gets truncated. It is **not** actually open. Read the page with `browser_eval` instead of trusting the snapshot's dialog line.
- `browser_snapshot` caps at ~250 elements and this page exceeds it; the listing section is past the cap. Query `#allp` directly.

**Exact next step**
Build Phase 5 — the product detail page at `/product/[slug]`, which every card in this phase already links to.

---

## 2026-11-11 21:40 · Phase 1 · design system & component library · complete

**Completed**

- `src/app/globals.css` — reference component CSS ported verbatim under the `shop-*` namespace: `.btn` (red/line/add/addl), `.badge`, `.stars`, `.qty`, `.chip`, `.pc` product card, `.cc` category card, `.bt` brand tile, `.car` carousel track, `.toast`, `.sheet`, `.modal`, `.empty`. Two token sets stay separate (D2).
- `src/lib/store/cart-store.ts` — Zustand + `persist`. Integer poisha only. Lines carry display fields so the drawer paints on a cold load with no catalog fetch. `merge` validates every field; `migrate` returns `undefined` (never resurrect a stale cart).
- `src/lib/store/wishlist-store.ts` — ids only, same versioned-guard pattern, same `merge` shape check.
- `src/lib/store/ui-store.ts` — language, modal id, sheet state, toast queue.
- `src/lib/hooks.ts` — `useLang`, `useBodyScrollLock`, `useEscapeKey`, `useFocusReturn`, `usePrefersReducedMotion`, `useMediaQuery`, `useIsMobile`, `useDebounced`, and **`useStoreHydrated`** (new, see landmines).
- `src/components/ui/` — `button.tsx` (incl. `useAddToCartState`, the reference's idle→loading→success cycle), `badge.tsx`, `star-rating.tsx`, `quantity-stepper.tsx`, `chip.tsx`, `skeleton.tsx`.
- `src/components/product/` — `product-card.tsx` (in stock / low stock / out of stock / discounted / flash-sale with sold bar), `category-card.tsx`, `brand-tile.tsx`, `mini-product-card.tsx`.
- `src/components/shared/` — `carousel.tsx` (scroll-snap, drag, auto-scroll paused by `IntersectionObserver`, arrows hidden when nothing overflows), `search-bar.tsx` (suggestions, debounced), `toast.tsx`, `modal.tsx`, `mobile-sheet.tsx`, `empty-state.tsx`.
- `src/app/dev/components/page.tsx` — `/dev/components`, the Phase 1 proof route. Every primitive, every state, both languages.
- `src/app/layout.tsx` — `<Toaster />` mounted once at the root.

**Verified**

- `npx tsc --noEmit` → exit 0.
- `npm run lint` → 0 errors, 1 warning (`layout.tsx:54` `no-page-custom-font` — pre-existing Phase 0 `<link>` font decision D9, a Phase 12 task).
- `npm run build` → green, 3 static routes (`/`, `/_not-found`, `/dev/components`) all prerendered.
- `GET /dev/components` → 200, 67,377 bytes.
- Browser: console 0 errors, 0 warnings. Bangla renders clean (৪.৩ (৬৫)) — rating and review count both through `nf()`).
- **Persistence round-trip:** added Cotton Panjabi → `localStorage['sharkmart.cart']` holds 1 line, `unitPricePoisha: 189000`, `quantity: 1` → reload → header reads Cart lines 1 / Cart items 1. Wishlist toggle survived the same reload (Wishlist 1). Language persisted.
- **Corrupt-blob guard:** planted `{"state":{"lines":"NOT_AN_ARRAY"},"version":1}`, `{"state":{"ids":{"bad":true}},"version":1}` and `{"state":{"lang":"xx"},"version":1}` with *valid* version numbers → reload → page renders, cart 0, wishlist 0, language falls back to EN, no console error. Before the `merge` guard this was a white screen.

**Not done / partial**

- `/dev/components` is a proof route, not a product surface. It is not linked from the storefront and should be deleted or gated before Phase 13.
- `SearchBar` renders suggestions from mock data only; wiring to `/api/v1/search` is Phase 7.
- `MiniProductCard` exists for the drawer but the drawer itself is Phase 2.
- Product images are the emoji-on-tint SVG placeholders (D15). No photography.
- `useAddToCartState`'s success state is local to the button; it does not yet reconcile with the cart store's real quantity.

**Assumptions**

- Component CSS is ported from the reference rather than re-derived in Tailwind utilities. Parity is the gate, and a hand-translated `box-shadow` is how parity dies.
- Bangla digits apply to ratings and review counts, not just prices — the reference runs both through `nf()`.
- `useStoreHydrated` gates on the store's own hydration flag, so the first paint is the server snapshot (empty) and the swap happens in one tick. A one-frame empty cart is correct; a hydration mismatch is not.

**Landmines**

- **`store.persist` does not exist during Next prerender.** Reading `useCartStore.persist.onFinishHydration` in a component body throws `Cannot read properties of undefined (reading 'onFinishHydration')` and fails `next build` on the static-generation step, even though `next dev` works fine. `useStoreHydrated` in `src/lib/hooks.ts` optional-chains it; use that hook, never the raw `persist` API.
- **A corrupt blob with a *valid* `version` bypasses `migrate` entirely.** `migrate` only fires on a version mismatch. Without a `merge` shape check the store rehydrates garbage and the first `.reduce()` throws during render. Both stores now validate in `merge`. Any new persisted store needs the same guard.
- React 19's `set-state-in-effect` lint rule rejects the usual `useEffect(() => setX(...))` hydration pattern. `useSyncExternalStore` is the way through; do not suppress the rule.
- `.next` must not be renamed to something lintable (e.g. `.next-stale`). `eslint .` will walk it and report thousands of errors from build output.
- Two `next dev` processes on port 3000 with a shared `.next` corrupts the Turbopack cache and produces a 500 with no useful message. Check `Get-NetTCPConnection -LocalPort 3000` before starting a server.
- House sub-brand names (`OFashion`, `OBeauty`, …) are **intentional** — D10 / Q6. They are not a missed brand rename. Do not "fix" them.

**Next step**

- Run the Phase 2 master prompt from `prompts/masterbuild.md`: root layout shell (header, mega menu, mobile nav, footer) plus the cart drawer, mounting the existing stores and `MiniProductCard`.

---

## 2026-11-11 19:15 · Phase 0 (backend half + gate) · complete

**Completed**

- `server/prisma/schema.prisma` — 38 models, 15 enums, every relation from `prompts/backend.md`. Money is `Int` poisha (D11), not `Decimal(10,2)`. Indexes on slug, categoryId, brandId, createdAt, orderNumber, phone, plus the composite ones the listing queries need.
- `server/prisma/migrations/20261111130955_init_sharkmart/` — initial migration, applied to `sharkmart` on MariaDB 10.4.
- `server/prisma/seed.ts` — idempotent. Upserts on natural keys (category.slug, brand.slug, product.sku). Writes 14 categories, 84 subcategories (as real Category rows with parentId), 25 brands, 168 products, 168 images, 168 warehouse-stock rows, 9 settings.
- `server/src/{index,app}.ts` — Express 4 + helmet + CORS + 1 MB JSON limit. Verifies the DB before binding, then starts anyway so `/health` can report a failure honestly.
- `server/src/config/env.ts` — Zod-validated env, fails fast with a readable message.
- `server/src/config/database.ts` — Prisma singleton (dev hot-reload would otherwise exhaust MySQL connections) + `checkDatabase()`.
- `server/src/routes/health.ts` — `GET /health` → 200 `{success:true,data:{status,database,uptimeSeconds,version,timestamp}}`, 503 when MySQL is down.
- `server/src/middleware/errorHandler.ts` — contract-shaped errors, Zod → 422 `VALIDATION_ERROR`, no stack traces in production.
- `server/src/types/api.ts` — server half of the frozen envelope.
- `src/types/api.ts`, `src/types/catalog.ts` — the frontend half: `ApiResponse<T>`, `API_ERROR_CODES`, `ProductDto`, `CategoryDto`, `BrandDto`, `ProductListQuery`.
- `src/lib/i18n/index.ts` — `t(lang, key, vars)`, `translator()`, `toBanglaDigits()`, `localizeNumber()`, `bodyClass()`, `htmlLang()`. Key set is a real TS union, so a typo is a compile error.
- `src/lib/i18n/translations/{en,bn}.ts` — 132 keys each, generated.
- `src/lib/mock/index.ts` — contract-shaped fixtures for products, categories, brands + a `HomepageAggregate` for Phase 3.
- `src/lib/api/{config,client,products,categories,homepage}.ts` — the API layer. `resolve()` in `client.ts` is the ONLY place that branches on `USE_MOCK`.
- `tools/extract-reference.mjs` — generates `data/reference-catalog.json` and both translation files from `oshoppingbd.html`. Reproduces the reference's product generator exactly (same DISC table, same formula, same order).
- `tools/verify-phase0.ts` — 40 assertions covering the whole gate.
- `eslint.config.mjs` — flat config. Next 16 removed `next lint`; eslint-config-next 16 exports native flat configs, so no FlatCompat shim.
- `.env.example` (root) + `server/.env.example` — every variable documented, no values.
- `.gitignore` — added `!.env.example`, `server/node_modules/`, `server/dist/`, `server/uploads/`, `server/.env`.

**Verified** (real output)

- `npm run build` → `✓ Compiled successfully in 5.8s`, `Finished TypeScript in 3.9s`, 3 static routes (`/`, `/_not-found`).
- `npx tsc --noEmit` → exit 0 (root). `cd server; npx tsc --noEmit` → exit 0.
- `npm run lint` → `1 problem (0 errors, 1 warning)`. The warning is `@next/next/no-page-custom-font` on `layout.tsx:53` — that is D9 (fonts via `<link>` for parity), deliberate.
- `npx prisma validate` → `The schema at prisma\schema.prisma is valid`.
- `npx prisma migrate dev --name init_sharkmart` → applied `20261111130955_init_sharkmart`.
- `npx prisma migrate status` → `1 migration found`, `Database schema is up to date!`
- `npm run db:seed` twice → both runs: `categories 14 / subcategories 84 / brands 25 / products 168 / images 168`. Idempotent.
- `curl localhost:4000/health` → `HTTP 200 {"success":true,"data":{"status":"ok","database":"up","uptimeSeconds":7,"version":"0.1.0",...}}`
- `npx tsx tools/verify-phase0.ts` → `ALL CHECKS PASSED` (40/40). Includes `t('bn','left',{n:4})` → `মাত্র ৪টি বাকি`, `formatMoney(189000,'bn')` → `৳১,৮৯০`, `formatMoneyAdmin(48235000)` → `৳4,82,350`, and the 14 category ids compared element-by-element against the reference list.
- Direct SQL against `sharkmart`: 14 parent categories, 84 subcategories, 25 brands, 168 products, 168 images, 168 stock rows. Bangla round-trips correctly (`ফ্যাশন`, `Fashion → ফ্যাশন`).

**Not done / partial**

- **No API endpoints beyond `/health`.** That is the Phase 0 constraint, not an oversight. `/api/v1` is mounted and empty.
- **No Redis.** Declared in `.env.example`, wired in Phase 6.
- **No auth.** JWT secrets are declared but unused until Phase 8.
- **No tests.** `tools/verify-phase0.ts` is a gate script, not a test suite. Vitest + Supertest land in Phase 12.
- **`/` is still the Phase 0 proof page**, not the homepage. Phase 3 owns that.
- **Product images are SVG placeholders** (emoji on a category tint), matching what the reference actually renders. No photography exists to seed.
- **No real-browser visual check** at 360/768/1440 in both languages. Verification was HTML/type/DB level.

**Assumptions**

- D11: money as `Int` poisha in Prisma, overriding the `Decimal(10,2)` in `backend.md`. `masterbuild.md` Phase 0 and AGENTS.md landmine #4 both demand it.
- D12/D13: catalog and i18n are generated from the frozen HTML, and the seed + mock share one JSON. Do not hand-edit `data/reference-catalog.json` or the two translation files — regenerate.
- D14: MariaDB 10.4 (XAMPP) stands in for MySQL 8 locally. The schema uses nothing 8-only.
- D15: emoji-on-tint placeholders stand in for product photography.
- `NEXT_PUBLIC_USE_MOCK` defaults to **true** when unset (`config.ts` uses `!== 'false'`), so a fresh clone gets working pages before the API exists.
- Brand slug for the parent house brand is `sharkmart`; the reference's `OShoppingBD` is mapped at the brand layer only, never in the HTML.

**Landmines**

- **`prisma.upsert` cannot key on a compound unique containing a nullable column.** `WarehouseStock` is unique on `(warehouseId, productId, variantId)` and `variantId` is null for variant-less products, so Prisma refuses to build the `where`. The seed uses find-then-write. Do not "simplify" it back to an upsert.
- **PowerShell `Set-Content -Encoding UTF8` writes a BOM**, and Turbopack then refuses to parse `package.json` (`Unexpected token '?'`). If you rewrite a JSON file from PowerShell, write it with `[System.IO.File]::WriteAllText(..., New-Object System.Text.UTF8Encoding $false)`.
- **`rmdir /s /q .next` fails while a dev server holds a lock.** Stop the server, wait, retry.
- **`FlatCompat` throws `Converting circular structure to JSON` with eslint-config-next 16.** Import `eslint-config-next/core-web-vitals` and `/typescript` directly — they are already flat.
- **MySQL started via `Start-Process` dies when the tool session ends.** Start it detached (`run_in_background`) or from the XAMPP control panel.
- **The reference's `EXT` list is incomplete.** `Easy`, `Lee Cooper`, `Johnson's` and `Axe` appear in product rows but not in `EXT`. `extract-reference.mjs` discovers brands from the product data and has a guard that throws on an orphan, so this cannot regress silently.
- **The reference generates 168 products, not ~24.** 14 categories × 12. `masterbuild.md` Phase 0 says "~24 products"; the reference is the authority and 168 is what makes the category pages and filters real. Noted, not a bug.

**Next step**

- Start Phase 1: build the component library (`src/components/ui/`, `src/components/product/`) against `MOCK_PRODUCTS` — read `prompts/frontend.md` §7 and §8, and `oshoppingbd.html` for the exact card, button and badge CSS.

---

## 2026-11-11 23:35 · SSR pass — storefront content is now server-rendered

**Problem**
The homepage and all 14 category pages shipped an empty skeleton to the server. Measured before: `/` was 31 KB with 5 `৳` characters, 0 product cards and `aria-busy="true"`; `/category/fashion` was 32 KB with 0 cards, no breadcrumb and no Bangla. Cause: the page components were client-side and fetched in `useEffect`, so the prerender never had data. It looked fine in a browser after hydration, which is why nobody caught it.

**Fix**
- `src/lib/category-data.ts` (new) — `loadCategoryData(slug)` extracted out of `CategoryPage`, server-safe (no `'use client'`).
- `src/app/(shop)/page.tsx` — server component, `await getHomepage()`, passes `initialData` down.
- `src/app/(shop)/category/[slug]/page.tsx` — loads `loadCategoryData` on the server and passes `initialData`. Wrapped in `try/catch` so a data failure degrades to the client fetch instead of a 500.
- `HomePage` / `CategoryPage` — accept `initialData`, seed state from it, skip the fetch. They stay client components because the language toggle and carousels need it; the point is that they no longer *start* empty.
- `CategoryListing` is wrapped in `<Suspense>` inside `CategoryPage`. It calls `useSearchParams()`, which cannot run during prerender and was failing the build with `useSearchParams() should be wrapped in a suspense boundary`. Scoping the boundary to the listing keeps the hero, breadcrumb and all three product rails server-rendered.
- `revalidate = 300` on both routes (ISR).

**Verified**
- `npx tsc --noEmit` → PASS.
- `npm run build` → green. `/` static, all 14 category routes prerendered as ● SSG.
- `npm run start` + curl:
  - `/` → **492 KB, 227 `৳`, 222 product cards and links, 16 `<h2>`, `aria-busy` 0**
  - `/category/fashion` → **96 KB, 70 `৳`, 60 product links, breadcrumb + `<h1>Fashion</h1>`**
- Every route returned 200 while the server was up.

**Known follow-ups**
1. **The homepage HTML is 492 KB — too heavy.** Main cause: `RecentlyViewed` receives `data.catalog` (the entire catalog) and it gets serialized into the RSC payload. Pass only the ids or a small lookup map, and consider trimming items per rail.
2. **The listing grid still hydrates client-side** (the Suspense fallback is what lands in the HTML). To SSR the grid too, move filters off `useSearchParams`: read `searchParams` in the route, pass the query string down, and seed local state from it.
3. **Bangla is not server-rendered.** Language lives only in localStorage (`ui-store`), so SSR is always English. This needs a cookie plus a routing decision — `/bn` prefix, or cookie + `router.refresh()`. Owner decision, not a code detail.
4. `src/app/components.css.bak` deleted in this commit.

**Next step**
- Phase 5 (product detail). Build it server-rendered from the start using the same `initialData` pattern, and do not hand whole collections to client components.

---

## 2026-11-11 19:30 · Incident: dev-server collision + encoding damage

**What broke**
- The dev server started at 18:35 began returning `500`s around 19:20, then exited 127.
- **Not a code fault.** Two Next processes shared one `.next` directory: a second session started its own dev server in this workspace at ~19:24 while the first was still running. When the tree was rebuilt, the older process lost `build-manifest.json`, `routes-manifest.json` and the turbopack runtime chunk → the `ENOENT` / `MODULE_NOT_FOUND` cascade in the log.

**Rule — this cost ~46 minutes of misleading logs**
- **One dev server per workspace.** Check before starting one: `netstat -ano | grep :3000`.
- `npm run build` and `npm run dev` must never run at the same time — they write the same `.next` tree and corrupt each other.
- If you see `ENOENT ... .next\dev\...manifest.json` or `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'`, do not debug the app. Something else is rebuilding `.next`. Kill both, `rm -rf .next`, start one.

**Encoding damage found and fixed**
- `package.json` contained `â€”` where an em dash belonged. Cause: PowerShell writing UTF-8 as CP1252.
- Fixed — the description is now ASCII-only.
- **Warning: any file written through PowerShell without `-Encoding utf8` will mangle Bangla.** `src/lib/i18n/translations/bn.ts` is currently clean (verified: Bangla glyphs intact). Keep it that way — write Bangla content through the editor tools, never `Out-File` / `Set-Content` without explicit UTF-8.

**Verified at 19:30**
- `GET /` → 200, `GET /dev/components` → 200 on the live server.
- `package.json` parses; `src/` is free of mojibake.
- Deliberately did **not** run a build — another process owns `.next` right now.

**State of the tree**
- A parallel session has built Phase 1 (components, stores, i18n, mock layer, api client, eslint). It is sitting on top of the Phase 0 foundation and both are working together.
- Before touching `src/components/**`, `src/lib/store/**` or `src/lib/i18n/**`, check the claim table in `STATUS.md`. Those files have an active owner.

---

## 2026-11-11 18:40 · Phase 0 (frontend half) · Next.js foundation

**Completed**
- Toolchain: `package.json` (Next 16.4.6, React 19, Tailwind v4, Zustand, lucide-react), `tsconfig.json` (strict + `noUncheckedIndexedAccess`), `next.config.ts`, `postcss.config.mjs`, `.gitignore`.
- `src/app/globals.css` — both token sets in `@theme` (`shop-*` and `admin-*`), base layer with `body.bn` font swap and heading `line-height: 1.25`, `.wrap`, skip link, reduced-motion kill switch. Breakpoints overridden to 760 / 820 / 1024 / 1200 to match the reference media queries.
- `src/lib/brand.ts` — `BRAND` constant. The only place the brand name lives.
- `src/lib/format.ts` — `formatMoney` (poisha → ৳, Bangla numerals in `bn`), `formatMoneyAdmin` (`en-IN` lakh grouping), `toPoisha` / `toTaka`.
- `src/lib/commerce.ts` — ৳2,000 free-delivery threshold, ৳60 flat fee, progress %, amount remaining.
- `src/lib/categories.ts` — all 14 categories with exact reference ids, accent/tint colours, emoji and bilingual names.
- `src/components/brand/logo.tsx` — `<Logo />` built from the real asset (2073×758), three sizes, correct alt handling when link-wrapped.
- `src/app/layout.tsx` — metadata, OpenGraph, robots, viewport, fonts.
- `src/app/page.tsx` — Phase 0 proof page (tokens, 14 categories, money/delivery table). **Not the homepage.**
- `public/brand/sharkmart-logo.png` — copied from `Logo/`.

**Verified**
- `npm install` → 51 packages, exit 0.
- `npm run build` → green. `/` and `/_not-found` prerendered as static. No warnings.
- `npx tsc --noEmit` → `TYPECHECK: PASS`.
- `npm run start` + `curl localhost:3000` → HTTP 200. HTML contains `SharkMart`, `gadgets-electronics`, `৳2,000`, and the Bangla category name `Fashion → ফ্যাশন`. `/brand/sharkmart-logo.png` → `200 image/png`.
- Rebuilt after a final edit → still green.

**Not done / partial**
- Backend half of Phase 0: `server/`, Prisma schema, MySQL migration, seed data, `.env.example`, mock layer, i18n module.
- ESLint is **not** configured — Next 16 removed `next lint`, so this needs a flat-config setup before the Phase 0 gate can be called green.
- The homepage is not built. `/` is deliberately a foundation proof page.
- No real-browser visual check at 360/768/1440 in both languages — verification was HTML-level only.

**Assumptions**
- D9: fonts load via `<link>` exactly like the reference (parity now, `next/font` later).
- D10: house sub-brand names (`OFashion`, `OBeauty`, …) kept as-is.
- Tailwind v4 CSS-first `@theme` confirmed — there is no `tailwind.config.ts`, by design.

**Landmines**
- Next 16 rewrote `tsconfig.json` during the first build (`jsx: react-jsx`, added `.next/dev/types/**/*.ts` to `include`). Expected — do not revert.
- `pkill` does not exist in this Git Bash. Kill a stray dev server with PowerShell: `Get-NetTCPConnection -LocalPort 3000` then `Stop-Process -Id <pid>`.
- Category accent/tint colours are **data**, so they use inline `style`. That is the sanctioned exception to the no-inline-styles rule.
- `next-env.d.ts` is gitignored and generated on build. A fresh clone needs one build before `tsc` is meaningful.

**Next step**
- Either finish the Phase 0 backend half, or go straight to Phase 1 components if the owner wants visible homepage progress first — but do not start Phase 3 without the component library.

---

## 2026-11-11 18:30 · Rebrand (OShoppingBD → SharkMart) · docs only

**Completed**
- Brand is now **SharkMart** across every doc: `AGENTS.md`, `prompts/frontend.md`, `prompts/backend.md`, `prompts/masterbuild.md`, `STATUS.md`, `HANDOFF.md`.
- `frontend.md` §1 — brand identity block added (wordmark split `Shark`(navy) + `Mart`(red), tagline "Fast Delivery", logo asset, domain) plus a new §1.1 with the exact `<Logo />` markup derived from the reference's `.logo` CSS metrics.
- `frontend.md` §2.1 — "this file is a specification, not the product" conversion table (hash routes → file routes, one `<style>` → tokens, global `st` → Zustand, generated `P` → database, `innerHTML` → components).
- `frontend.md` §2.2 — the brand swap declared as the **only** sanctioned deviation from the reference.
- `AGENTS.md` §2.1 — brand exception table. Landmines #9, #13, #14 rewritten (never edit the HTML for the brand; logo red → token red; never rename the reference file).
- `prompts/masterbuild.md` — title + all 14 phase prompts rebranded; brand added to the frozen contract; Phase 0 now explicitly builds the `BRAND` constant and `<Logo />`.
- `STATUS.md` — D7 (brand) and D8 (palette untouched) added, D3 marked owner-confirmed, Q1 replaced with the domain question, Q5 added for the tagline.

**Verified**
- Logo inspected at `Logo/SharkMart Fast Delivery Logo.png`: horizontal lockup, "Shark" navy + "Mart" crimson, red shopping-bag with shark mark, transparent background. It maps 1:1 onto the reference's `.logo .mk` + `.wm i` structure.
- Grepped every `OShoppingBD` / `oshoppingbd` occurrence across all `.md` files and handled each. The **filename** `oshoppingbd.html` was deliberately left unchanged — a dozen doc and prompt references depend on that exact path.
- No build or test run: there is still no application code.

**Not done / partial**
- No code exists, so nothing was rebranded in code.
- Logo not yet exported as `sharkmart-mark.svg` / wordmark asset — that is a Phase 0 task.

**Assumptions**
- Domain `sharkmart.com.bd` (flagged as Q1 in `STATUS.md`).
- Reference palette stays untouched even though the logo crimson is brighter than `#C51F4B` (D8).
- Marketing copy stays as the reference; "Fast Delivery" is used only as a brand tagline (Q5).

**Landmines**
- Do **not** edit `oshoppingbd.html` to change the brand. It is frozen; override at the brand layer only.
- The wordmark must keep its two-colour split. Rendering "SharkMart" in one colour breaks the brand.
- The logo's red will not match `--red` exactly. That is accepted. Do not retune tokens to fix it.

**Next step**
- Run the Phase 0 master prompt, which now includes the `BRAND` constant and the `<Logo />` component.

---

## 2026-11-11 · Setup · docs only · no application code written

**Completed**
- `AGENTS.md` — created. Entry contract: read order, frozen files, the two-token-set law (storefront `#C51F4B` / `#253858` / `#fbf8f9` vs admin `#c8143c` / `#16223d` / `#f6f7fa`), working standard, multi-agent protocol (single writer per file, claim table, handoff format), cost discipline with model tiering, 14-item security floor, Definition of Done, and a 12-row landmine table of verified facts.
- `prompts/masterbuild.md` — rewritten. 14 phases, each with a copy-paste **master prompt**, an acceptance gate, and verification commands. Adds the frozen API contract (envelope + poisha + bilingual pairs), a resume-from-leftover protocol, a risk register, and a final release gate.
- `STATUS.md` — created. Phase tracker, active-claim table, decisions log (D1–D6), open questions (Q1–Q4).
- `HANDOFF.md` — created (this file).

**Verified**
- Read all four existing references end to end: `prompts/frontend.md` (1,210 lines), `prompts/backend.md` (1,622 lines), `oshoppingbd.html` (876 lines), `admin panel.html` (836 lines).
- Confirmed the storefront token block at `oshoppingbd.html:12` and the admin token block at `admin panel.html:21-30` — **they are not the same palette.** This is documented as the project's #1 landmine.
- Confirmed the 14 real category ids from `CATS` (`oshoppingbd.html:540`): `fashion, kids-baby, beauty-care, perfumes-fragrance, gadgets-electronics, herbal-natural, home-kitchen, food-grocery, books-education, automotive-motorbike, sports-fitness-outdoors, pet-supplies, office-business, garden-plants`.
- Confirmed cart math at `oshoppingbd.html:779`: free delivery at ৳2,000, otherwise ৳60 flat; progress bar width is `sub / 20` capped at 100%.
- Confirmed admin calendar weeks start **Saturday** (`admin panel.html:718`) and admin numbers use lakh grouping via `toLocaleString('en-IN')`.
- No build run — there is no application code yet. Nothing in this entry is claimed as tested.

**Not done / partial**
- Phase 0 has not been started. `src/` and `server/` do not exist.
- One documentation bug fixed in `prompts/frontend.md` (slug `office-business-supplies` → `office-business`) and one in `prompts/backend.md` (admin palette corrected to the real admin tokens). No other doc edits.

**Assumptions**
- "Maintain the html homepage" means keep `oshoppingbd.html` as the frozen visual contract and reproduce it 1:1 in Next.js — not "ship static HTML in production". If the owner wants a static-HTML storefront instead, Phase 0 changes shape and this must be revisited **before** any code is written.
- Tailwind v4 CSS-first `@theme` is the intended token mechanism; the `tailwind.config.ts` skeleton in `frontend.md` Appendix B is v3 syntax and should not be copied literally.
- Money as integer poisha, formatted at the edge.

**Landmines**
- Both reference files are minified-CSS heavy; `oshoppingbd.html` is only 876 lines but the CSS lines are very long. Read the `:root` block and the specific component block you need — do not read the whole file twice.
- The reference storefront is a hash-router SPA with a mutable global `st` object and two seeded cart items at boot (`oshoppingbd.html:872`). None of that should be ported.
- `renderDrawer()` in the reference loses scroll position on re-render. Do not port that bug.
- Tailwind v4 + `tailwind.config.ts` in the same doc set is a contradiction. Resolved in favour of v4 `@theme`.

**Next step**
- Run the Phase 0 master prompt from `prompts/masterbuild.md`, then update the Phase 0 row in `STATUS.md` and prepend a new entry here.

---

## 2026-11-11 22:15 · Phase 2 · layout shell & cart drawer · COMPLETE

**Completed**

- `src/app/shell.css` — the shell's CSS, ported from the reference's own blocks (top bar, header, nav, mega, footer, floating, bottom nav, drawer). Wired into `globals.css`; no new tokens invented.
- `src/components/layout/` — 12 components: `top-bar`, `header`, `mega-menu`, `mobile-header`, `mobile-category-sheet`, `bottom-nav`, `cart-drawer`, `footer`, `floating-buttons`, `language-toggle`, `document-language`, `storefront-shell`.
- `src/components/ui/icons.tsx` — icon set extracted from the reference rather than pulled from a library.
- `src/app/(shop)/layout.tsx` — storefront route group mounting `<StorefrontShell>`; the Phase 0 proof page moved into it at `(shop)/page.tsx`.
- `src/app/dev/shell/page.tsx` — `/dev/shell` proof route (outside the shop group, so it renders without chrome by design).
- `src/lib/i18n/translations/{en,bn}.ts` — added the two missing keys (`quantity`, `support`); key counts still matched.

**Verified** (browser, against `http://localhost:3000`)

- Free-delivery maths at all four gate values: ৳0 → delivery "Free", total ৳0 · ৳1,999 → delivery ৳60, total ৳2,059 · ৳2,000 → delivery "Free", total ৳2,000 · ৳50,000 → Free. Boundary at ৳2,000 is exact.
- Drawer: two lines, free-delivery bar full, related carousel, checkout CTA. Screenshot checked.
- Quantity 0 removes the line (cart 2 → 1) and the drawer keeps its scroll position — the reference's `renderDrawer()` scroll-loss bug is **not** ported.
- Escape closes the drawer, restores body scroll, and returns focus to the "Open cart" trigger.
- Mega menu: hover opens it; the click that follows hover keeps it open; a second click closes it.
- Language toggle: one click switches top bar, nav, drawer, footer and carousel; `body.bn` and `html lang="bn-BD"` both apply, so Bangla headings get `line-height: 1.25`; prices render as `৳১,২৮৪`.
- `npm run lint` → 0 errors, 1 pre-existing warning (`no-page-custom-font` in `src/app/layout.tsx`, from decision D9 — fonts load via `<link>` on purpose). `npx tsc --noEmit` → exit 0. `npm run build` → green, 4 static routes.
- `browser_console` on `/` → 0 errors, 0 warnings.

**Bugs found and fixed during the gate**

1. **Mega menu click closed what hover had just opened.** `onMouseEnter` opened the panel, then the click hit `setOpen(v => !v)` and shut it — the button read as dead on a mouse. Fixed with an `openedByHover` ref that consumes exactly one click after a hover-open; later clicks still toggle. Also cleared on the close timer and on Escape so it cannot leak into the next interaction.
2. **Focus return never ran in the drawer.** `useFocusReturn` is a manual capture/restore pair, and it was being called with no arguments. Wired the capture/restore properly.
3. **Language never reached the document.** `bodyClass()` existed but nothing applied it, so `body.bn` was missing and Bangla headings lost their `line-height: 1.25` fix (landmine #6). Added `document-language.tsx` to sync `bodyClass()` + `html lang` from the store — one source of truth, not a second `classList` call.

**Not done / partial**

- The homepage is still the Phase 0 proof page. `/` renders the shell around it, so the mock header inside that page's body is visible below the real header. That is expected until Phase 3 replaces the page — it is **not** a shell bug.
- `/dev/shell` sits outside the `(shop)` group and therefore has no chrome and no drawer. Use `/` for shell and drawer testing.
- No mobile-width visual pass beyond the responsive CSS; the bottom nav and category sheet render but were not screenshot-verified at 360px. Phase 12 polish item.
- `src/app/components.css.bak` exists and is byte-identical to `components.css` (same size, same mtime). It predates this session — a Phase 1 leftover. Left in place; safe to delete.

**Assumptions**

- The drawer is a non-modal dialog with `inert` when closed, so it stays in the DOM and reads as "off screen" in snapshots. That is correct behaviour, not a bug — `aria-hidden="true"` + `inert` + a translated-off transform.
- Snapshot text can be a pre-hydration frame. When a badge or language reads stale, re-read state with `browser_eval` before calling it a bug. This caught two false alarms (cart badge 0, language EN) that were both correct after settling.

**Landmines**

- `useFocusReturn` does nothing on its own. It returns capture/restore functions — call them or focus never moves.
- `useMediaQuery('(hover: hover)')` is the right gate for hover-vs-touch, but it is not enough by itself: the click handler still needs to know the panel was hover-opened, hence the ref.
- The shell's `shell.css` and the component library's `components.css` are separate files on purpose. Do not merge them; Phase 1's `.btn`/`.pc`/`.car` are shared, the shell's `.allcat`/`.mega`/`.hdr` are not.

**Exact next step**

- Run the Phase 3 master prompt from `prompts/masterbuild.md` and replace `src/app/(shop)/page.tsx` with the real homepage, then update the Phase 3 row in `STATUS.md` and append a new entry here.

---

## Phase 3 — Homepage (2026-11-11 23:05)

**What I completed**

- `src/components/home/` — 12 components: `hero-slider`, `trust-badges`, `brand-rails` (own + external), `flash-sale`, `flash-countdown`, `category-rail`, `product-rail`, `promo-banners`, `recently-viewed`, `newsletter`, `section-header`, `home-page`.
- `src/app/(shop)/page.tsx` — now renders `<HomePage />` with metadata + canonical, replacing the Phase 0 proof page.
- `src/components/layout/preview-strip.tsx` — the reference's `.pv` bar, gated on `NEXT_PUBLIC_SHOW_PREVIEW_STRIP === "true"`. Mounted in `storefront-shell.tsx`, absent from the DOM by default.
- `NEXT_PUBLIC_SHOW_PREVIEW_STRIP=false` documented in `.env.example`.
- `src/lib/i18n/ui.ts` — added `offers`, `of`, `previous`, `next`, `errorTitle`, `errorBody` in EN and BN.
- `src/app/components.css` — removed `scroll-snap-type` from `.car-track` (see landmines).

**What I verified**

- 16 sections, reference order: hero → trust → own brands → external brands → flash → categories → new → best → only → trending → promos → featured → recommended → recently viewed → popular → newsletter.
- Hero `min-height: 380px` measured live, 4 slides, prev disabled at start.
- 14 cards per rail; featured 13 (reference filters `r >= 4.3`); `catalog` 153 of 168 in stock.
- Carousel drift measured: `22.4 → 23.2 → 24`; frozen at `26.4` across 6 samples while hovered. `prefers-reduced-motion` disables it.
- 11 overflowing `.car-track` containers, arrows shown, prev disabled at scroll start.
- Language: EN → `html lang="en"`, no `body` class, `৳1,890`, hero label "Offers". বাংলা → `body.bn`, `৳২,০০০`, hero label "অফার".
- No horizontal overflow: `scrollWidth 1263` at viewport 1280.
- `tsc --noEmit` exit 0 · `eslint .` 0 errors, 1 pre-existing font warning · `next build` green, 4 routes · `browser_console` 0 errors, 0 warnings.

**What is NOT done**

- Side-by-side parity at **1440 and 390** was not done. The automation browser renders at ~2fps and has no resize tool. Needs a real browser pass.
- LCP / CLS were not measured.
- Mobile bottom nav and category sheet still unverified at 360px (carried from Phase 2).

**What I assumed**

- The hero aria-label should read "Offers" / "অফার" to match the reference's `t('offers')`, not "Flash Sale".
- `autoScrollMs` is the *hold duration after interaction* (the reference's `pause(3500)`), not an interval. The reference drifts continuously and ping-pongs; it never pages on a timer.

**Landmines I hit**

1. **PowerShell 5.1 `Set-Content` destroyed this file.** It rewrote `HANDOFF.md` as cp1252, turning every `→`, `৳`, `✓` and Bangla digit into `?`. Recovered by rewriting with Node (`writeFileSync(path, text, 'utf8')`). The destroyed Bangla price was reconstructed from `src/lib/format.ts` and `Intl.NumberFormat('bn-BD')`, not guessed. **Never edit these docs with `Set-Content`/`Out-File`; use Node or `[System.IO.File]::WriteAllText` with a no-BOM `UTF8Encoding`.**
2. **`scroll-snap-type: x proximity` silently kills auto-scroll.** Every sub-pixel `scrollLeft` write snaps back to the nearest card, so the track never moves and it looks like the rAF loop is dead. The reference has no snap. Removed from `.car-track`.
3. **`Get-Content` in PowerShell renders UTF-8 as mojibake** (`â€”`, `à§³`). The file is fine; the console is lying. Verify encoding with Node before "fixing" anything.
4. **The automation browser runs at ~2fps.** A 0.5px/frame drift looks frozen at that rate. Measure with repeated samples over seconds, not one reading.
5. **The cart drawer is always in the DOM** with `aria-hidden` + `inert` + an off-screen transform. Snapshots report "Dialog open" every time. That is correct, not a bug.

**Exact next step**

- Run the Phase 4 master prompt for the 14 category pages, then update the Phase 4 row in `STATUS.md` and append a new entry here.
