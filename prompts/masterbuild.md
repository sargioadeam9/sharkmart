# SharkMart — Master Build Plan (Phase-wise Master Prompts)

> **What this file is:** the build order, the acceptance gate for every phase, and a copy-paste **master prompt** for each phase. Any agent — any model, any tool — can open this file, find the first unfinished phase, paste that phase's prompt, and deliver shippable work without asking a single question.
>
> **What this file is not:** a design spec. Design lives in `oshoppingbd.html` and `admin panel.html`. Build law lives in `prompts/frontend.md` and `prompts/backend.md`. Rules of engagement live in `AGENTS.md`.

---

## How to use this file

```
1. Open STATUS.md          → find the first phase that is not ✅
2. Open that phase below   → read Goal + Gate
3. Copy the MASTER PROMPT  → paste it as your first message
4. Build, verify, then      → update STATUS.md + write HANDOFF.md
```

**One phase per session.** Finish it or leave it clearly marked 🟡 with the exact remaining work written down. A half-built phase with no note is worse than an untouched one.

**Never start a phase whose prerequisites are 🟡.** The dependency graph is not decorative.

---

## Phase map

| # | Phase | Track | Cost tier | Prereq |
| --- | --- | --- | --- | --- |
| 0 | Foundation, contracts, mock layer | Both | Deep | — |
| 1 | Design system & component library | Frontend | Standard | 0 |
| 2 | Layout, header, navigation, cart drawer | Frontend | Standard | 1 |
| 3 | Homepage (pixel parity) | Frontend | Standard | 2 |
| 4 | Category pages ×14 | Frontend | Fast | 3 |
| 5 | Product detail page | Frontend | Standard | 3 |
| 6 | API — catalog, search, homepage aggregate | Backend | Deep | 0 |
| 7 | Search, wishlist, account (real API) | Frontend | Standard | 5, 6 |
| 8 | Auth, cart, orders API + checkout flow | Both | Deep | 6 |
| 9 | Admin panel — core modules | Admin | Deep | 8 |
| 10 | Admin panel — business modules | Admin | Standard | 9 |
| 11 | SEO, analytics, tracking | Frontend | Standard | 5, 7 |
| 12 | Testing, performance, polish | Both | Deep | 3–11 |
| 13 | Deployment & handover | Both | Deep | 12 |

### Dependency graph

```
0 ──┬─ 1 ── 2 ── 3 ──┬─ 4
    │               └─ 5 ──┬─ 7 ──┐
    └─ 6 ───────────────────┘     ├─ 11 ─┐
         └─ 8 ── 9 ── 10 ─────────┘      ├─ 12 ── 13
                                          ┘
```

**Parallel-safe:** `1→5` (frontend) can run alongside `6` (backend catalog). `9` and `11` are independent once their prereqs land.

---

## The contract that makes phases independent

Phase 0 freezes the API contract. Every later phase builds against it — including phases built before the endpoint exists, using the mock layer.

```
API envelope (success)
{ "success": true, "data": {...}, "meta": { "page": 1, "limit": 20, "total": 100 } }

API envelope (error)
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

Rules that keep phases decoupled:

- **Frontend never invents a fetch shape.** If the endpoint is missing, add it to the mock layer *in the contract's shape*.
- **Backend never changes a response shape** an earlier phase already consumes. Add fields, never rename or remove.
- **Money is integer poisha** over the wire (`pricePoisha: 189000`), formatted at the edge. Never floats.
- **Bilingual fields are pairs** — `nameEn` / `nameBn`. No single-language user-facing field, ever.
- **Brand is one constant.** `BRAND.name = 'SharkMart'`, `BRAND.tagline = 'Fast Delivery'`, `BRAND.domain = 'sharkmart.com.bd'`. The frozen references say `OShoppingBD` — that is the old brand and is overridden at this layer only. No component ever types the brand name inline.

---

## Resume from leftovers

When you open this repo and a phase is 🟡, do this — in this order, no shortcuts:

```bash
git log --oneline -15          # what actually changed
cat HANDOFF.md                 # what the last agent learned
cat STATUS.md                  # the claim table + remaining work
npm run build                  # is the tree green right now?
```

Then answer four questions **before writing code**:

1. What does the phase gate require that does not exist yet?
2. Which of those pieces is half-built, and in which file?
3. What did the last agent assume that I should not inherit blindly?
4. What is the smallest next step that moves the gate forward?

If the tree is red, fixing it **is** your first task — and note in `HANDOFF.md` who broke it and how you found it.

---

# PHASE 0 — Foundation, contracts, mock layer

**Goal:** a green, runnable skeleton where every later phase has somewhere to land: two apps, one database, one frozen contract, one mock layer, one design-token bridge.
**Cost tier:** Deep (frontier model). This phase sets the shape of everything after it.

### Master prompt

```text
You are starting Phase 0 of SharkMart, a bilingual (Bangla + English) eCommerce
platform for Bangladesh. Nothing is built yet.

READ FIRST, IN THIS ORDER:
1. AGENTS.md (rules, frozen files, two-token-set law, landmines)
2. prompts/frontend.md (storefront stack + structure)
3. prompts/backend.md (API stack, Prisma schema, security checklist)
4. oshoppingbd.html line 12 only (storefront :root tokens)
5. admin panel.html lines 21-30 and 257 only (admin :root + dark tokens)

BUILD, IN THIS ORDER:
1. Next.js (App Router, TS strict, Tailwind) in /src, API server in /server.
2. Tailwind token bridge: storefront tokens (brand.red #C51F4B, ink.navy #253858,
   page #fbf8f9, line #eee5e8, muted #667590, ok #1f8a5b, radius 14px, shadows
   --sh/--sh2) AND admin tokens (admin.brand #c8143c, admin.ink #16223d,
   admin.bg #f6f7fa, radius 20/14/10) as TWO namespaces. Tailwind v4 uses
   @theme in globals.css; do not create a v3 tailwind.config.ts.
3. Fonts via next/font: Plus Jakarta Sans + Hind Siliguri, display:swap.
   body.bn swaps the stack and sets heading line-height 1.25.
4. Prisma schema: every model from prompts/backend.md, plus indexes on slug,
   categoryId, brandId, createdAt, orderNumber, phone. Money as Int (poisha).
   Run one initial migration against local MySQL.
5. Seed: 14 categories (ids exactly as CATS in oshoppingbd.html line 540),
   9 own brands, 12 external brands, ~24 products with bilingual fields.
6. Shared types in /src/types mirroring the contract in masterbuild.md.
7. Mock layer: fixtures shaped exactly like the contract, behind one switch
   (USE_MOCK=true). Later phases flip this off with no component changes.
8. i18n: T{en,bn} structure ported from oshoppingbd.html, t() with {n}
   interpolation, locale-aware number formatting, ৳ currency helper.
9. Brand layer: one BRAND constant (name 'SharkMart', tagline 'Fast Delivery',
   domain sharkmart.com.bd) plus a <Logo /> component built from
   Logo/SharkMart Fast Delivery Logo.png. The frozen reference says OShoppingBD
   - override it here, never inside the HTML. Export a mark-only SVG for the
   header tile and keep the reference's 40px/12px metrics.
10. .env.example for both apps, every variable documented, no values.
11. STATUS.md and HANDOFF.md already exist - update them, do not rewrite.

CONSTRAINTS:
- Do not build pages, components, or endpoints beyond a /health check.
- Do not add a UI library. Do not add a dependency without writing why.
- Two token namespaces must not leak into each other.

VERIFY (paste real output into HANDOFF.md):
npm run lint && npx tsc --noEmit && npm run build
npx prisma validate && npx prisma migrate status
curl localhost:PORT/health  -> 200 {"success":true}

THEN: update the Phase 0 row in STATUS.md, append to HANDOFF.md (what you built,
what you verified, what you assumed, exact next step for Phase 1).
```

### Gate

- [ ] Both apps boot; `npm run build` green; `tsc --noEmit` clean
- [ ] Both token sets present, named, non-overlapping; zero hardcoded hex in components
- [ ] Prisma schema migrated; seed runs idempotently (safe to run twice)
- [ ] 14 category ids match the reference **exactly** (`office-business`, not `office-business-supplies`)
- [ ] Mock layer returns contract-shaped data for products, categories, brands
- [ ] `T{en,bn}` present; `t()` and `formatMoney()` work in both locales
- [ ] `.env.example` complete; no secret in git

---

# PHASE 1 — Design system & component library

**Goal:** every primitive the storefront pages need, built once, in all four states, matching the reference exactly.
**Cost tier:** Standard.

### Master prompt

```text
You are starting Phase 1 of SharkMart: the storefront component library.
Phase 0 is complete (tokens, fonts, types, mock layer, i18n).

READ FIRST:
1. AGENTS.md sections 3, 4, 8 (tokens, working standard, Definition of Done)
2. prompts/frontend.md sections 7 and 8 (component library, button rules)
3. oshoppingbd.html: the CSS for .pc, .cc, .bt, .car, .sug, .toast, .mo,
   .btn, .btn-add, .stars, .qty, .chip — read those blocks only, not the whole file

BUILD (each with a typed props interface and loading/empty/error/success states
where applicable):
Button (primary .btn.red, outline .btn.line, add-to-cart .btn-add, all states
incl. loading spinner + success check), ProductCard (.pc: image area, discount
badge, wishlist heart, brand, 2-line clamped name, stars, price + strikethrough
+ % badge, stock line, add button), CategoryCard (.cc with accent border),
BrandTile (.bt), Carousel (scroll-snap track, arrows, drag, auto-scroll with
IntersectionObserver pause, hides arrows when nothing overflows, honours
prefers-reduced-motion), SearchBar + suggestions dropdown, Toast, Modal,
MobileSheet, Badge, StarRating (gradient fill, aria-label "4.5 / 5"), Quantity
Stepper (with .bump animation), Chip, EmptyState, Skeletons for card/tile/row.

ALSO: Zustand stores - cart, wishlist, ui (drawer/sheet/modal/language).
Persist cart + wishlist to localStorage with a version key and a migration guard.

CONSTRAINTS:
- Copy visual values from the reference. Do not "round" spacing or pick a
  nearby Tailwind default.
- No hardcoded strings: every label goes through t().
- No hardcoded colors: tokens only.
- Server Components by default; 'use client' only where an event or browser API
  is genuinely required.
- Do not build page-level sections here (no hero, no footer). Phase 2/3.

VERIFY:
npm run lint && npx tsc --noEmit && npm run build
Build /dev/components route rendering every component in every state, at
360/768/1024/1440, in EN and BN. Screenshot or describe parity vs reference.

THEN: update STATUS.md, append to HANDOFF.md with any component you deferred
and why.
```

### Gate

- [ ] Every listed component exists, typed, no `any`
- [ ] All four states demonstrated on `/dev/components`
- [ ] Keyboard + focus-visible + ARIA on every interactive element
- [ ] Bangla does not overflow any card, button, or heading
- [ ] Cart/wishlist survive refresh; version key prevents corrupt-state crashes

---

# PHASE 2 — Layout, header, navigation, cart drawer

**Goal:** the shell every page sits inside — and the cart drawer, which is the highest-risk interactive surface on the storefront.
**Cost tier:** Standard.

### Master prompt

```text
You are starting Phase 2 of SharkMart: the storefront shell.
Phases 0-1 are complete (tokens, components, stores).

READ FIRST:
1. AGENTS.md landmines #3 (free delivery: ৳2,000 / ৳60 flat)
2. prompts/frontend.md sections 6.4, 9, 10 (cart drawer, mobile nav, cart behaviour)
3. oshoppingbd.html: .topbar, .hd, .hd-nav, .mega, .mhd, .bnav, .msheet,
   #drawer, .fl, footer markup, and the renderDrawer()/totals() functions

BUILD:
TopBar (navy, phone, free-delivery line, language pill, Track/Help/Return).
Sticky Header (logo, search with autocomplete, wishlist count, cart count,
account) + NavBar (red "All Categories" pill, 7 links, More dropdown) +
MegaMenu (left category list with accent icon tiles, right subcategory grid +
accent promo panel, hover-intent on desktop, click on mobile).
MobileHeader (compact logo, lang pill, icons, full-width search) and
BottomNav (5 items, active state, safe-area padding).
MobileCategorySheet (3-column accent grid).
CartDrawer: 440px desktop / 100vw mobile, blurred overlay, free-delivery
progress (sub/2000, capped 100%), line items with variant + qty stepper with
.bump, remove, "You may also like" mini carousel, subtotal/discount/delivery/
total, checkout CTA, empty state.
Footer (5 columns, payment chips, copyright) with bottom padding 70px on mobile.
FloatingButtons (cart + support popup: WhatsApp/Messenger/AI assistant).
LanguageToggle that swaps all copy live without reload and persists.

CONSTRAINTS:
- Drawer must not auto-open on add-to-cart; a toast confirms instead.
- Preserve drawer scroll position across re-renders (this is a real bug in the
  reference implementation - do not port it).
- Escape closes any overlay; focus returns to the trigger.
- Body scroll locks while an overlay is open.

VERIFY:
npm run lint && npx tsc --noEmit && npm run build
Manual: open drawer, change qty to 0 (item disappears), cross ৳2,000 (bar turns
full + copy changes), refresh (cart persists), Esc (closes, focus restored).

THEN: update STATUS.md, append to HANDOFF.md.
```

### Gate

- [ ] Header sticky through scroll; mega menu keyboard reachable
- [ ] Drawer math correct at ৳0 / ৳1,999 / ৳2,000 / ৳50,000
- [ ] Cart count animates on change; persists across reload
- [ ] Bottom nav never overlaps footer content or the sticky PDP action bar
- [ ] Language toggle updates header, nav, drawer, and footer in one click

---

# PHASE 3 — Homepage (pixel parity)

**Goal:** the page the owner already designed. Indistinguishable from `oshoppingbd.html` at 1440 and 390, in both languages.
**Cost tier:** Standard.

### Master prompt

```text
You are starting Phase 3 of SharkMart: the homepage.
Phases 0-2 are complete (tokens, components, shell).

READ FIRST:
1. AGENTS.md section 2 (frozen references) and section 8 (Definition of Done)
2. prompts/frontend.md section 6.1 (the 20 sections, in order)
3. oshoppingbd.html home() (line ~654) and the CSS for .hero, .h-sl, .trust,
   .flash, .cd, .cc, .pb, .nlw, .sh

BUILD, top to bottom, in this exact order:
1 PreviewStrip (dev-only, removable via env flag)
2 HeroSlider: 4 slides, gradient backgrounds, tag pill, headline with line
  break, description, CTA, decorative emoji art, dots, arrows, auto-advance
  5.5s, pause on hover, swipe >40px on touch, no autoplay under reduced-motion
3 TrustBadges (4 items)
4 Our Brands carousel (9 own brands, accent logo tile + tagline)
5 Shop by Brand carousel (12 external)
6 FlashSale: red gradient panel, live countdown d/h/m/s, product carousel with
  sold progress bars
7 All Categories carousel (14 cards, accent border, item count)
8 New Arrivals, Best Sellers, Only for You, Trending, Featured, Recommended
9 PromoBanners (3 accent cards)
10 Recently Viewed (from store, empty state when none)
11 Newsletter (navy panel, email + subscribe, inline validation)
Section headers use .sh (red bar, title, optional subtitle, View all link).

DATA: read from the mock layer / homepage aggregate endpoint. Never inline
product arrays in a component.

CONSTRAINTS:
- Server Components for every section; client only for slider, carousels,
  countdown, newsletter.
- Above-the-fold hero images priority; everything below lazy.
- No layout shift: reserve hero and card heights.

VERIFY:
npm run lint && npx tsc --noEmit && npm run build
Side-by-side at 1440 and 390 in EN and BN. Check: hero height, card gaps (16px
rhythm), section margins, countdown ticking, carousels auto-scrolling and
pausing, dots syncing.

THEN: update STATUS.md, append to HANDOFF.md with a list of any visual deltas
you could not close and why.
```

### Gate

- [ ] All sections present, correct order, correct accent colors per category
- [ ] Side-by-side parity at 1440 and 390, EN and BN
- [ ] Countdown is real-time and does not drift or re-render the page
- [ ] Carousels: auto-scroll, pause on hover/focus, arrows hidden when no overflow
- [ ] LCP < 2.5s locally; no CLS from images
- [ ] Zero inline product data

---

# PHASE 4 — Category pages ×14

**Goal:** one template, fourteen faithful instances. This is a volume phase — build it once, correctly, then instantiate.
**Cost tier:** Fast (once the template is proven).

### Master prompt

```text
You are starting Phase 4 of SharkMart: the 14 category landing pages.
Phase 3 is complete (homepage).

READ FIRST:
1. prompts/frontend.md section 6.2
2. oshoppingbd.html category() and listing() (lines ~682-705), plus .chero,
   .chips, .flt, .grid, .lm, .nores, .offers CSS

BUILD one reusable template, then instantiate:
Breadcrumb · CategoryHero (accent gradient, icon tile, title, description,
subcategory chips) · PromotionalOffers (3 accent cards) · FeaturedBrands row ·
three product carousels (popular / new / top rated) · Listing block:
desktop sticky filter sidebar (price range, brand checkboxes, rating radios,
in-stock, on-discount) and mobile bottom-sheet filters, sort select
(relevance/newest/popularity/price↑/price↓/rating), product grid (4/3/2 cols),
"Showing X of Y", Load More (+8 per click), and a real empty state.

DATA: one route /category/[slug] driven by the category record. Unknown slug
must render the 404 state, not crash.

CONSTRAINTS:
- Filters and sort live in the URL (?brand=&min=&max=&rating=&sort=) so links
  are shareable and back/forward works. Debounce input 250ms.
- Filtering must not reset scroll or refetch the whole page.
- Never duplicate the template into 14 files.

VERIFY:
npm run lint && npx tsc --noEmit && npm run build
All 14 slugs render with the right accent, icon and subcategories:
fashion, kids-baby, beauty-care, perfumes-fragrance, gadgets-electronics,
herbal-natural, home-kitchen, food-grocery, books-education,
automotive-motorbike, sports-fitness-outdoors, pet-supplies, office-business,
garden-plants
Test: filter to zero results, then clear; sort each way; Load More twice.

THEN: update STATUS.md, append to HANDOFF.md.
```

### Gate

- [ ] 14/14 slugs correct and styled per category
- [ ] Filters + sort compose correctly and survive refresh via URL
- [ ] Empty state has an action, not just a message
- [ ] Mobile filter sheet traps focus and closes on Escape
- [ ] One template file, not fourteen copies

---

# PHASE 5 — Product detail page

**Goal:** the highest-intent page on the site. Variants, gallery, reviews, cross-sell — all wired to real state.
**Cost tier:** Standard.

### Master prompt

```text
You are starting Phase 5 of SharkMart: the product detail page.
Phase 3 is complete (homepage, shell, components).

READ FIRST:
1. prompts/frontend.md section 6.3
2. oshoppingbd.html product() (lines ~720-771), VARS(), pCur(), pUpd(), drawGal(),
   pRev(), plus .pp, .gal, .thumbs, .gm, .pi, .price, .acts, .tabs, .spec, .rv,
   .fbt CSS

BUILD /product/[slug]:
Breadcrumb · gallery (5 thumbnails, main image with zoom in/out + fullscreen
lightbox with keyboard arrows) · video block (click to play, never autoplay) ·
info block (brand, title, rating + count, SKU, price with strikethrough and
discount badge, stock state) · variant selector (size/color/weight/model by
category; color as swatches; out-of-stock options disabled) · quantity stepper
· Add to Cart + Buy Now · wishlist/share/copy-link · delivery estimator
(district select → charge + ETA) · coupon cards with copy · policy icons ·
tabbed content (Overview, Description, Features, Specs table, How to Use, Size
Guide, Delivery & Returns, FAQ accordion) · reviews (average, clickable 5→1
breakdown bars that filter, sortable list, verified badge, helpful/report,
write-review CTA) · Frequently Bought Together (bundle at 5% off, add all) ·
Related / Similar / Customers Also Viewed / More from Brand / Recently Viewed
carousels · QuickView modal from cards · mobile sticky action bar above the
bottom nav.

CONSTRAINTS:
- Variant change must update price, stock, selected image, and the add-to-cart
  payload together. One source of truth: a derived selector, not scattered state.
- Out-of-stock variant: disable add + buy, keep the page usable.
- Do not let a missing review or missing video break the page.

VERIFY:
npm run lint && npx tsc --noEmit && npm run build
Test: switch variant to an out-of-stock option; add qty 3 to cart and confirm
line total; open lightbox and navigate with arrow keys; filter reviews to 4★;
click "add all" on the bundle; reload and confirm Recently Viewed updated.

THEN: update STATUS.md, append to HANDOFF.md.
```

### Gate

- [ ] Variant → price/stock/image/payload all consistent
- [ ] Gallery keyboard-navigable; lightbox traps focus, Escape closes
- [ ] Reviews filter + sort work without a full refetch
- [ ] JSON-LD `Product` with price, availability, rating, sku, image
- [ ] Sticky mobile bar does not cover content or the bottom nav

---

# PHASE 6 — API: catalog, search, homepage aggregate

**Goal:** the read API the whole storefront consumes. Fast, paginated, cache-aware, indexed.
**Cost tier:** Deep.

### Master prompt

```text
You are starting Phase 6 of SharkMart: the public/catalog API.
Phase 0 is complete (schema, seed, contract, server skeleton).

READ FIRST:
1. AGENTS.md section 7 (security floor)
2. prompts/backend.md: API Design (public endpoints), Cost Optimization Rules,
   File Structure
3. The contract section of prompts/masterbuild.md (envelope, poisha, bilingual)

BUILD under /api/v1:
GET /products          filter (category, brand, price, rating, inStock,
                       onDiscount) + sort + cursor pagination
GET /products/:slug    full detail incl. images, variants, specs, details,
                       approved reviews summary, related ids
GET /categories        full tree with counts
GET /categories/:slug  category + its products
GET /brands, /brands/:slug
GET /search?q=         bilingual match over nameEn/nameBn/brand/sku + category
GET /flash-sale        active window only, with countdown target
GET /homepage          all section payloads in ONE response (one round trip)
GET /landing/:slug

Also: helmet, CORS allowlist, gzip, request logging (pino), Zod validation on
every query param, global error handler returning the contract envelope,
Redis cache with tag-based invalidation (homepage 5m, categories 10m,
product lists 2m).

CONSTRAINTS:
- No N+1. Use Prisma include/select deliberately; select only needed fields.
- Never SELECT * in production paths.
- Index every filtered/sorted column. Verify with EXPLAIN on the two heaviest
  queries and paste the plan into HANDOFF.md.
- Public responses must never leak costPrice, internal notes, or draft products.
- Return 404 with the envelope for unknown slugs - never a 500.

VERIFY:
npm run lint && npx tsc --noEmit && npm test
Supertest: pagination boundaries, invalid sort key, unknown slug, price filter
min>max, search in Bangla and English, cache hit/miss, rate limit 429.

THEN: update STATUS.md, append to HANDOFF.md with the measured p95 latency of
/products and /homepage on seeded data.
```

### Gate

- [ ] All endpoints return the exact contract envelope
- [ ] Bilingual search returns sensible results in both scripts
- [ ] Pagination correct at page 1, last page, and beyond
- [ ] `/homepage` is one request, not eight
- [ ] p95 < 200ms on seeded data; indexes proven by EXPLAIN
- [ ] Draft/unpublished products never appear in public responses

---

# PHASE 7 — Search, wishlist, account (real API)

**Goal:** replace the mock layer with real data for everything already built, then add the account surface.
**Cost tier:** Standard.

### Master prompt

```text
You are starting Phase 7 of SharkMart: search, wishlist and customer account,
now backed by the real API (Phase 6) instead of the mock layer.

READ FIRST:
1. prompts/frontend.md sections 6.5, 6.6, 6.7, 11
2. AGENTS.md landmine #10 (do not port the hash router)
3. oshoppingbd.html search() and the search-suggestion handler

BUILD:
/search page: query from URL, result count, same filters/sort as category,
term highlighting, real no-results state (suggestions + popular products +
category links), recent searches from localStorage.
Autocomplete: debounced 200ms, grouped (categories / brands / products),
keyboard navigable (↑↓ Enter Esc), aborts in-flight requests.
/wishlist: grid, remove, move-to-cart, empty state; guests use localStorage,
logged-in users sync to the server on login.
/login, /register: field-level validation, password strength, show/hide,
Bangladesh phone format (01XXXXXXXXX), rate-limit-aware error copy.
/profile, /profile/addresses (division → district → area cascade, set default),
/orders (status badges, date, total), /orders/[id] (timeline, items, invoice
download, cancel/return when the status allows), /track (order number + phone).

CONSTRAINTS:
- Flip USE_MOCK=false for these routes only. Do not change component APIs.
- Auth tokens in HttpOnly cookies. No token in localStorage, ever.
- Every account route: server-side session check + redirect, not just a
  client-side guard.
- Optimistic UI for wishlist toggle, with rollback on failure.

VERIFY:
npm run lint && npx tsc --noEmit && npm run build
Test: search "পাঞ্জাবি" and "panjabi" both return results; wishlist survives
logout/login; address cascade rejects an invalid district; /orders/:id of
another user returns 403/404, not data.

THEN: update STATUS.md, append to HANDOFF.md.
```

### Gate

- [ ] Mock layer off for these routes; zero component signature changes
- [ ] Search works in both scripts; keyboard-complete autocomplete
- [ ] IDOR test passes: cannot read another customer's order or address
- [ ] Guest → login cart/wishlist merge does not duplicate items
- [ ] Every account page handles expired session gracefully

---

# PHASE 8 — Auth, cart, orders API + checkout flow

**Goal:** money moves. This phase must be the most defensive work in the project.
**Cost tier:** Deep. Do not delegate this to a fast model.

### Master prompt

```text
You are starting Phase 8 of SharkMart: authentication, cart/order APIs, and
the checkout flow. Real money and real stock move here.

READ FIRST:
1. AGENTS.md section 7 (security floor) - every item applies
2. prompts/backend.md: Security Implementation Checklist, Payment Gateway
   Integration, Courier Integration, and the Order/OrderItem/ShippingAddress models
3. prompts/frontend.md section 6.8

BUILD (backend):
POST /auth/register|login|refresh|logout|forgot-password|reset-password
  - bcrypt cost 12, access 15m + refresh 7d in HttpOnly/Secure/SameSite cookies,
    refresh rotation with reuse detection, login rate limit 5/min
GET/PUT /me, CRUD /me/addresses
POST /cart/sync, GET /cart, POST/PUT/DELETE /cart/items
POST /checkout             - the critical path, see below
POST /checkout/verify-payment
GET /track/:orderNumber    - requires phone match
GET /me/orders, /me/orders/:id, cancel, return request

BUILD (frontend):
/checkout: address step (saved or new, BD divisions), delivery method + charge,
payment method (COD, bKash, Nagad, SSLCommerz), review + coupon, place order.
/checkout/success with order number and tracking info. Full cart page.

CHECKOUT MUST, in one transaction:
1. Re-read every line item's price and stock from the DB. Ignore client prices.
2. Validate the coupon again server-side (window, usage, per-user, min order).
3. Compute subtotal, discount, delivery (৳60 flat, free at ৳2,000), total.
4. Reserve stock atomically. Reject if any line is short - do not partially sell.
5. Create order + items + shipping snapshot + status history + audit log.
6. Enqueue confirmation SMS/email. Never block the response on it.
7. Be idempotent: an Idempotency-Key header must make a double-submit a no-op
   that returns the same order.

CONSTRAINTS:
- Enforce valid status transitions. A shipped order cannot be cancelled by the
  customer. Refunds go through REFUND_PENDING → REFUNDED.
- Never store card data. Store gateway transaction id and status only.
- Verify payment server-side via callback/IPN, never trust the redirect.
- Every order/cart/address access re-checks ownership.

VERIFY:
npm run lint && npx tsc --noEmit && npm test
Integration tests: happy COD checkout; price tampering attempt (client sends
৳1, server charges real price); coupon reuse beyond limit; concurrent checkout
of the last unit (one wins, one gets a clean 409); duplicate submit with the
same Idempotency-Key; cancel after shipped (rejected).

THEN: update STATUS.md, append to HANDOFF.md with the exact concurrency
strategy used and the failure modes you tested.
```

### Gate

- [ ] Server recomputes all money; a tampered payload cannot lower the price
- [ ] Stock reserved atomically; no oversell under concurrency
- [ ] Idempotency proven by test
- [ ] Status machine enforced server-side
- [ ] Payment verified by callback, not redirect
- [ ] Auth cookies HttpOnly + Secure + SameSite; no token in JS

---

# PHASE 9 — Admin panel: core modules

**Goal:** the admin shell plus the modules that run the store day to day — using `admin panel.html` exactly, not a template.
**Cost tier:** Deep (the shell and design fidelity matter more than volume).

### Master prompt

```text
You are starting Phase 9 of SharkMart: the admin panel core.
The API exists (Phases 6, 8). The admin design reference is admin panel.html.

READ FIRST:
1. AGENTS.md section 3 - the admin token set is DIFFERENT from the storefront
   (brand #c8143c, ink #16223d, bg #f6f7fa, radius 20/14/10, breakpoints
   1180/960/720/360). Use the admin namespace only.
2. admin panel.html lines 8-19 (the AGENT NOTES block) - follow all nine rules
3. admin panel.html: .sidebar, .topbar, .page, .card, .kpi, .pipeline, .chart,
   .table-wrap, .badge, .overlay/.modal/.drawer, .cal, .toast, .bottom-nav
4. prompts/backend.md section "Admin Panel Pages (18 Modules)" for scope

BUILD:
Admin shell: 264px sidebar with grouped nav (Dashboard; Sell: Orders, POS,
Customers, Landing pages; Catalog: Products, Inventory, Warehouses, Suppliers;
Grow: Offers and coupons, SMS and email, Tracking and SEO; Operate: Couriers,
Payments, Accounts, Staff (HRM), Roles and security), sticky topbar with global
search (press "/" to focus), language pill, dark-mode toggle, notification
popover, account popover, mobile drawer + scrim, mobile bottom nav.
Middleware-protected /admin/*, RBAC-aware nav (hide what the role cannot use).

Modules: Dashboard (4 KPI cards with one hero card, order pipeline, sales bar
chart with range selector + custom date range via the Saturday-start calendar,
needs-attention list, recent orders table with tabs + row drawer + status flow,
best sellers, courier delivery rates), Products (list + full add/edit form with
image upload/reorder, variant builder, SEO fields, publish/draft), Categories
(tree + reorder), Brands, Orders (list, detail drawer, status update with note,
bulk status, manual order, invoice + shipping label, courier booking),
Inventory (overview, adjust with mandatory reason, movement log, alerts),
Reviews moderation.

CONSTRAINTS:
- Every list page gets search, filters, bulk select, export, and a sticky bulk
  bar on mobile. This is a rule in the reference, not a suggestion.
- Tables collapse to stacked cards under 720px using data-label attributes.
- Status is always badge + text label, never color alone.
- Destructive actions always confirm, with the brand color inside the dialog only.
- One primary (crimson) button per view; everything else is .btn.ghost.
- Bangla must work everywhere via the Hind Siliguri fallback in the stack.

VERIFY:
npm run lint && npx tsc --noEmit && npm run build
Test at 1440, 1024, 720, 390. Verify: sidebar collapses at 960, tables stack at
720, dark mode flips all tokens, "/" focuses search, a PRODUCT_MANAGER cannot
reach Roles and security, every mutation writes an audit log row.

THEN: update STATUS.md, append to HANDOFF.md.
```

### Gate

- [ ] Admin uses admin tokens only; zero storefront `brand.*` leakage
- [ ] Nine AGENT NOTES rules from the reference all satisfied
- [ ] RBAC enforced server-side, not just hidden in the UI
- [ ] Every mutation audited
- [ ] Tables usable at 390px; no horizontal page scroll
- [ ] Dark mode has no unreadable surface

---

# PHASE 10 — Admin panel: business modules

**Goal:** the modules that make it a business system, not a shop — coupons, CRM, HRM, suppliers, warehouses, POS, marketing, reports, settings.
**Cost tier:** Standard.

### Master prompt

```text
You are starting Phase 10 of SharkMart: the admin business modules.
Phase 9 is complete (admin shell + core modules).

READ FIRST:
1. prompts/backend.md "Admin Panel Pages" items 6-18
2. admin panel.html patterns you will reuse: .card + .card-head, .seg.tabs,
   .form (2-col, .full), .switch, .collapse, .tl timeline, .confirm dialog,
   .cal date picker, .chip-btn presets, .toast

BUILD:
Coupons & offers (builder: fixed/percentage/free-delivery, min order, max
discount, window, usage + per-user limits, category/brand/product scoping;
flash-sale scheduler; active offers overview; redemption report).
CRM (segments: new/returning/high-value/inactive; profile with orders, spend,
wishlist, notes, comms history; targeted offer).
HRM (employee records, role assignment, attendance, leave workflow).
Suppliers (directory, purchase orders, goods receiving with discrepancy notes,
invoice/payment status).
Warehouses (list, stock per warehouse, transfers, bin locations).
POS (barcode input, quick search, cart with per-line discount, payment methods,
80mm receipt, shift report).
Barcode generator (generate + print labels).
Landing pages (builder, one-page order form, conversion stats).
SMS + email marketing (composer with BN/EN templates, segment picker,
schedule, delivery report).
Reports (sales, product, category, brand, profit, expenses; CSV/Excel export).
Expenses. SEO manager (bulk meta edit, sitemap, robots). Settings (store info,
delivery charges, gateway + SMS + email credentials, tracking IDs). System
(audit log, sessions, health, backups).

CONSTRAINTS:
- Reuse Phase 9 primitives. Do not introduce a second table style, a second
  modal, or a second date picker.
- Every export streams - never build a 50k-row array in memory.
- Bulk SMS/email goes through the queue, never inline in the request.
- Long-running reports must show progress, not freeze the tab.
- Credentials in Settings are write-only: masked on read, never echoed back.

VERIFY:
npm run lint && npx tsc --noEmit && npm run build
Test: create a coupon and use it at checkout; POS sale decrements stock and
prints; a 1,000-row export completes; SMS sends to sandbox; settings never
return a secret in the response body.

THEN: update STATUS.md, append to HANDOFF.md.
```

### Gate

- [ ] No duplicated UI primitives — all reuse Phase 9
- [ ] Queue used for SMS/email/bulk/export
- [ ] Secrets never returned by any GET
- [ ] Every new endpoint validated + RBAC-guarded + audited
- [ ] Reports match the raw SQL totals (spot-check three numbers by hand)

---

# PHASE 11 — SEO, analytics, tracking

**Goal:** discoverable and measurable. Structured data that validates, events that fire once, and a sitemap that scales.
**Cost tier:** Standard.

### Master prompt

```text
You are starting Phase 11 of SharkMart: SEO, analytics and tracking.
Phases 5 and 7 are complete (PDP, category, search pages exist).

READ FIRST:
1. prompts/frontend.md sections 13, 14, 15
2. AGENTS.md section 8 (Definition of Done)

BUILD:
Per-page metadata from the DB (bilingual title/description, canonical,
OpenGraph, Twitter card) for product, category, brand, search, static pages.
JSON-LD: Product (price, availability, rating, sku, brand, image),
BreadcrumbList, Organization, WebSite + SearchAction, ItemList on categories.
app/sitemap.ts (products, categories, brands, pages; split if > 50k),
app/robots.ts, hreflang bn/en, descriptive alt text from the DB.
GA4 ecommerce events (view_item, view_item_list, add_to_cart,
remove_from_cart, begin_checkout, purchase, search, select_content) and Meta
Pixel equivalents, all via GTM dataLayer with next/script afterInteractive.
One event_id per purchase, shared between GA4 and Meta, to dedupe.

CONSTRAINTS:
- No analytics script may block rendering or shift layout.
- Purchase fires exactly once - guard against refresh and back-navigation.
- Structured data must reflect real availability; never advertise a sold-out
  product as InStock.
- No `dangerouslySetInnerHTML` for JSON-LD without escaping `<`.

VERIFY:
npm run lint && npx tsc --noEmit && npm run build
Validate a PDP and a category page in Google Rich Results Test. Confirm
/robots.txt and /sitemap.xml return valid output. Check the dataLayer in
devtools for one full purchase and confirm one purchase event, not two.

THEN: update STATUS.md, append to HANDOFF.md.
```

### Gate

- [ ] Rich Results passes for Product and Breadcrumb
- [ ] Sitemap valid, paginated if large, no draft URLs
- [ ] One purchase event per order (verified in devtools)
- [ ] Lighthouse SEO ≥ 90 on home, category, PDP
- [ ] hreflang pairs correct and reciprocal

---

# PHASE 12 — Testing, performance, polish

**Goal:** find the bugs before customers do. This phase is allowed to be slow and boring.
**Cost tier:** Deep.

### Master prompt

```text
You are starting Phase 12 of SharkMart: testing, performance and polish.
Phases 3-11 are complete. Your job is to break the product, then fix it.

READ FIRST:
1. AGENTS.md sections 7 and 8
2. prompts/masterbuild.md "Final release gate" below

DO, in this order:
1 Run the full suite. Record every failure before fixing anything.
2 Security pass: walk prompts/backend.md "Security Implementation Checklist"
  item by item. Attempt IDOR on orders/addresses/reviews, price tampering at
  checkout, coupon abuse, upload of a .php renamed to .jpg, XSS in a review and
  in a product description, CSRF on a state-changing form, rate-limit bypass.
3 Concurrency: last-unit checkout race, duplicate submit, double-click add to
  cart, two tabs editing the same cart.
4 Data edges: 0 products in a category, 0 reviews, 1-character search, 200-char
  product name, ৳0 product, price ৳9,99,999, product with no image, Bangla-only
  content, emoji in a name.
5 i18n sweep: every page in both languages, hunt for untranslated strings and
  overflow.
6 Accessibility: keyboard-only pass on header, drawer, filters, PDP, checkout;
  screen-reader labels on icon buttons; contrast ≥ 4.5:1; reduced-motion.
7 Performance: Lighthouse on home/category/PDP; fix LCP, CLS, INP; check bundle
  size; confirm images use next/image with sizes.
8 Cross-browser: Chrome, Firefox, Safari, Edge; Android Chrome, iOS Safari.
9 Cleanup: remove console.log, dead code, unused imports, TODOs that lie.

CONSTRAINTS:
- Fix root causes. Do not silence a failing test to make the suite green.
- Every fix gets a regression test or a documented manual repro.
- Do not refactor for taste during this phase. Fix only.

VERIFY: the release gate below, with real output pasted into HANDOFF.md.

THEN: update STATUS.md, append to HANDOFF.md with a table of every bug found,
its severity, its fix, and how it was verified.
```

### Final release gate

```
[ ] npm run build green, tsc clean, lint clean, tests green (both apps)
[ ] Security checklist 16/16 verified, with evidence
[ ] No IDOR, no price tampering, no oversell, no XSS, no secret leakage
[ ] All 14 categories, all PDP sections, cart, checkout, tracking work E2E
[ ] EN + BN complete, no overflow, no untranslated string
[ ] 360 / 390 / 768 / 1024 / 1440 clean on both surfaces
[ ] Lighthouse: Perf ≥ 85 mobile, A11y ≥ 95, SEO ≥ 90
[ ] Admin: every module CRUD works, RBAC holds, audit log complete
[ ] Backups run; restore has been tested once, not just configured
```

---

# PHASE 13 — Deployment & handover

**Goal:** live, monitored, and handed over so the owner can run it without you.
**Cost tier:** Deep.

### Master prompt

```text
You are starting Phase 13 of SharkMart: deployment and handover.
Phase 12 is complete and the release gate is green.

READ FIRST:
1. AGENTS.md section 7 (secrets)
2. prompts/backend.md "Cost Optimization Rules" and courier/payment sections

DO:
1 Provision: Node runtime, MySQL 8, Redis, object storage, SSL, DNS, Cloudflare.
2 Configure every variable from .env.example. Production values only in the
  host's secret manager - never in git, never in a build artifact.
3 Migrate with `prisma migrate deploy` (never `db push` in production). Take a
  backup immediately before and after.
4 Build and deploy both apps. Confirm the API is not publicly reachable except
  through the intended path.
5 Smoke test in production: register, browse, add to cart, checkout COD, place
  an online payment in sandbox, track an order, admin login, product create,
  courier booking in sandbox, invoice print.
6 Enable: daily automated DB backup (30-day retention), error monitoring,
  uptime check, slow-query log, disk alert.
7 SEO: verify Search Console, submit sitemap, confirm robots, check hreflang.
8 Analytics: confirm GA4 + Meta Pixel live and deduped.
9 Create the Super Admin account. Force password change on first login.
10 Write the handover pack: deployment runbook, backup/restore procedure, admin
   user guide (BN), credential handover (secure channel only), and a one-page
   "what to do if X breaks".

CONSTRAINTS:
- Never print a real secret in chat, logs, or a commit.
- Never run a destructive DB command without an explicit confirmation and a
  fresh backup.
- Production payment and courier stay in sandbox until the owner signs off.

VERIFY: the smoke test list, all green, with timestamps in HANDOFF.md.

THEN: mark Phase 13 complete in STATUS.md, write the final HANDOFF.md entry.
```

### Gate

- [ ] Production smoke test fully green
- [ ] Backups scheduled **and** a restore performed successfully once
- [ ] No secret in git history (`git log -p | grep` for known key prefixes)
- [ ] Monitoring + alerting firing to a real inbox
- [ ] Handover pack delivered; owner can create a product and ship an order unaided

---

## Progress tracker

| # | Phase | Status | Claimed by | Notes |
| --- | --- | --- | --- | --- |
| 0 | Foundation & contracts | ⬜ | — | — |
| 1 | Design system & components | ⬜ | — | — |
| 2 | Layout & cart drawer | ⬜ | — | — |
| 3 | Homepage | ⬜ | — | — |
| 4 | Category pages ×14 | ⬜ | — | — |
| 5 | Product detail | ⬜ | — | — |
| 6 | API — catalog | ⬜ | — | — |
| 7 | Search, wishlist, account | ⬜ | — | — |
| 8 | Auth, cart, orders, checkout | ⬜ | — | — |
| 9 | Admin — core | ⬜ | — | — |
| 10 | Admin — business | ⬜ | — | — |
| 11 | SEO & analytics | ⬜ | — | — |
| 12 | Testing & polish | ⬜ | — | — |
| 13 | Deploy & handover | ⬜ | — | — |

Legend: ⬜ not started · 🟡 in progress · ✅ done · 🔴 blocked

---

## Risk register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Two token sets get merged | Whole admin looks wrong; silent, pervasive | Separate namespaces + review checklist in Phase 9 gate |
| Client-trusted prices | Direct financial loss | Phase 8 gate: tamper test must fail to lower price |
| Oversell on flash sale | Refunds, angry customers, courier cost | Atomic reservation + concurrency test |
| Bangla overflow | Broken layout on the majority language | BN pass in every phase gate, not just Phase 12 |
| Mock/real drift | Components break on switch | Contract frozen in Phase 0; mock shaped from it |
| Migration edits | Data loss on deploy | New migration per change, never edit an applied one |
| Courier/payment sandbox only | Goes live untested | Phase 13 keeps sandbox until owner sign-off |
| Scope creep in admin | Endless phase 10 | Build only what `backend.md` lists |

---

## What this plan refuses to do

- Build features nobody asked for
- Add a UI library, chart library, or state library beyond the approved stack
- Redesign anything in the two reference files
- Ship a phase without a passing build
- Call something "done" without a command to prove it
