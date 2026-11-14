# AGENTS.md — SharkMart

> **Read this file before anything else. It takes 90 seconds. Skipping it is how regressions happen.**

This is the entry contract for every AI agent — Claude, GPT, Gemini, Cursor, Copilot, or a human — that touches this repository. It tells you what is frozen, how to work, how to not break another agent's work, and how to leave the project in a state where the next agent can continue without re-reading the world.

Deep detail lives in `prompts/`. This file is the map and the law.

---

## 0. What you are building

| Field | Value |
| --- | --- |
| Product | SharkMart — bilingual (বাংলা + English) multi-category eCommerce |
| Brand | **SharkMart** · wordmark `Shark` (navy) + `Mart` (brand red) · tagline "Fast Delivery" · asset `Logo/SharkMart Fast Delivery Logo.png` |
| Market | Bangladesh · BDT (৳) · mobile-first · COD-heavy |
| Storefront | Next.js App Router + TypeScript + Tailwind |
| Admin panel | Same Next.js app, `/admin` route group, 17 modules |
| API | Node.js + Express/Fastify + Prisma + MySQL 8 + Redis |
| Design truth | `oshoppingbd.html` (storefront) and `admin panel.html` (admin) |

**The job is not "build an eCommerce site."** The job is: reproduce two hand-crafted designs exactly, on a backend that can survive real money and real couriers.

---

## 1. Read order — do not skip steps

```
1. AGENTS.md                    ← you are here
2. prompts/masterbuild.md       ← find the phase you are on, read its prompt block
3. prompts/frontend.md          ← if your phase touches UI
   prompts/backend.md           ← if your phase touches API/DB/admin
   prompts/security.md          ← if your phase touches auth/orders/admin/payments
4. STATUS.md                    ← what is actually done (trust this over your assumptions)
5. HANDOFF.md                   ← what the last agent learned the hard way
6. git log --oneline -20        ← what changed recently and why
```

Then, and only then, open code.

**Rule:** if `STATUS.md` and your instinct disagree, `STATUS.md` wins until you prove it wrong with a command.

### 1.1 Three commands before your first edit

```bash
git log --oneline -5          # is this phase already committed?
git status --porcelain        # is there uncommitted work I would collide with?
```

And if the task touches the UI:

```bash
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
```

If that process is `next start`, the page you are about to debug is a **stale build**, not your code. In this repo's history, skipping these three checks has produced both failure modes: rebuilding work that was already merged, and debugging a build that was hours old. §6.4 has the rest of the pattern list.

---

## 2. Frozen contracts — read-only, never edit

| File | Why it is frozen |
| --- | --- |
| `oshoppingbd.html` | The storefront's visual DNA. Every color, radius, shadow, animation, breakpoint, interaction and bilingual string already exists here. |
| `admin panel.html` | The admin's visual DNA. Includes its own token set, dark mode, calendar, modal/drawer patterns and component rules. |
| `prompts/frontend.md` | Storefront build law (components, states, i18n, SEO, a11y). |
| `prompts/backend.md` | API/DB/admin build law (schema, endpoints, security, cost rules). |

**Do not "improve" them.** Not the spacing, not the shade of red, not the copy, not the structure. If you believe something is genuinely wrong, write it in `HANDOFF.md` under **Open questions** and keep building around it.

> If your code disagrees with a frozen file, **your code is wrong.** That is the whole rule.

The two HTML files are also the **regression oracle**: a page is done when it is visually indistinguishable from them side by side, not when it "looks nice."

### 2.1 The single sanctioned deviation: the brand

The reference files still carry the **old brand, OShoppingBD** — an `O` mark and a `ShoppingBD` wordmark. That is expected and must not be "corrected" by editing the HTML. Override it at the brand layer instead:

| Element | In the frozen reference | What you ship |
| --- | --- | --- |
| Wordmark | `Shopping` + red `BD` | `Shark` + red `Mart` |
| Mark | Red rounded tile with letter `O` | Same red tile, shark glyph |
| Name in copy, `<title>`, meta, aria-label | OShoppingBD | **SharkMart** |
| Domain | `oshoppingbd.com` | `sharkmart.com.bd` |
| Admin sidebar | `ShoppingBD` | **SharkMart** |
| House brands | `OFashion`, `OBeauty`, `OFragrance`, `OGadgets`, `ONature`, `OHome`, `OFood`, `OBooks` | **`Fashion`, `Beauty`, `Fragrance`, `Gadgets`, `Nature`, `Home`, `Food`, `Books`** — the `O` prefix is dropped |

Everything else stays byte-identical. The brand swap is **not** a licence to touch a colour, a radius, a shadow, a gap, or a breakpoint.

When you read `oshoppingbd.html`, mentally substitute **SharkMart** for every `OShoppingBD` string. When you write code, the string is always `SharkMart` — sourced from one constant (`BRAND.name`), never typed inline.

House-brand renames live in **one place**: the `HOUSE_RENAMES` map in `tools/extract-reference.mjs`. That map drives the generated catalog, the brand slugs and every product's brand reference together. Do not hand-edit brand names in `data/reference-catalog.json` — the next regeneration would undo it. Note the slug consequence: brand `fashion` and category `fashion` now share a slug. They live in separate tables and separate routes (`/brand/…` vs `/category/…`), so nothing collides, but **never resolve a brand slug and a category slug out of one map**.

---

## 3. Two design systems exist. Do not merge them.

This is the single most common way agents corrupt this project. The storefront and the admin panel are *related* but **not identical**. They have different reds, different navies, different page backgrounds, different radii and different breakpoints.

### Storefront tokens — source of truth: `oshoppingbd.html` `:root` (line 12)

| Token | Value | Use |
| --- | --- | --- |
| `--red` | `#C51F4B` | Primary action, active nav, price accent |
| `--red-d` | `#a3163c` | Hover / pressed |
| `--pink` | `#F7DCE4` | Soft tint backgrounds, hover fills |
| `--navy` | `#253858` | Body text, headings, top bar |
| `--bg` | `#fbf8f9` | Page background (warm off-white) |
| `--line` | `#eee5e8` | Borders, dividers |
| `--muted` | `#667590` | Secondary text |
| `--ok` | `#1f8a5b` | In-stock, success |
| `--r` | `14px` | Base radius |
| `--sh` | `0 6px 24px rgba(37,56,88,.08)` | Cards, dropdowns |
| `--sh2` | `0 14px 40px rgba(37,56,88,.16)` | Modals, hover lift |
| `--gap` | `16px` | Section rhythm |
| Container | `max-width:1320px`, `padding:0 20px` | `.wrap` |
| Breakpoints | `1200` · `1024` · `820` · `760` | max-width, mobile-first below 760 |

Fonts: `Plus Jakarta Sans` primary, `Hind Siliguri` for Bangla (`body.bn` swaps the stack and bumps heading `line-height` to `1.25`).

### Admin tokens — source of truth: `admin panel.html` `:root` (line 21)

| Token | Value | Use |
| --- | --- | --- |
| `--brand` | `#c8143c` | Primary action (note: **not** `#C51F4B`) |
| `--brand-600` | `#a80f31` | Hover |
| `--brand-50` | `#fdf0f3` | Active nav, tint |
| `--brand-100` | `#f9d9e1` | Focus ring, borders |
| `--navy` | `#16223d` | Sidebar, toast, primary text (note: **not** `#253858`) |
| `--navy-2` / `--navy-3` | `#24365f` / `#3d5486` | Gradients, meters |
| `--bg` | `#f6f7fa` | Page background (cool grey, not warm) |
| `--card` | `#fff` | Surfaces |
| `--line` / `--line-2` | `#e8eaf0` / `#f0f1f5` | Borders / subtle rows |
| `--text` / `--muted` / `--faint` | `#1a2238` / `#6b7490` / `#9aa2b8` | Type ramp |
| `--ok` / `--warn` / `--bad` / `--info` | `#12805c` / `#a15c00` / `#c8143c` / `#2b5fd9` | Semantic, each with a `*-bg` |
| `--r-lg` / `--r-md` / `--r-sm` / `--r-pill` | `20px` / `14px` / `10px` / `999px` | Radius ramp |
| `--side` | `264px` | Sidebar width |
| Breakpoints | `1180` · `960` · `720` · `360` | max-width |
| Dark mode | `[data-theme=dark]` token override (line 257) | Admin only |

**Implementation rule:** two separate Tailwind namespaces — `brand.*` / `ink.*` for storefront, `admin.brand.*` / `admin.ink.*` for admin. Never let one bleed into the other. Never hardcode a hex in a component.

### Number formatting differs too

| Surface | Behavior in the reference | Example |
| --- | --- | --- |
| Storefront | `toLocaleString('en-US')`, `bn-BD` in Bangla | `৳1,284` · `৳১,২৮৪` |
| Admin | `toLocaleString('en-IN')` — lakh grouping | `৳4,82,350` |

Keep both. Route every amount through one helper per surface so this stays consistent. See §10.

### 3.1 Store identity and money live in exactly one place

The shop's name, contact details and the three delivery numbers are **store settings**, not constants. The admin panel edits them at `/admin/settings`; `server/src/services/settings.service.ts` holds the registry (`SETTINGS`), the cache and the validation.

| Rule | Why |
| --- | --- |
| Never type the shop name, phone, email, address, delivery fee or free-delivery threshold as a literal | Phase 10 found **four** copies of the delivery numbers: `order.service.ts`, `src/lib/commerce.ts`, `homepage.service.ts` and one inline in `checkout-page.tsx`. Three of them were display-only, so raising the fee charged the new amount while the cart still quoted the old one. A customer-facing money mismatch is the worst bug this panel can produce. |
| Adding a setting = one line in `SETTINGS` | The API, the validation and the admin screen all derive from that array. There is no second place to update. |
| Reads go through `getSettings()` / `getStoreProfile()` / `getDeliveryFees()` | Cached (tag `settings`), never throws, falls back to the registered defaults. A failed read must still let the shop take an order. |
| The fallback is `server/src/config/store-defaults.ts` and `src/lib/brand.ts` | A fresh database, or a dead API, renders yesterday's site — not a broken one. |
| Storefront reads the profile once, in `(shop)/layout.tsx` | It goes through `StoreProvider`; client components call `useStore()`. No client-side fetch, and no price flashing from the old value to the new. |
| A change reaches the storefront in **up to 60 seconds** | `next: { revalidate: 60 }` on the public settings fetch. If a rename "didn't apply", wait a minute before debugging. |

**Two fetch halves, and using the wrong one fails silently.** `src/lib/api/admin-client.ts` is the browser half (reads `document.cookie` for CSRF); `src/lib/api/admin.ts` is the server half (`adminFetchServer`, uses `next/headers`). A server component that imports the browser half sends no session and the API answers *"You must be signed in."* This has now happened twice — the products editor importing `admin.ts`, and the settings page importing the browser client. Check which half you are in before importing.

**A partial update is validated against the patch, not the merged row.** A PATCH of `{ isFeatured: true }` must not be rejected because of a stored price the client never sent. That was a P0: every product was read-only for four phases. Apply the same shape to any new cross-field rule — check only when the request touches one of the fields involved.

#### Re-selling this install (white-label)

Each client gets their own deployment: own domain, own database, own `.env`. That is what the single-tenant architecture supports, and it is the model to keep. A per-client setup is:

```
1. new database + new .env (regenerate every secret: JWT, gateway, SMTP, internal token)
2. server/.env     CORS_ORIGINS=https://client.com
   web/.env.local  NEXT_PUBLIC_API_BASE_URL=https://api.client.com
                   NEXT_PUBLIC_SITE_URL=https://client.com      <- metadataBase, canonical, OG
3. npm run db:seed          base only: categories, brands, attributes, warehouse, settings
                            (never `db:seed:catalog` on a client - that is 168 demo products)
4. create the first SUPER_ADMIN with a real password; never ship seed-test-users.ts
5. admin -> Settings: name, tagline, domain, phone, email, address, wordmark halves, logo URL, fees
6. replace public/brand/icon.png and public/brand/sharkmart-logo.png
7. verify: login, checkout, view-source og:url, footer phone
```

Two things a rebrand must **not** touch: `oshoppingbd.html` / `admin panel.html` (§2) and the frozen prompts.

`db:seed` is create-only for settings on purpose. It fills in defaults for keys that have no row and never overwrites a value an operator chose — re-running it after a migration must not rename a client's shop back to SharkMart.

---

## 4. Working standard — the Opus-class bar

Behave like a senior engineer with taste, not a code generator. The behaviours below are what "frontier-model quality" actually means in practice — they are checkable, not vibes. Concretely:

**Investigate before you write.** Read the file you are about to change. Read the file that calls it. Confirm the function exists. Never invent an API, a prop, or an output. If you cannot find it, say so.

**Plan before you build, when it matters.** 3+ files, schema change, auth, payments, or anything irreversible → write 5 lines of plan first (goal, files, order, verification, risk). One-line fixes need no ceremony.

**Hold the whole system in your head.** A change to the cart shape touches the store, the drawer, the checkout payload and the order snapshot. Name the blast radius before you edit, then edit once.

**Self-critique before you report.** Re-read your own diff as a reviewer would. Would you approve it? What did you forget — the empty state, the error path, the Bangla width, the second click? Fix it before the user sees it, not after.

**Smallest change that fully solves the problem.** No drive-by refactors. No "while I was here" renames. No new dependencies without a written reason. No abstraction until the third repetition.

**Root cause, not symptom.** A `try/catch` that hides an error is not a fix. If the query is slow, fix the index, not the timeout.

**Verify, then speak.** "Done" requires evidence: a passing build, a passing test, or an observed behavior. If you did not test it, the word is **"untested"** — use it.

**Be honest about uncertainty.** "I assumed X because Y" beats confident fiction. Two failed attempts on the same problem → stop, change approach, or ask. Do not grind a third time.

**Think in edge cases by default.** 0 items. 1 item. 10,000 items. 3G network. Failed image. Bangla text 30% longer than English. Duplicate submit. Double-click. Back button. Refresh mid-checkout. Screen reader. `prefers-reduced-motion`.

**Creative, not decorative.** The creativity budget goes into solving the *actual* problem elegantly — a cleaner state machine, a smarter cache key, a layout that survives Bangla. Not into inventing features nobody asked for. When two designs both work, pick the one the next agent will understand faster.

**Write for the next agent.** Clear names, no clever one-liners, a comment only where the *why* is non-obvious. If you made a compromise, mark it `// NOTE:` with the reason.

---

## 5. Multi-agent protocol

Several agents work this repo in sequence and sometimes in parallel. This section prevents the two failure modes that cost the most: **duplicated work** and **silent conflicts**.

### 5.1 Single writer per file

| Ownership | Paths | Who may write |
| --- | --- | --- |
| Storefront UI | `src/app/(shop)/**`, `src/components/{ui,layout,home,product,cart,shared}/**` | Frontend agent only |
| Admin UI | `src/app/(admin)/**`, `src/components/admin/**` | Admin agent only |
| API | `server/src/**` | Backend agent only |
| Schema | `server/prisma/schema.prisma` | Backend agent only — **announce in STATUS.md before editing** |
| Shared contracts | `src/types/**`, `server/src/types/**` | Whoever changes it must update both sides in the same commit |
| Docs | `prompts/**`, `AGENTS.md`, `STATUS.md`, `HANDOFF.md` | Any agent, but append — never rewrite another agent's phase notes |

**Never edit a file outside your lane.** Need a change there? Write it as a request in `HANDOFF.md` under **Requests to other agents**, with file path and exact change.

### 5.2 Claim before you start

Before writing code, add one line to the **Active claims** table in `STATUS.md`:

```
| Phase 3 — Homepage | hero, trust, brand carousels | frontend-agent-2 | 2026-11-11 18:40 |
```

Remove your line when you finish. If a claim exists for the file you need, **stop** — pick different work or coordinate.

### 5.3 One phase per session

Do not start Phase 5 while Phase 3 is half-built. Finish, verify, hand off, then move. A half-built phase is worse than an unstarted one because the next agent cannot tell intent from accident.

### 5.4 Commit discipline

Small, logical, verifiable commits. Conventional prefixes:

```
feat(product-card): add wishlist toggle + all four states
fix(cart): stop drawer re-render from resetting scroll position
style(hero): match slide padding to reference at 760px
refactor(api): extract pagination helper
chore(deps): add framer-motion (reason: carousel drag momentum)
```

Never commit a red build. Never commit secrets. Never `--force` push. Never rewrite history that another agent has pulled.

### 5.5 Conflict resolution

If your change and someone else's collide: **their committed work wins**. Rebase your intent on top of it. If the collision is semantic (two different solutions to one problem), the one that matches the frozen contracts wins — not the newer one, not the cleverer one.

### 5.6 Handoff — the most important habit

A session ends. The next agent knows nothing except what you wrote. Before you stop, fill in `HANDOFF.md`:

1. **What I completed** — files, features, with paths
2. **What I verified** — the exact commands and their results
3. **What is NOT done** — be specific; "partially wired" is not specific
4. **What I assumed** — so it can be challenged
5. **Landmines I hit** — anything that cost you more than 10 minutes
6. **Exact next step** — one sentence, actionable, no ambiguity

Then update the phase row in `STATUS.md`.

---

## 6. Cost discipline

Every token you spend re-reading is a token not spent building. This project is large; waste compounds.

### 6.1 Match model to task

| Task type | Tier | Examples |
| --- | --- | --- |
| Mechanical | Fast / cheap | CRUD handlers, seed data, form fields, Tailwind class mapping, copying a template to 13 more categories |
| Standard | Mid | Component build with states, list pages, filters, API endpoint with validation |
| Deep | Frontier / high reasoning | Schema design, auth, payment + courier integration, checkout state machine, concurrency, debugging a multi-step flow, performance work |

Do not burn a frontier model on renaming a variable. Do not hand payment verification to a fast model.

### 6.2 Context budget

1. **Search before reading.** Locate the symbol, then read ±40 lines around it. Rarely read a whole 1,200-line file.
2. **Never re-read a file you just wrote.** You know its contents.
3. **Never read the two HTML references end-to-end twice.** Read the `:root` block, then the specific section you are porting. `oshoppingbd.html` is 876 dense lines; `admin panel.html` is 836.
4. **Batch independent reads** in one turn.
5. **Don't paste large file contents into chat.** Reference paths.
6. **Prefer the handoff note over re-exploration.** If `HANDOFF.md` says where the cart store lives, trust it and verify with one read, not a tree walk.

### 6.3 Stop rules

- Two failed attempts on the same bug → stop, write down what you ruled out, change strategy.
- Build failing for a reason unrelated to your change → report it, do not "fix" it silently.
- A task needs a decision the owner must make → ask once, with a recommended default, then proceed on that default if no answer.

### 6.4 Wasted-turn patterns

Every one of these has already cost this project a session. They are cheap to avoid and expensive to repeat.

| Symptom | What people do | What to do instead |
| --- | --- | --- |
| A change "didn't apply" | Edit the code again, restart the app, clear `.next` | Find out what is serving the port **first**: `Get-NetTCPConnection -LocalPort 3000`. If it says `next start`, you are looking at a stale build — see landmine 15. |
| A form submits nothing, console clean | Read the component, add logs, suspect hydration | Check the URL bar and `CORS_ORIGINS`. `127.0.0.1` and `localhost` are different origins; a blocked POST looks exactly like a broken form. |
| "React isn't hydrating" | Probe for React fibers in the browser | A probe that runs in an isolated world cannot see React's DOM expandos and returns 0 on a working page. Prove interactivity by clicking a toggle and reading the DOM. |
| "Is this done?" | Re-read the phase prompt and explore the tree | `git log --oneline -5` and `git status`. If the commit exists and the tree is clean, the work is in. |
| "What fields does Product have?" | Read `schema.prisma` end to end | `awk '/^model Product /,/^}/' server/prisma/schema.prisma`. It is 900+ lines; never read it whole. |
| "Do the tests pass?" | `npm test` (33 s) after every edit | `npx tsc --noEmit` for types, and one targeted file for logic: `npm test -- adminOrder`. Full suite once, before committing. |
| "Does it build?" | `npm run build` as a type check | `tsc` answers types in seconds. Build is for the final gate, not for iterating. |
| "The numbers are wrong" | Recompute the aggregate in a script | Ask the endpoint that already computes it (`/counts`, `/dashboard`). If it is missing, add it server-side — never in the browser. |
| "The UI looks broken" | Delete `.next`, then `node_modules` | The two most expensive guesses available. Check the served build, then the computed style, then the CSS cascade — in that order. |

**Cheapest tool that answers the question**, in order: `grep` → `Read` with an offset → `tsc` → one test file → `curl` the endpoint → the browser. Start at the left.

**Read `STATUS.md`'s newest entry and the top of `HANDOFF.md` before exploring.** They exist so you do not rediscover what the last session already proved. One read there routinely saves ten.

---

## 7. Security floor — non-negotiable, every PR

These are not "best practices." A PR that violates one does not merge. Full checklist: `prompts/backend.md` → *Security Implementation Checklist*.

1. **Validate on the server, always.** Zod on body, query, and params. Client validation is UX, not security.
2. **Authorize every resource access.** Ownership check on every order, address, review, cart item. Never trust an ID from the client. This is the #1 eCommerce breach vector (IDOR).
3. **Never trust client-supplied money.** Price, discount, delivery charge and totals are recomputed server-side from the DB at checkout. The cart is a suggestion.
4. **Passwords:** bcrypt, cost ≥ 12. Never log, never return, never email.
5. **Tokens in HttpOnly + Secure + SameSite cookies.** Access 15 min, refresh 7 days. No tokens in `localStorage`.
6. **RBAC on every `/admin` route** — role *and* permission, not just "is logged in."
7. **Rate limit:** login 5/min, register 3/min, public API 100/min, admin 200/min.
8. **Sanitize stored HTML** (product descriptions, reviews) on write. Escape on render. `dangerouslySetInnerHTML` only with DOMPurify.
9. **Uploads:** validate MIME + extension + magic bytes + size (image 5MB, video 50MB). Never trust the filename. Store outside the web root or in object storage.
10. **Payments:** verify server-side via callback/IPN. Store transaction IDs only — never card data, never wallet credentials.
11. **Secrets in `.env` only.** Every new variable goes into `.env.example` **in the same commit**. Never read or print a real `.env`.
12. **Errors:** structured JSON with a code. No stack traces, no SQL, no internal paths in production responses.
13. **Audit trail:** every admin mutation logs actor, action, entity, entityId, IP, timestamp.
14. **Rate-limit and lock** failed OTP/COD-verification attempts — COD fraud is a real Bangladesh-specific attack surface.

---

## 8. Definition of Done

A task is done when **all** of these are true. Not before.

```
[ ] Behavior matches the frozen reference (storefront) or admin panel.html (admin)
[ ] Works at 360 / 768 / 1024 / 1440 px
[ ] Loading + empty + error + success states all exist
[ ] Works in English AND Bangla without layout break
[ ] Keyboard reachable, visible focus, correct ARIA
[ ] prefers-reduced-motion respected
[ ] Server-side validation + authorization on the endpoint
[ ] Type-check passes, lint passes, build passes
[ ] No console errors, no `any`, no TODO left behind
[ ] The wiring is proven end to end, not just type-checked
[ ] STATUS.md row updated · HANDOFF.md written
```

**"Type-check passes" is not "it works."** A page can compile, render 200, and still
show the wrong number because it read a constant instead of the setting, or send no
session because it used the browser fetch half in a server component. Both happened
in Phase 10 and both passed `tsc`. For anything that crosses a boundary — API to
screen, settings to storefront, server to client — change a value, observe the
change where the customer would see it, then change it back.

### Verification commands

```bash
# Frontend
npm run lint
npx tsc --noEmit
npm run build

# Backend
npm run lint
npx tsc --noEmit
npx prisma validate
npm test
```

Run the narrow check for the file you touched (`eslint path/to/file.tsx`, `vitest run path`) before the full suite. Report the exact command and its result in `HANDOFF.md`. "Should work" is not a result.

---

## 9. Ask vs. assume

| Situation | Action |
| --- | --- |
| A wrong guess would cost hours (schema, auth, payments, public API shape, stack choice) | **Ask once**, propose a default |
| A wrong guess costs minutes and is reversible | **Assume**, state the assumption inline, continue |
| The frozen references answer it | **Never ask** — read them |
| Two frozen files contradict each other | Follow the more specific one, log the conflict in `HANDOFF.md` |
| You need credentials or a business decision (courier account, bKash sandbox, free-delivery threshold) | **Ask**, keep building with a stub |

---

## 10. Known landmines

Verified facts that have already tripped someone. Read once, save hours.

| # | Landmine | Reality |
| --- | --- | --- |
| 1 | "Admin is the same palette as storefront" | No. `#c8143c` vs `#C51F4B`; `#16223d` vs `#253858`; `#f6f7fa` vs `#fbf8f9`. Two namespaces. |
| 2 | Category slug `office-business-supplies` | Wrong. The reference id is **`office-business`**. Copy ids from `CATS` in `oshoppingbd.html` (line 540), never from prose. |
| 3 | Free delivery | Threshold **৳2,000**, otherwise **৳60** flat (`totals()` in `oshoppingbd.html` line 779). Progress bar width is `sub / 20` capped at 100%. |
| 4 | Money math in floats | No. Store integer poisha or `Decimal`, never `number` for money. `0.1 + 0.2` will find you. |
| 5 | Tailwind v4 + `tailwind.config.ts` | v4 is CSS-first. Define tokens with `@theme` in `globals.css`; the config-file skeleton in `frontend.md` Appendix B is v3 syntax. Pick one, document it, keep token *names* identical. |
| 6 | Bangla breaks layouts | Bangla glyphs are wider and taller. Test every heading and button in `body.bn`. Reference uses `line-height:1.25` on Bangla headings. |
| 7 | Number grouping | Storefront uses standard grouping; admin uses lakh grouping (`en-IN`). Two helpers, not one. |
| 8 | Admin calendar weeks start **Saturday** | Not Sunday, not Monday. Bangladesh. See `WD` in `admin panel.html` line 718. |
| 9 | "Fixing" the brand inside the reference HTML | Never. The frozen files say `OShoppingBD`; you ship **SharkMart** through one `BRAND.name` constant. Do not edit the HTML, and do not leave a stray `OShoppingBD` string in shipped code. |
| 10 | Reference is an SPA with hash routes | `#/category/:id`, `#/product/:id`. Production uses real paths. Do not copy the hash router into Next.js. |
| 11 | Cart state in the reference is global mutable `st` | In production it is a Zustand store + server sync. Do not port the mutation style. |
| 12 | The reference seeds 2 cart items at boot (line 872) | Demo only. Never ship pre-filled carts. |
| 13 | Logo red ≠ token red | The SharkMart logo's crimson is brighter than the storefront token `#C51F4B`. Do **not** retune the tokens to match the artwork — the owner locked the reference palette. Place the logo asset as-is and leave tokens alone. |
| 14 | The reference file is named `oshoppingbd.html` | The filename is historical. Do **not** rename or move it — every doc, phase prompt and gate references that exact path. |
| 15 | `next start` left running on port 3000 | It serves the last **build**, not your edits. Every "the fix didn't apply" session in this repo traces back to it. Dev is always `npm run dev`. Before debugging a UI change, check what owns the port. |
| 16 | Prisma `String` is `VARCHAR(191)` in MySQL | A `data:` URI placeholder is longer and MySQL truncates it **silently** — the row looks fine, the image is broken. Any URL/text column that can exceed 191 chars needs `@db.Text`. Widening it with `db push` is not a fix: it makes the database right and the migration history lie. |
| 17 | Storefront CSS leaks into admin | `components.css` has bare `.badge`, `home.css` has bare `.hero`. Admin reuses those names, and the later rule wins — an unscoped `.badge` absolutely-positioned every admin status pill at 10px/10px. Prefix admin classes or scope them under `.admin-root`. |
| 18 | `Product` has no `stock` column | Stock is `ProductVariant.stock` and `WarehouseStock.quantity`. Public availability is computed by `stockStatusOf()` in `services/mappers.ts` (0 → out, ≤5 → low). Any admin stock figure is an aggregate over `WarehouseStock`, never a column read. |
| 19 | Order tabs ≠ order statuses | The enum has nine; the reference tabs show five. CONFIRMED and RETURNED are produced by the normal flow, so they need a reachable control — the status select in the toolbar, not a tab. Do not "simplify" it away because the tabs look complete. |
| 20 | A code comment is not evidence | Twice now a comment asserted something false ("the reference shows four tabs", "reachable through the status filter") and the code disagreed. When a comment states a fact about behaviour, verify it before building on it — and fix the comment in the same commit that proves it wrong. |
| 21 | `HANDOFF.md` is double-encoded | 290 of its lines carry mojibake where punctuation belongs, and 24 contain unreadable Bangla. Cause: a PowerShell `Get-Content`/`Set-Content` round-trip, the same bug that corrupted `categories-tree.tsx` mid-B5. **Never rewrite a file with PowerShell here.** Use the editor tools, or read and write UTF-8 explicitly in Node and diff the result. `STATUS.md`, `AGENTS.md` and `README.md` are clean — do not let them join it. |
| 22 | "The settings screen saved but nothing changed" | Almost always the 60-second storefront revalidation, or the wrong fetch half (§3.1). Check `GET /api/v1/settings` first — if the API has the new value, the write worked and the storefront is waiting. |
| 23 | A delivery fee or threshold typed as a number in a component | There were four copies of these before Phase 10. The server charges from settings; a component that quotes a constant shows the customer a different price than the invoice. Grep for `6000` / `200000` / `60` before adding one. |
| 24 | `npm test` segfaults (exit 139) | Environmental, seen three times in this workspace. It happens after most suites have passed and prints no summary. Re-run; if it passes, treat the first run as noise. Do not start "fixing" tests because of it. |
| 25 | `poolOptions.threads.singleThread` | A silent no-op since Vitest 4 — still type-valid, so the config looks right while every suite runs in parallel against one MySQL database. The tell is a *different* test failing each run. `fileParallelism: false` is the option that works. |
| 26 | Trusting "it passed on re-run" | With parallel suites that phrase proves nothing: the race simply did not land. A green re-run after a red run is a hint, not evidence. Find the shared row. |
| 27 | A POS sale written to its own table | `PosSale` + `PosSaleItem` looks tidy and is wrong: every revenue figure here is a query over `Order`, so a parallel table means each report needs a UNION, and the first one written without it under-reports by the counter's takings forever. A till sale is an `Order` with `channel = 'POS'`. `PosSession` holds only what an order cannot: the shift, the float, the cash count. |
| 28 | Reusing checkout's `reserveVariantStock` in the till | It increments `reservedStock` as well as decrementing `stock`. Correct for a courier order, wrong for a counter sale — the goods left in a bag, nothing is being held. The till decrements `stock` alone, conditionally, and writes an `OUT` movement. |
| 29 | Shift totals as a running counter | Incrementing `saleCount`/`cashSalesPoisha` on every sale drifts the first time a sale is voided or a request retried, and then the Z-report disagrees with the drawer with no explanation. Open shifts derive their totals from the orders (`pos.service.ts#liveTotals`); the stored snapshot is written once, at close. |
| 30 | A till with no idempotency key | "Complete sale" is a touchscreen button and the shop's network is often a phone hotspot. `clientRef` is required, unique on `Order.posClientRef`, and a replay returns the first sale with `replayed: true` instead of ringing the goods up twice. Do not make it optional. |
| 31 | `crypto.randomUUID` in a shop panel | It only exists in a secure context. A panel reached over plain http on the LAN — which is how most Bangladeshi shops would run a till — throws. `newClientRef()` in `pos-screen.tsx` falls back to `getRandomValues`. |
| 32 | A policy page promising something the code does not do | The Help page first said "use the forgot-password link on the sign-in page" — that link goes to `/forgot-password`, which does not exist. A privacy page claiming "we never store card data" is fine because `Order` genuinely holds only a transaction id; a help page promising a reset email is a support ticket. Before writing a policy claim, open the route or read the query it describes. The same rule caught the payment gateway: the copy says online payment is offered "where the shop has enabled it" because `verifyPayment` is still a documented stub. |
| 33 | A hydration mismatch showing a **dictionary key** on screen | If the page renders `forgotTitle` where "Reset your password" belongs, the server bundle has a stale copy of `account-strings.ts` — the client has the new one, so React reports a text mismatch. It is Next's dev module cache, not your code: `curl` the route and look at the SSR HTML, then **restart `npm run dev`**. This has now cost time three times (the `/admin/pos` nav item, then two dictionary entries). A production build cannot have it. Do not start editing the dictionary. |

---

## 11. Repo map

```
/
├── AGENTS.md                  ← this file
├── STATUS.md                  ← living phase tracker + active claims
├── HANDOFF.md                 ← last agent's notes, append-only
├── oshoppingbd.html           ← FROZEN storefront reference
├── admin panel.html           ← FROZEN admin reference
├── prompts/
│   ├── masterbuild.md         ← phase plan + per-phase master prompts
│   ├── frontend.md            ← storefront build law
│   ├── backend.md             ← API/DB/admin build law
│   └── security.md            ← security implementation guide (phases 6, 8, 9, 12)
├── Logo/                      ← brand assets
├── src/                       ← Next.js app (Phase 0 creates)
└── server/                    ← API + Prisma (Phase 0 creates)
```

### Where the cross-cutting things live

| Concern | File | Read this before |
| --- | --- | --- |
| Store identity, delivery fees, settings registry | `server/src/services/settings.service.ts` | touching any price, name or contact detail (§3.1) |
| Fallback values when settings are absent | `server/src/config/store-defaults.ts`, `src/lib/brand.ts` | adding a default |
| Storefront access to the profile | `src/components/providers/store-provider.tsx` (`useStore()`) | rendering the name, phone, fee or threshold |
| Admin fetch, browser half | `src/lib/api/admin-client.ts` | writing a client component that calls the API |
| Admin fetch, server half | `src/lib/api/admin.ts` (`adminFetchServer`) | writing a server component that calls the API |
| Audit helper | `server/src/services/audit.service.ts` (`withAudit`, `diffChanges`) | any mutation — never write a second one |
| Permission matrix | `server/src/services/permissions.ts` | adding a route or a nav item |
| Cache + tags | `server/src/services/cache.ts` | adding a cached read or a write that must invalidate |
| Stock of record rule | `server/src/routes/admin/inventory.service.ts` (header + `defaultWarehouseId`) | writing anything that decrements stock — variants vs `WarehouseStock` |
| Selling price rule | `server/src/services/order.service.ts` (`effectivePrice`) | quoting a price anywhere. Flash sale beats discount beats base — one definition, imported, never copied |
| Counter sales | `server/src/routes/admin/pos.service.ts` | anything touching the till, shifts or the receipt |
| Policy copy (help, returns, privacy, terms, about) | `src/lib/legal/content.ts` | editing any promise the shop makes. Delivery figures are read from `StoreProfile`, never typed |
```

---

## 12. The one-paragraph version

Read the frozen references, claim your phase, plan if it is big, change as little as possible, validate and authorize on the server, handle the ugly states, test in both languages at three widths, verify with a command, write the handoff, update the status. If you cannot prove it works, say so.

**That is the whole job. Now go read `prompts/masterbuild.md` and find your phase.**
