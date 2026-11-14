# SharkMart

A bilingual (বাংলা + English) multi-category eCommerce platform for Bangladesh:
a Next.js storefront and a multi-module admin panel, on an Express + Prisma + MySQL API.
Prices in BDT, cash-on-delivery first, courier and mobile-wallet ready.

Two applications, one repository:

| App | Path | Port | What it is |
| --- | --- | --- | --- |
| Storefront + admin | `/` (`src/`) | 3000 | Next.js App Router. `/admin` is its own route group with its own shell |
| API | `server/` | 4000 | Express + Prisma + MySQL. Every admin route is RBAC-guarded and audited |

The storefront and the admin are **not** the same design system. Two palettes, two
radius scales, two breakpoints. See `AGENTS.md` §3 before touching either.

---

## Requirements

| | Version | Notes |
| --- | --- | --- |
| Node | 20 or newer | Prisma 6 needs ≥ 18.18; 20 is what this is developed on |
| MySQL | 8 (MariaDB 10.4+ works) | `utf8mb4` / `utf8mb4_unicode_ci` |
| Redis | optional in dev | Without it the cache and rate limiter fall back to an in-process store — correct, but **per-process**. Production needs Redis. |

---

## Quick start

```bash
# 1. install both packages
npm install
cd server && npm install && cd ..

# 2. configure
cp .env.example .env.local          # storefront
cp server/.env.example server/.env  # API

# 3. create the database (utf8mb4 matters for Bangla)
mysql -u root -e "CREATE DATABASE sharkmart
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 4. schema + data
cd server
npx prisma migrate deploy
npm run db:seed            # base: categories, brands, settings (an empty shop)
# npm run db:seed:catalog  # + 168 demo products, for demos and screenshots

# 5. run both, in two terminals
npm run dev                # API on :4000
cd .. && npm run dev       # storefront on :3000
```

Then open http://localhost:3000 and http://localhost:3000/admin.

**Staff test accounts** are a separate script, deliberately not part of `db:seed`:

```bash
cd server && npx tsx prisma/seed-test-users.ts
```

| Role | Email | Password |
| --- | --- | --- |
| SUPER_ADMIN | `super@sharkmart.test` | `Admin@12345` |
| ORDER_MANAGER | `manager@sharkmart.test` | `Admin@12345` |
| INVENTORY_STAFF | `inventory@sharkmart.test` | `Admin@12345` |
| MARKETING_STAFF | `marketing@sharkmart.test` | `Admin@12345` |

These are development constants. **Never run that script against production**, and
create the first real super admin another way.

---

## Environment

### `server/.env`

| Key | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | yes | `mysql://user:pass@host:3306/dbname` |
| `PORT` | no (4000) | API port |
| `NODE_ENV` | no | `production` forces `Secure` cookies |
| `CORS_ORIGINS` | yes in prod | Comma-separated. Defaults to both loopback spellings |
| `COOKIE_DOMAIN` | no | `.example.com` **only** when the storefront and API are different subdomains. Leave empty for one origin |
| `JWT_ACCESS_SECRET` | yes | ≥ 32 chars. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | yes | Same, different value |
| `INTERNAL_API_TOKEN` | yes | Server-to-server calls from Next. Must match the web value |
| `REDIS_URL` | no | Without it, caching and rate limits are per-process |
| `SMTP_*`, `SMS_GATEWAY_*` | no | Read by `tools/dispatch-notifications.mjs`; see *Limitations* |

### `.env.local` (storefront)

| Key | Required | What it does |
| --- | --- | --- |
| `NEXT_PUBLIC_USE_MOCK` | yes | `false` for the real API. `true` reads fixtures |
| `NEXT_PUBLIC_API_BASE_URL` | yes | Where the browser calls the API |
| `NEXT_PUBLIC_SITE_URL` | yes | Canonical origin: `metadataBase`, canonical tags, OpenGraph |
| `INTERNAL_API_TOKEN` | yes | Same value as the server |

---

## Scripts

| Command | Where | What |
| --- | --- | --- |
| `npm run dev` | both | Dev server |
| `npm run build` / `npm start` | both | Production build and start |
| `npm run typecheck` | both | `tsc --noEmit` |
| `npm test` | server | 350+ integration tests against a real MySQL database |
| `npm run db:seed` | server | Base seed — categories, brands, settings |
| `npm run db:seed:catalog` | server | Base + 168 demo products |
| `npm run prisma:migrate` | server | `prisma migrate dev` (development only) |

`db:seed` is **create-only** for settings: it fills in keys that have no row and
never overwrites a value an operator chose.

---

## Deploying one install per client

Each client gets their own domain, database and `.env`. The full checklist lives in
`AGENTS.md` §3.1; the short version:

1. New database, new `.env` — regenerate every secret.
2. `CORS_ORIGINS`, `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SITE_URL`.
3. `npm run db:seed` — **not** `db:seed:catalog`.
4. Create the first SUPER_ADMIN yourself; never ship the test accounts.
5. Admin → Settings: name, tagline, domain, phone, email, address, wordmark, logo.
6. Replace `public/brand/icon.png` and `public/brand/sharkmart-logo.png`.

The storefront reads settings within 60 seconds — it is ISR, not instant.

---

## Testing

```bash
cd server && npm test
```

Integration tests, not unit tests: they run against the seeded database, sign in
with the accounts above, and assert on real HTTP responses. They clean up after
themselves — the database is identical before and after a run.

CI runs the same suite plus a storefront build on every push
(`.github/workflows/ci.yml`).

---

## Limitations, stated plainly

These are known and deliberate, not bugs waiting to be discovered:

- **No email or SMS transport.** `tools/dispatch-notifications.mjs` queues and
  drains `Notification` rows; SMS posts to `SMS_GATEWAY_URL` when set, email is
  refused because no mail dependency has been chosen. A delivery report that says
  "sent" when nothing left the building would be worse than one that admits this.
- **No file uploads.** Images are URLs on `ProductImage`. There is no storage
  service, so "upload" means "paste a link".
- **No storefront landing page.** `GET /api/v1/landing/:slug` and the order POST
  exist; the page that would call them does not.
- **Checkout does not decrement stock for a product with no variants.** A
  variant-less product's stock of record is `WarehouseStock` (see
  `inventory.service.ts`), and `placeOrder` skips those lines entirely, so an
  online order for such a product leaves the count untouched. The till *does*
  decrement it, because a counter sale hands the goods over immediately. The
  catalogue currently ships with zero variant-less products, which is the only
  reason this has not bitten. Fixing it means touching the checkout transaction,
  which is the most carefully tested path in the project — it is a change for a
  pass of its own, not a footnote.
- **Checkout writes no `StockMovement` rows.** The inventory movement log shows
  counter sales, adjustments, transfers and receipts, but not online orders. The
  till writes them; `placeOrder` does not.
- **No refunds or voids from the till.** A counter refund is an order refund, and
  the orders module owns that path with its own permission (`orders:refund`) and
  audit trail. A second refund button would be a second way to move money.
- **A manual till discount is capped at 50% of the bill.** Anything larger is a
  pricing decision and belongs in the coupon module, where it is dated and
  auditable.
- **Two storefront links still 404.** The mobile bottom nav points at `/account`
  and the sign-in form points at `/forgot-password`; neither route exists. The
  pages themselves are a small job — the reset flow needs the token endpoints
  wired to a form — but until they land, the Help page tells customers to phone
  the shop rather than promising a reset link.
- **No sitemap or robots file.** `src/app/sitemap.ts` and `robots.ts` do not
  exist, so search engines crawl from the links they find.
- **No profit reporting.** `Product` has no cost field, so margin is not
  computable. Revenue minus expenses is shown as a cash view, labelled as such.
- **Reviews are never seeded.** `ratingAvg`/`reviewCount` carry the reference
  catalogue's numbers while the `Review` table is empty; the admin review screen
  starts with an empty queue.

---

## Where to read next

| File | Why |
| --- | --- |
| `AGENTS.md` | The rules: frozen files, design tokens, cost discipline, known landmines |
| `STATUS.md` | What is actually done, right now |
| `HANDOFF.md` | What the last session learned the hard way |
| `prompts/masterbuild.md` | The phase plan and each phase's gate |
| `oshoppingbd.html`, `admin panel.html` | The frozen design references — read-only, never edit |
