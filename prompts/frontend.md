# SharkMart — Frontend Agent Instructions

> **Role**: You are an AI agent responsible for building and maintaining the frontend of SharkMart.
> **Read this entire document before writing a single line of code.**
> **This file is the canonical reference for all frontend work. If it conflicts with verbal instructions, this file wins unless explicitly overridden.**

---

## Table of Contents

1. [Project Identity](#1-project-identity)
2. [Reference Design — The Sacred Source of Truth](#2-reference-design--the-sacred-source-of-truth)
3. [Design System](#3-design-system)
4. [Technology Stack](#4-technology-stack)
5. [Architecture Rules](#5-architecture-rules)
6. [Page Structure — What to Build](#6-page-structure--what-to-build)
7. [Component Library](#7-component-library)
8. [Button Design Rules](#8-button-design-rules)
9. [Mobile Navigation & Responsive Behavior](#9-mobile-navigation--responsive-behavior)
10. [Cart Behavior](#10-cart-behavior)
11. [Search System](#11-search-system)
12. [Internationalization (i18n)](#12-internationalization-i18n)
13. [Performance Requirements](#13-performance-requirements)
14. [SEO Requirements](#14-seo-requirements)
15. [Analytics Integration](#15-analytics-integration)
16. [Client-Side Hardening (never authorization)](#16-client-side-hardening-never-authorization)
17. [File Structure Convention](#17-file-structure-convention)
18. [Multi-Agent Handoff Rules](#18-multi-agent-handoff-rules)
19. [Agent Working Style & Philosophy](#19-agent-working-style--philosophy)

---

## 1. Project Identity

| Field            | Value                                          |
| ---------------- | ---------------------------------------------- |
| **Project Name** | SharkMart                                      |
| **Brand**        | SharkMart — wordmark splits as **Shark** (navy) + **Mart** (brand red) |
| **Tagline**      | Fast Delivery                                  |
| **Logo asset**   | `Logo/SharkMart Fast Delivery Logo.png` — horizontal lockup: red shopping-bag + shark mark, navy/crimson wordmark |
| **Type**         | Multi-Category E-Commerce Platform             |
| **Domain**       | `sharkmart.com.bd` (working assumption — confirm with owner) |
| **Target Market**| Bangladesh                                     |
| **Languages**    | Bangla (বাংলা) + English — user-switchable     |
| **Currency**     | BDT (৳) — Bangladeshi Taka                     |
| **Audience**     | Bangladeshi consumers, mobile-first            |

### 1.1 Brand lockup in code

The reference file renders the old wordmark like this:

```html
<a class="logo" href="#/" aria-label="OShoppingBD home">
  <span class="mk">O</span><span class="wm">Shopping<i>BD</i></span>
</a>
```

SharkMart keeps the **exact same structure and type scale** — only the content changes. The red half moves from `BD` to `Mart`:

```tsx
<Link className="logo" href="/" aria-label="SharkMart home">
  <span className="mk">
    <Image src="/brand/sharkmart-mark.svg" alt="" width={40} height={40} priority />
  </span>
  <span className="wm">Shark<i>Mart</i></span>
</Link>
```

Rules:

- Keep the reference metrics exactly: `.mk` is `40px` with `12px` radius (mobile ≤760px: `34px` / `10px`), `.wm` is `22px` / weight `800` / `letter-spacing:-.02em` (mobile: `19px`), and `.wm i` stays brand red with `font-style:normal`.
- The mark tile keeps the red rounded square from the reference and holds the shark glyph (exported from the logo) instead of the letter `O`.
- Never render the wordmark as one colour — the navy/red split **is** the brand.
- The footer logo, mobile header logo, and any admin sidebar logo all reuse this one component. No second logo implementation.

---

## 2. Reference Design — The Sacred Source of Truth

> [!CAUTION]
> **DO NOT** modify, override, or "improve" the reference design without explicit approval from the project owner. The design has been carefully crafted — your job is to translate it faithfully into production-quality Next.js code.

- **File**: `oshoppingbd.html` in the project root
- **Contains**: All CSS, JavaScript, data structures, i18n system, colors, typography, layout, components, interactions, and animations
- **Rule**: Every frontend page **must** match this design language exactly — same colors, same spacing, same border-radius, same shadows, same hover effects, same animations
- **How to use it**: Open it in a browser. Inspect every element. Understand every CSS custom property. Read every JavaScript function. This is your specification.

### 2.1 This file is a specification, not the product

`oshoppingbd.html` is a **single-file prototype**: one HTML document, one `<style>` block, one `<script>` block, hash-based routing, a mutable global state object, and generated demo data. **None of that is shipped.**

The deliverable is a **Next.js application** that reproduces it:

| Prototype | Production |
| --- | --- |
| Hash routes (`#/category/fashion`) | File routes (`/category/fashion`) |
| One giant `<style>` block | Tailwind tokens + component styles |
| `const T = {en, bn}` in one script | i18n module with typed keys |
| Global mutable `st` object | Zustand stores + server state |
| `P` generated from `CATS` | Database + API |
| `innerHTML` template strings | React Server/Client Components |
| Emoji as product art | Real image pipeline |

**Port the behaviour and the visual values. Do not port the architecture.**

### 2.2 The one sanctioned deviation: the brand name

The reference still says **OShoppingBD** and renders an `O` mark with a `ShoppingBD` wordmark. That is the **old brand**, and it is the *only* thing you are allowed to change.

| Element | Reference | Ship this |
| --- | --- | --- |
| Wordmark | `Shopping` + red `BD` | `Shark` + red `Mart` |
| Mark | Red tile with letter `O` | Red tile with the shark glyph |
| Name in copy, titles, meta, aria-labels | OShoppingBD | SharkMart |
| Domain | `oshoppingbd.com` | `sharkmart.com.bd` |

Everything else — every colour, radius, shadow, gap, breakpoint, animation, and layout — stays byte-identical to the reference. **The brand swap is not a licence to redesign.**

> [!NOTE]
> Do **not** edit `oshoppingbd.html` to change the brand. The file stays frozen as the visual oracle. Override the brand at the component/i18n layer, and treat every `OShoppingBD` string in that file as "SharkMart" when you read it.

---

## 3. Design System

Everything below is **extracted directly from the HTML reference file**. Use these exact values.

### 3.1 Color Palette

Defined as CSS custom properties in the reference. Map these to your Tailwind config.

```
--red:    #C51F4B    →  Primary brand color
--red-d:  #a3163c    →  Primary dark / hover state
--pink:   #F7DCE4    →  Soft pink / accent backgrounds
--navy:   #253858    →  Dark navy / primary text color
--white:  #fff       →  White
--bg:     #fbf8f9    →  Page background (warm off-white)
--line:   #eee5e8    →  Borders and dividers
--muted:  #667590    →  Secondary / muted text
--ok:     #1f8a5b    →  Success green (stock, confirmation)
```

#### Shadows

```
--sh:   0 6px 24px rgba(37, 56, 88, 0.08)     →  Light shadow (cards, dropdowns)
--sh2:  0 14px 40px rgba(37, 56, 88, 0.16)     →  Heavy shadow (modals, hover lift)
```

#### Border Radius

```
--r:  14px    →  Base border-radius for cards, buttons, inputs
```

> [!IMPORTANT]
> These values define the entire visual personality of SharkMart. Do not use arbitrary Tailwind defaults like `rounded-lg` or `shadow-md` — map these exact tokens into your Tailwind configuration.

### 3.2 Typography

| Purpose         | Font Family          | Notes                                      |
| --------------- | -------------------- | ------------------------------------------ |
| English text    | `Plus Jakarta Sans`  | Primary typeface for all English content   |
| Bangla text     | `Hind Siliguri`      | Used when `body.bn` class is active        |
| System fallback | `system-ui, sans-serif` | Final fallback                          |

**Font stack (default / English mode):**
```css
font-family: 'Plus Jakarta Sans', 'Hind Siliguri', system-ui, sans-serif;
```

**Font stack (Bangla mode — when `body` has class `bn`):**
```css
font-family: 'Hind Siliguri', 'Plus Jakarta Sans', system-ui, sans-serif;
```

**Bangla-specific adjustments:**
- Headings in Bangla mode use `line-height: 1.25` (see `body.bn .h-sl h2` in CSS)
- Ensure Bangla text doesn't overflow containers — Bangla glyphs are wider

### 3.3 Category Supporting Colors

Each of the 14 product categories has a unique **accent color** and **light tint** for backgrounds. These are used in category cards, category landing pages, and promotional elements.

| Category                        | Accent    | Light Tint |
| ------------------------------- | --------- | ---------- |
| Fashion                         | `#D9B99B` | `#F4E9DD`  |
| Kids & Baby                     | `#E9A9BC` | `#FBEAF0`  |
| Beauty & Care                   | `#D8B6C6` | `#F5EAF0`  |
| Perfumes & Fragrance            | `#B89A72` | `#F1E9DB`  |
| Gadgets & Electronics           | `#6386B6` | `#E7EFF9`  |
| Herbal & Natural                | `#668B55` | `#E8F0E3`  |
| Home & Kitchen                  | `#B89A7A` | `#F0E7DD`  |
| Food & Grocery                  | `#D9A441` | `#FBF0D9`  |
| Books & Education               | `#6C82A0` | `#E9EEF5`  |
| Automotive & Motorbike          | `#58616C` | `#E9ECEF`  |
| Sports, Fitness & Outdoors      | `#3C8A70` | `#E1F1EA`  |
| Pet Supplies                    | `#C9956B` | `#F7EADF`  |
| Office & Business Supplies      | `#687C91` | `#E8EDF3`  |
| Garden & Plants                 | `#4F8050` | `#E5F0E2`  |

> [!TIP]
> Store these as a typed constant map (e.g., `CATEGORY_COLORS`) in `lib/constants.ts` so components can look up colors by category slug.

---

## 4. Technology Stack

| Layer              | Technology                        | Notes                                                          |
| ------------------ | --------------------------------- | -------------------------------------------------------------- |
| **Framework**      | Next.js (App Router)              | Latest stable version. Use Server Components by default.       |
| **Language**       | TypeScript                        | Strict mode enabled. No `any` types.                           |
| **Styling**        | Tailwind CSS v4                   | Map ALL design tokens from HTML reference into Tailwind config |
| **State Mgmt**     | Zustand                           | For cart, wishlist, UI state (drawer open, language, etc.)      |
| **Server Data**    | React Server Components           | Primary data fetching mechanism                                |
| **Client Mutations** | React Query (TanStack Query)   | For add-to-cart, wishlist toggle, form submissions              |
| **Animation**      | Framer Motion                     | Lightweight usage only. Respect `prefers-reduced-motion`.      |
| **i18n**           | next-intl or custom               | Must match the `T{}` object structure from the HTML reference  |
| **Images**         | Next.js `<Image>` component       | With proper `sizes`, `srcSet`, priority for above-fold         |
| **Icons**          | Lucide React                      | Match the SVG icons used in the HTML reference                 |

> [!WARNING]
> Do **not** introduce additional UI libraries (Material UI, Ant Design, Chakra, etc.) or animation libraries (GSAP, anime.js) without explicit approval. Keep the bundle lean.

---

## 5. Architecture Rules

These are non-negotiable. Every agent working on this project must follow them.

### Rule 1: Server Components First
Default to React Server Components. Only add `'use client'` when the component genuinely needs:
- Event handlers (`onClick`, `onChange`, etc.)
- Browser APIs (`window`, `localStorage`, `IntersectionObserver`)
- React hooks (`useState`, `useEffect`, `useRef`, etc.)
- Third-party client-only libraries

### Rule 2: Proper Route Structure
The HTML reference uses hash-based navigation (`#home`, `#fashion`, etc.). In Next.js, convert these to proper file-based routes:
- `#home` → `/`
- `#fashion` → `/category/fashion`
- `#product-detail` → `/product/[slug]`

### Rule 3: No Hardcoded Product Data
All product data comes from the API layer. Never embed product arrays in component files. Use typed API response interfaces and fetch functions in `lib/api/`.

### Rule 4: Pixel-Perfect Homepage
The homepage must be visually indistinguishable from the HTML reference when viewed side-by-side. Same spacing, same proportions, same visual rhythm.

### Rule 5: Mobile-First Responsive Design
Build mobile layout first, then progressively enhance for larger screens. Breakpoints from the HTML reference:

| Breakpoint | Width     | Description            |
| ---------- | --------- | ---------------------- |
| `sm`       | `760px`   | Small tablets           |
| `md`       | `820px`   | Tablets / small laptops |
| `lg`       | `1024px`  | Laptops                 |
| `xl`       | `1200px`  | Desktops                |

### Rule 6: Handle All States
Every component must handle these states:
- **Loading** — Skeleton or spinner while data loads
- **Empty** — Meaningful empty state (not just blank space)
- **Error** — User-friendly error message with retry option
- **Success** — The normal, data-populated view

### Rule 7: Accessibility (a11y)
- All interactive elements must have ARIA labels
- Focus states must be visible (not just outlines — styled focus rings)
- Full keyboard navigation support (Tab, Enter, Escape, Arrow keys where applicable)
- Screen reader compatibility (semantic HTML, `aria-live` for dynamic content)
- `prefers-reduced-motion`: disable ALL animations and transitions

---

## 6. Page Structure — What to Build

### 6.1 Homepage

**Route**: `/`
**Reference**: Match `oshoppingbd.html` exactly.

Sections in order (top to bottom):

1. **Preview Strip** — Developer-only notice bar (removable in production)
2. **Top Bar** — Navy background, utility links (Track Order, Help, etc.)
3. **Sticky Header** — Logo, search bar with autocomplete, action icons (language toggle, wishlist, cart with count badge)
4. **Navigation Bar** — "All Categories" mega menu trigger, main nav links, "More" dropdown
5. **Hero Banner Slider** — 4 slides, auto-rotate (5s interval), swipe on mobile, dot indicators, prev/next arrows
6. **Trust Badges** — 4-item horizontal strip (Free Delivery, Genuine Products, Easy Returns, Secure Payment)
7. **Our Brands Carousel** — 9 proprietary brands, horizontal scroll with arrow buttons
8. **Shop by Brand Carousel** — External/partner brands
9. **Flash Sale Section** — Countdown timer (days:hours:minutes:seconds), product cards with sold-progress bars
10. **All Categories Grid** — 14 category cards with icons, names (bilingual), accent colors
11. **New Arrivals Carousel** — Latest products
12. **Promotional Banners** — 3-column grid of promotional images/cards
13. **Best Sellers Carousel** — Top-selling products
14. **Only for You Section** — Personalized recommendations
15. **Trending Section** — Currently popular products
16. **Featured Section** — Editorially curated products
17. **Recommended Section** — Algorithm-driven suggestions
18. **Recently Viewed Products** — From localStorage/session
19. **Newsletter Signup** — Email input with subscribe button
20. **Footer** — 5-column grid (Company, Shop, Help, Account, Connect), payment method icons, copyright

### 6.2 Category Landing Pages (×14)

**Route**: `/category/[slug]`
**Slugs** (copied from the `CATS` array in `oshoppingbd.html` — do not retype from memory): `fashion`, `kids-baby`, `beauty-care`, `perfumes-fragrance`, `gadgets-electronics`, `herbal-natural`, `home-kitchen`, `food-grocery`, `books-education`, `automotive-motorbike`, `sports-fitness-outdoors`, `pet-supplies`, `office-business`, `garden-plants`

Each page includes:
- **Breadcrumb** — Home → Category Name
- **Category Hero Banner** — Full-width with category icon, name, description, accent color background
- **Subcategory Chips** — Horizontally scrollable filter chips
- **Promotional Offers** — 3-column grid on desktop, carousel on mobile
- **Filter Panel** — Sidebar on desktop (collapsible), bottom sheet on mobile
  - Price range (slider + inputs)
  - Brand checkboxes
  - Rating filter
  - Availability toggle
  - Discount filter
  - Subcategory filter
- **Product Grid** — Responsive grid with sort dropdown (Relevance, Price Low→High, Price High→Low, Newest, Best Selling, Rating)
- **Load More Pagination** — "Load More" button (not traditional pagination)

### 6.3 Product Detail Page

**Route**: `/product/[slug]`

Layout sections:

**Above the Fold:**
- **Image Gallery** — Main image + thumbnail strip. Click thumbnail to switch. Zoom on hover (desktop). Lightbox on click. Swipe carousel on mobile.
- **Video Section** — Product video player (if available)
- **Product Info Block:**
  - Brand name (linked to brand page)
  - Product name (bilingual)
  - SKU number
  - Star rating + review count
  - Price display: original price (strikethrough if discounted), sale price, discount percentage badge
  - Stock status (In Stock / Low Stock / Out of Stock) with color coding
- **Variant Selector** — Size buttons, color swatches (visual), other variant types as needed
- **Action Buttons:**
  - Quantity selector (−/+) with direct input
  - "Add to Cart" button
  - "Buy Now" button
- **Utility Actions** — Share (social), Copy Link, Add to Wishlist (heart icon)
- **Delivery Estimator** — Location input → estimated delivery date
- **Coupons / Offers Display** — Available coupon codes with copy button
- **Policy Icons** — Return policy, Genuine product guarantee, Cash on Delivery available

**Below the Fold (Tabbed Content):**
- Description (rich HTML)
- Features (bullet list)
- Specifications (key-value table)
- How to Use (instructions)
- Size Guide (if applicable — table or image)
- Delivery & Returns (policy details)
- FAQ (accordion)

**Social Proof:**
- **Reviews & Ratings Section:**
  - Overall rating (large number + stars)
  - Rating breakdown bar chart (5★ to 1★)
  - Individual review cards (user name, date, rating, text, helpful count)
  - Write a Review button (opens modal)
  - Sort reviews: Most Recent, Most Helpful, Highest Rating, Lowest Rating

**Cross-Sell Sections:**
- Frequently Bought Together (bundle with combined price)
- Related Products carousel
- Similar Products carousel
- Customers Also Viewed carousel

### 6.4 Shopping Cart Drawer

**Trigger**: Click cart icon in header or "Add to Cart" button
**Type**: Side drawer (slides from right)

Specifications:
- **Width**: 440px on desktop, full-width on mobile
- **Overlay**: Semi-transparent backdrop with blur effect
- **Animation**: Smooth slide-in/out (respect reduced motion)
- **Contents:**
  - Header: "Your Cart" title + item count + close button
  - **Free Delivery Progress Bar**: Threshold is ৳2,000. Shows "You're ৳X away from free delivery!" with animated progress bar
  - **Cart Items List**: Each item shows:
    - Product image (thumbnail)
    - Product name
    - Selected variant (size, color)
    - Unit price
    - Quantity controls (−/+) with `.bump` animation on change
    - Line total
    - Remove button
  - **Related Products**: "You May Also Like" mini carousel inside the drawer
  - **Order Summary:**
    - Subtotal
    - Discount (if coupon applied)
    - Estimated delivery fee
    - **Total** (bold, larger)
  - **Checkout Button**: Full-width primary button
- **Empty State**: Illustration + "Your cart is empty" message + "Continue Shopping" button
- **Toast Notification**: When adding to cart, show a toast confirming the action

### 6.5 Search Results Page

**Route**: `/search?q=[query]`

- Search query displayed at top
- Result count
- Filter sidebar (same as category page)
- Product grid with sort
- "No results" state with:
  - Spelling suggestions
  - Popular products
  - Category links

### 6.6 Wishlist Page

**Route**: `/wishlist`

- Grid of wishlisted products (ProductCard with remove-from-wishlist action)
- "Move to Cart" action per item
- Empty state with CTA to browse products
- Persist wishlist in localStorage for guests, server-side for logged-in users

### 6.7 Customer Account Pages

| Route                 | Page                | Features                                                    |
| --------------------- | ------------------- | ----------------------------------------------------------- |
| `/login`              | Login               | Email/phone + password, social login buttons, forgot password link |
| `/register`           | Registration        | Name, email, phone, password, terms checkbox                |
| `/profile`            | Profile             | View/edit personal info, change password, profile photo     |
| `/orders`             | Order History       | List of orders with status badges, date, total              |
| `/orders/[id]`        | Order Detail        | Timeline tracker, items, shipping info, invoice download    |
| `/profile/addresses`  | Address Book        | CRUD for delivery addresses, set default                    |

### 6.8 Checkout Flow

**Route**: `/checkout`

Multi-step (single page with step indicator):
1. **Delivery Address** — Select saved address or add new (Name, Phone, Division, District, Area, Address Line, Landmark)
2. **Delivery Method** — Standard / Express with estimated dates and costs
3. **Payment Method** — Cash on Delivery, bKash, Nagad, Card (SSL Commerz), Bank Transfer
4. **Order Review & Confirmation** — Summary of items, address, delivery, payment, total. Place Order button.

Post-order: Redirect to order confirmation page with order number and tracking info.

### 6.9 Static Pages

| Route             | Page           |
| ----------------- | -------------- |
| `/about`          | About Us       |
| `/contact`        | Contact Us     |
| `/help`           | Help / FAQ     |
| `/privacy`        | Privacy Policy |
| `/terms`          | Terms of Service |
| `/return-policy`  | Return Policy  |

### 6.10 Brand Landing Pages

| Route              | Page                    |
| ------------------ | ----------------------- |
| `/brands`          | All Brands directory    |
| `/brand/[slug]`    | Individual brand page — hero, description, products grid |

---

## 7. Component Library

Extract and create reusable components matching the classes and structures from the HTML reference.

### Core Components

| Component            | HTML Class  | Description                                                                 |
| -------------------- | ----------- | --------------------------------------------------------------------------- |
| `ProductCard`        | `.pc`       | Image, badge (New/Sale/%), wishlist heart, brand, name, rating stars, price (original + sale), stock indicator, add-to-cart button |
| `Carousel`           | `.car`      | Horizontal drag-scroll container, left/right arrow buttons, responsive items-per-view, smooth scrolling |
| `CategoryCard`       | `.cc`       | Category icon, name (bilingual), accent color background/border             |
| `BrandTile`          | `.bt`       | Brand logo image in a styled container                                      |
| `FlashSaleCard`      | extends `ProductCard` | Adds countdown urgency + "X sold" progress bar                   |
| `MiniProductCard`    | `.mini`     | Compact card for cart drawer recommendations — image, name, price           |
| `HeroBanner`         | `.hero`     | Full-width slider with dot indicators, prev/next arrows, auto-rotate, swipe |
| `MegaMenu`           | `.mega`     | Category mega dropdown with subcategories in columns, category icons        |
| `CartDrawer`         | `#drawer`   | Side-sliding drawer with all cart functionality (see Section 10)            |
| `QuickViewModal`     | `.mo`       | Product quick-view modal overlay with essential product info                |
| `Toast`              | `.toast`    | Notification toast — slides in from top-right, auto-dismisses              |
| `SearchSuggestions`  | `.sug`      | Autocomplete dropdown under search bar — categories, trending, recent, products |
| `BottomNav`          | `.bnav`     | Mobile-only bottom navigation bar (5 items)                                 |
| `MobileSheet`        | `.msheet`   | Bottom sheet overlay for mobile (categories, filters)                       |
| `FloatingButtons`    | `.fl`       | Floating action buttons (scroll-to-top, WhatsApp chat)                      |
| `PromoCard`          | `.pb`       | Promotional banner card with image and CTA                                  |
| `TrustBadge`         | `.trust`    | Icon + text badge for trust signals                                         |

### Component Quality Checklist

Every component you build must satisfy:

- [ ] Handles loading state (skeleton/spinner)
- [ ] Handles empty state (no data)
- [ ] Handles error state (fetch failure)
- [ ] Responsive (mobile → desktop)
- [ ] Keyboard accessible
- [ ] Has ARIA labels where needed
- [ ] Respects `prefers-reduced-motion`
- [ ] Works in both Bangla and English
- [ ] Has TypeScript props interface
- [ ] No hardcoded strings (use i18n)
- [ ] No hardcoded colors (use design tokens)

---

## 8. Button Design Rules

Extracted from the HTML reference. Follow these exactly.

### Button Variants

| Variant       | HTML Class    | Background      | Text Color | Border            | Shape        |
| ------------- | ------------- | --------------- | ---------- | ----------------- | ------------ |
| **Primary**   | `.btn.red`    | `--red`         | White      | None              | Pill (full radius) |
| **Outline**   | `.btn.line`   | Transparent     | `--red`    | `1px solid --red` | Pill         |
| **Add to Cart** | `.btn-add`  | White           | `--navy`   | Subtle red border | Rounded      |

### Button States

| State        | Effect                                                   |
| ------------ | -------------------------------------------------------- |
| **Normal**   | Base styling                                             |
| **Hover**    | `translateY(-2px)` + box-shadow elevation                |
| **Active**   | `scale(0.97)` — subtle press-down effect                 |
| **Loading**  | Spinner replaces text, button disabled                   |
| **Success**  | Briefly turns green (`--ok`) with checkmark              |
| **Disabled** | `opacity: 0.5`, `pointer-events: none`                  |

### Add to Cart Button Special Behavior

- **Default**: White bg, subtle red border, navy text
- **Hover**: Background transitions to `--pink` (soft pink)
- **On click**: Shows loading spinner → success checkmark → reverts to default

---

## 9. Mobile Navigation & Responsive Behavior

### Bottom Navigation Bar (Mobile Only — below 760px)

5-item fixed bottom bar:

| Position | Icon    | Label      | Action                              |
| -------- | ------- | ---------- | ----------------------------------- |
| 1        | Home    | Home       | Navigate to `/`                     |
| 2        | Grid    | Categories | Opens bottom sheet (`.msheet`) with 3-column category grid |
| 3        | Search  | Search     | Opens full-screen search overlay    |
| 4        | Heart   | Wishlist   | Navigate to `/wishlist`             |
| 5        | User    | Account    | Navigate to `/login` or `/profile`  |

### Mobile Header (below 760px)

- Simplified logo (smaller)
- Language toggle (EN / বাং pill buttons)
- Wishlist icon (heart)
- Cart icon (with count badge)
- Search bar (below logo row)

### Desktop Elements Hidden on Mobile

- Top bar (utility links)
- Full header with large search
- Navigation bar with mega menu
- These are hidden below `760px` and replaced by mobile header + bottom nav

### Product Page Mobile Specifics

- Sticky action buttons at bottom of viewport
- Positioned `64px` above the bottom nav bar
- Contains: Add to Cart + Buy Now buttons

---

## 10. Cart Behavior

### Drawer Specifications

| Property          | Value                                      |
| ----------------- | ------------------------------------------ |
| Width (desktop)   | `440px`                                    |
| Width (mobile)    | `100vw` (full screen)                      |
| Slide direction   | From right                                 |
| Overlay           | Semi-transparent with `backdrop-filter: blur` |
| Z-index           | Above all content, below modals            |

### Free Delivery Logic

- **Threshold**: ৳2,000
- When cart total < ৳2,000: Show "You're ৳X away from free delivery!" with progress bar
- When cart total ≥ ৳2,000: Show "🎉 You've unlocked free delivery!" with full progress bar (green)
- Progress bar animates on cart total change

### Quantity Button Animation

The HTML reference defines a `.bump` keyframe animation:
- When user clicks +/−, the quantity number does a quick scale-up-then-back animation
- Implement with Framer Motion or CSS keyframes

### Add to Cart Flow

1. User clicks "Add to Cart" on any ProductCard or Product Detail page
2. Item is added to Zustand cart store
3. Cart icon in header updates count (with a small bounce animation)
4. Toast notification appears: "Product added to cart" with product thumbnail
5. Cart drawer does **not** auto-open (user opens manually by clicking cart icon)

---

## 11. Search System

### Autocomplete Dropdown (`.sug`)

When user types in the search bar, show a dropdown with:
1. **Category Matches** — If query matches a category name, show it with icon
2. **Trending Searches** — Pre-populated popular search terms
3. **Recent Searches** — User's previous searches (from localStorage)
4. **Product Suggestions** — Matching products with thumbnail, name, price

### Bilingual Search

- Search must work in both Bangla and English
- If user types in Bangla, match against Bangla product names
- If user types in English, match against English product names
- Cross-language results are acceptable (searching English shows products with Bangla names too)

### No Results State

When search returns zero results, show:
- "No products found for '[query]'" message
- Spelling/suggestion hints
- Popular products carousel
- Category quick links

---

## 12. Internationalization (i18n)

### System Design

The HTML reference uses a `T{}` JavaScript object for all translatable strings. Mirror this structure:

```typescript
// Example structure (from HTML reference)
const T = {
  en: {
    home: "Home",
    all_categories: "All Categories",
    search_placeholder: "Search for products...",
    add_to_cart: "Add to Cart",
    buy_now: "Buy Now",
    free_delivery: "Free Delivery",
    // ... hundreds more keys
  },
  bn: {
    home: "হোম",
    all_categories: "সকল ক্যাটাগরি",
    search_placeholder: "পণ্য খুঁজুন...",
    add_to_cart: "কার্টে যোগ করুন",
    buy_now: "এখনই কিনুন",
    free_delivery: "ফ্রি ডেলিভারি",
    // ... hundreds more keys
  }
};
```

### Language Toggle

- **UI Element**: Pill-shaped toggle buttons showing "EN" and "বাং"
- **Location**: Header (desktop), mobile header
- **Behavior**: Switching language instantly updates all UI text without page reload
- **Persistence**: Store language preference in localStorage + cookie (for SSR)

### Rules for i18n

1. **No hardcoded strings** in any component. Every user-visible string must go through the translation system.
2. **Product data** is bilingual from the API — each product has `name_en`, `name_bn`, `description_en`, `description_bn`, etc.
3. **Category names** are bilingual — stored in constants with both languages.
4. **Number formatting**: Use Bangla numerals (০১২৩৪৫৬৭৮৯) in Bangla mode if the reference does so. Otherwise, use standard numerals with proper thousand separators.
5. **Currency**: Always `৳` (Taka symbol) in both languages.
6. **Date formatting**: Bangla mode may use Bangla month names if the reference does so.
7. **Body class**: When Bangla is active, add class `bn` to `<body>` to trigger font-family swap and line-height adjustments.

---

## 13. Performance Requirements

### Core Web Vitals Targets

| Metric | Target    | What It Measures                      |
| ------ | --------- | ------------------------------------- |
| LCP    | < 2.5s    | Largest Contentful Paint              |
| INP    | < 200ms   | Interaction to Next Paint             |
| CLS    | < 0.1     | Cumulative Layout Shift               |

### Optimization Strategies

1. **Image Optimization**
   - Use Next.js `<Image>` component everywhere — no raw `<img>` tags
   - Set proper `sizes` attribute for responsive images
   - Use `priority` prop for above-the-fold hero images
   - Lazy load all images below the fold
   - Use WebP/AVIF formats via Next.js automatic optimization

2. **Code Splitting**
   - Each route is automatically code-split by Next.js
   - Use `dynamic()` imports for heavy components (modals, rich editors, charts)
   - Don't import entire icon libraries — tree-shake individual icons

3. **Prefetching**
   - Next.js `<Link>` automatically prefetches visible links
   - Manually prefetch critical routes (homepage → category pages)

4. **JavaScript Budget**
   - Keep client-side JS minimal
   - Server Components for all data display
   - Client Components only for interactivity

5. **Font Loading**
   - Use `next/font` for both Plus Jakarta Sans and Hind Siliguri
   - `display: swap` to prevent FOIT (Flash of Invisible Text)
   - Preload the primary font

6. **Animation Performance**
   - Use CSS transforms and opacity only (GPU-accelerated)
   - No layout-triggering animations (no animating width, height, top, left)
   - `prefers-reduced-motion: reduce` → disable ALL animations and transitions

---

## 14. SEO Requirements

### URL Structure

- SEO-friendly slugs: `/category/fashion`, `/product/cotton-panjabi-1001`
- No query parameters for primary content (use path segments)
- Lowercase, hyphenated slugs

### Meta Tags (per page)

```tsx
// Example for a product page
export async function generateMetadata({ params }): Promise<Metadata> {
  const product = await getProduct(params.slug);
  return {
    title: `${product.name} | SharkMart`,
    description: product.shortDescription,
    openGraph: {
      title: product.name,
      description: product.shortDescription,
      images: [{ url: product.mainImage, width: 1200, height: 630 }],
      type: 'product',
    },
    twitter: {
      card: 'summary_large_image',
      title: product.name,
      description: product.shortDescription,
      images: [product.mainImage],
    },
  };
}
```

### Structured Data (JSON-LD)

Implement for:
- **Product** — on product detail pages (name, price, availability, rating, brand, SKU, image)
- **BreadcrumbList** — on all pages with breadcrumbs
- **Organization** — on homepage (logo, name, URL, social profiles)
- **WebSite** — on homepage (search action for sitelinks search box)
- **ItemList** — on category pages (list of products)

### Technical SEO

- **XML Sitemap**: Auto-generated at `/sitemap.xml` using Next.js `sitemap.ts`
- **robots.txt**: At `/robots.txt` using Next.js `robots.ts`
- **Canonical URLs**: Every page has a canonical URL
- **hreflang**: `<link rel="alternate" hreflang="bn" href="..." />` and `hreflang="en"`
- **Alt text**: Every `<Image>` has descriptive alt text (bilingual)

---

## 15. Analytics Integration

### Google Analytics 4

Track these events:
- `page_view` — automatic with Next.js router
- `view_item` — product detail page view
- `view_item_list` — category page view
- `add_to_cart` — with item data
- `remove_from_cart`
- `begin_checkout`
- `purchase` — with transaction data
- `search` — with search term
- `select_content` — banner clicks, category clicks

### Meta (Facebook) Pixel

Track these standard events:
- `PageView` — every page
- `ViewContent` — product detail page
- `AddToCart` — with content_ids, value, currency
- `InitiateCheckout`
- `Purchase` — with value, currency, content_ids
- `Search` — with search_string

### Google Tag Manager

- Install GTM container in the `<head>` via Next.js Script component
- All custom events fire through the GTM data layer
- Use `next/script` with `strategy="afterInteractive"`

### Event Deduplication

- Generate a unique `event_id` for each `Purchase` event
- Send the same `event_id` to both GA4 and Meta Pixel
- This prevents double-counting conversions from server-side + client-side tracking

> [!NOTE]
> Analytics scripts must not block page rendering. Use `next/script` with appropriate loading strategies (`afterInteractive` or `lazyOnload`).

---

## 16. Client-Side Hardening (never authorization)

> [!CAUTION]
> The browser never authorizes anything. Hiding a button is UX, not access
> control. Every permission check, ownership check, price calculation and
> stock decision happens on the server. If a client-side guard is the only
> thing stopping an action, the feature is broken.

Full implementation guide: `prompts/security.md`.

### Environment Variables
- **Never** expose API keys, secrets, or internal URLs in client-side code
- Only `NEXT_PUBLIC_` prefixed variables are accessible in the browser
- Server-only secrets go in `.env.local` without the `NEXT_PUBLIC_` prefix
- The server owns every secret; the client receives only values already safe to publish.

### Authentication
- Auth tokens stored in **HttpOnly cookies** (not localStorage)
- Cookies set with `Secure`, `SameSite=Strict` flags
- Token refresh handled transparently by API middleware
- The client never reads or writes the token; it only relies on the server having set it. The flag values are a server decision, and `prompts/security.md` section 4 supersedes `SameSite=Strict` with `Lax` so the external payment return still carries the session.

### CSRF Protection
- Include CSRF tokens on all form submissions and state-changing requests
- Token provided by the backend, included as a hidden field or header
- The server issues and verifies the token; the client only echoes what it was given.

### XSS Prevention
- Sanitize all user-generated content before rendering
- Use React's built-in JSX escaping (don't use `dangerouslySetInnerHTML` unless absolutely necessary, and sanitize with DOMPurify if you must)
- Validate and sanitize search queries, form inputs, URL parameters
- The server sanitizes on write and is the authority on what is stored; client escaping is defence in depth, not the control.

### Content Security Policy
- Configure CSP headers in `next.config.js` or middleware
- Restrict script sources, style sources, image sources
- Report CSP violations to a logging endpoint
- The server sends the policy; the client cannot weaken or override it.

### What belongs on each side

| Do this in the browser | Never do this in the browser |
| --- | --- |
| Render state the server sent | Decide whether the user may act |
| Validate input for fast feedback | Treat that validation as security |
| Show/hide UI by permission flag | Treat hiding as enforcement |
| Compute a display total | Send a total the server trusts |

---

## 17. File Structure Convention

```
src/
├── app/
│   ├── (shop)/                             # Main shopping routes (shared layout)
│   │   ├── page.tsx                        # Homepage
│   │   ├── category/[slug]/page.tsx        # Category landing pages
│   │   ├── product/[slug]/page.tsx         # Product detail page
│   │   ├── search/page.tsx                 # Search results
│   │   ├── brands/page.tsx                 # All brands directory
│   │   ├── brand/[slug]/page.tsx           # Individual brand page
│   │   ├── flash-sale/page.tsx             # Flash sale dedicated page
│   │   ├── wishlist/page.tsx               # Wishlist
│   │   ├── cart/page.tsx                   # Full cart page (alternative to drawer)
│   │   └── checkout/page.tsx               # Checkout flow
│   │
│   ├── (account)/                          # Account routes (shared auth layout)
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   ├── profile/page.tsx
│   │   ├── orders/page.tsx
│   │   └── orders/[id]/page.tsx
│   │
│   ├── (info)/                             # Static/informational pages
│   │   ├── about/page.tsx
│   │   ├── contact/page.tsx
│   │   ├── privacy/page.tsx
│   │   ├── terms/page.tsx
│   │   └── return-policy/page.tsx
│   │
│   ├── layout.tsx                          # Root layout (fonts, providers, analytics)
│   └── globals.css                         # Global styles, Tailwind imports, CSS variables
│
├── components/
│   ├── ui/                                 # Base UI primitives
│   │   ├── button.tsx                      # Button with all variants and states
│   │   ├── input.tsx                       # Text input, search input
│   │   ├── badge.tsx                       # Status badges, count badges
│   │   ├── skeleton.tsx                    # Loading skeletons
│   │   ├── spinner.tsx                     # Loading spinner
│   │   └── ...
│   │
│   ├── layout/                             # App-wide layout components
│   │   ├── header.tsx                      # Desktop header (top bar + main header + nav)
│   │   ├── mobile-header.tsx               # Mobile header
│   │   ├── footer.tsx                      # Site footer
│   │   ├── bottom-nav.tsx                  # Mobile bottom navigation
│   │   ├── mega-menu.tsx                   # Category mega menu dropdown
│   │   └── floating-buttons.tsx            # Scroll-to-top, WhatsApp
│   │
│   ├── product/                            # Product-related components
│   │   ├── product-card.tsx                # Standard product card
│   │   ├── flash-sale-card.tsx             # Product card with sold progress bar
│   │   ├── mini-product-card.tsx           # Compact card for cart drawer
│   │   ├── product-gallery.tsx             # Image gallery with zoom + lightbox
│   │   ├── variant-selector.tsx            # Size/color/variant picker
│   │   ├── rating-stars.tsx                # Star rating display
│   │   ├── price-display.tsx               # Price with original/sale/discount
│   │   └── review-card.tsx                 # Individual review display
│   │
│   ├── cart/                               # Cart components
│   │   ├── cart-drawer.tsx                  # Side drawer cart
│   │   ├── cart-item.tsx                    # Single cart item row
│   │   ├── delivery-progress.tsx           # Free delivery progress bar
│   │   └── cart-summary.tsx                # Subtotal, discounts, total
│   │
│   ├── home/                               # Homepage-specific sections
│   │   ├── hero-banner.tsx                 # Hero slider
│   │   ├── trust-badges.tsx                # Trust signal strip
│   │   ├── brand-carousel.tsx              # Brand tiles carousel
│   │   ├── flash-sale-section.tsx          # Flash sale with countdown
│   │   ├── category-grid.tsx               # All categories grid
│   │   ├── product-section.tsx             # Reusable product carousel section
│   │   ├── promo-banners.tsx               # Promotional banner grid
│   │   └── newsletter.tsx                  # Newsletter signup
│   │
│   └── shared/                             # Shared/utility components
│       ├── carousel.tsx                    # Generic horizontal carousel
│       ├── search-bar.tsx                  # Search input with autocomplete
│       ├── search-suggestions.tsx          # Autocomplete dropdown
│       ├── toast.tsx                        # Toast notifications
│       ├── modal.tsx                        # Generic modal/dialog
│       ├── mobile-sheet.tsx                # Bottom sheet (mobile)
│       ├── breadcrumb.tsx                  # Breadcrumb navigation
│       ├── language-toggle.tsx             # EN/বাং switcher
│       ├── countdown-timer.tsx             # Flash sale countdown
│       └── empty-state.tsx                 # Reusable empty state
│
├── lib/
│   ├── api/                                # API client layer
│   │   ├── client.ts                       # Base fetch wrapper with error handling
│   │   ├── products.ts                     # Product API functions
│   │   ├── categories.ts                   # Category API functions
│   │   ├── cart.ts                          # Cart API functions
│   │   ├── auth.ts                         # Auth API functions
│   │   ├── orders.ts                       # Order API functions
│   │   └── search.ts                       # Search API functions
│   │
│   ├── store/                              # Zustand stores
│   │   ├── cart-store.ts                   # Cart state (items, add, remove, update qty)
│   │   ├── wishlist-store.ts               # Wishlist state
│   │   ├── ui-store.ts                     # UI state (drawer open, sheet open, language)
│   │   └── recently-viewed-store.ts        # Recently viewed products
│   │
│   ├── i18n/                               # Internationalization
│   │   ├── translations/
│   │   │   ├── en.ts                       # English strings
│   │   │   └── bn.ts                       # Bangla strings
│   │   ├── config.ts                       # i18n configuration
│   │   └── use-translation.ts              # useTranslation hook
│   │
│   ├── utils.ts                            # Utility functions (formatPrice, slugify, etc.)
│   └── constants.ts                        # Design tokens, category data, config
│
├── types/                                  # TypeScript type definitions
│   ├── product.ts                          # Product, Variant, Review interfaces
│   ├── category.ts                         # Category, Subcategory interfaces
│   ├── cart.ts                             # CartItem, Cart interfaces
│   ├── user.ts                             # User, Address interfaces
│   ├── order.ts                            # Order, OrderItem interfaces
│   └── api.ts                              # API response wrapper types
│
└── public/
    ├── images/                             # Static images (logos, banners, icons)
    │   ├── brands/                         # Brand logos
    │   ├── categories/                     # Category icons
    │   ├── banners/                        # Promotional banners
    │   └── trust/                          # Trust badge icons
    └── fonts/                              # Self-hosted font files (if not using next/font CDN)
```

> [!IMPORTANT]
> Follow this structure exactly. If you need to add new directories or files, they should logically fit within this hierarchy. Do not create flat structures or dump everything in one folder.

---

## 18. Multi-Agent Handoff Rules

> [!CAUTION]
> Multiple AI agents will work on this project sequentially. Follow these rules religiously to avoid conflicts, duplication, and regression.

### Before Starting ANY Work

1. **Read this file** (`prompts/frontend.md`) — you're doing this now ✓
2. **Check git log** — `git log --oneline -20` to see recent changes
3. **Read HANDOFF.md** — if it exists in the project root, it contains the last agent's notes
4. **Read STATUS.md** — if it exists, it tracks what's completed and what's next
5. **Run the dev server** — `npm run dev` and verify the current state in a browser
6. **Run the build** — `npm run build` to check for existing errors

### During Work

1. **Commit frequently** — Small, logical commits with descriptive messages
2. **Update STATUS.md** — After completing each major section/component
3. **Leave comments** — Mark any decisions, compromises, or known issues with `// TODO:` or `// NOTE:`
4. **Don't break existing work** — If you modify a shared component, test all pages that use it

### Before Handing Off

1. **Run `npm run build`** — Must complete with **zero errors**
2. **Test mobile and desktop** — Both viewport sizes must work
3. **Test both languages** — Switch to Bangla, verify nothing breaks
4. **Update HANDOFF.md** — Write a clear summary of:
   - What you completed
   - What's partially done
   - What's not started
   - Any known issues or decisions that need input
   - Specific files you changed
5. **Update STATUS.md** — Mark completed items, add next priorities

### Never Do

- ❌ Duplicate a component that already exists
- ❌ Hardcode product data in components
- ❌ Use inline styles instead of Tailwind classes
- ❌ Skip error/loading/empty states
- ❌ Ignore the HTML reference design
- ❌ Leave the build broken
- ❌ Introduce new dependencies without documenting why
- ❌ Delete or rename files without updating all imports

---

## 19. Agent Working Style & Philosophy

> Think like a **creative senior frontend developer** who cares deeply about craft.

### Don't Just Translate — Understand

Don't mechanically convert HTML to React. Understand **why** each design decision was made:
- The whitespace creates breathing room and visual hierarchy
- The border-radius progression (`14px` base) creates softness and approachability
- The shadow hierarchy (`--sh` vs `--sh2`) creates depth and focus
- The color usage patterns (red for action, navy for text, pink for warmth) create emotional resonance
- The category colors create visual identity and wayfinding

Then rebuild it in Next.js with the **same visual DNA** but better architecture.

### Think in Edge Cases

When building any component, ask yourself:
- What states does this component have? (loading, empty, error, success, disabled)
- What happens on mobile vs desktop?
- What happens with 0 items? 1 item? 100 items? 1000 items?
- What happens when the API is slow (3+ seconds)?
- What happens when the user has slow internet (3G)?
- What happens when the image fails to load?
- Does this work with a screen reader?
- Does this respect `prefers-reduced-motion`?
- Does this work in both Bangla and English without layout breaking?
- What happens when Bangla text is longer than English text (it usually is)?

### Build It Right the First Time

There is no "later." Each phase of work must produce **shippable quality**:
- No placeholder components that "will be filled in later"
- No skipped responsive breakpoints
- No missing hover/focus states
- No `// TODO: add error handling` comments without actually adding error handling
- No components that only work with perfect data

### API Integration Strategy

1. **Phase 1**: Build with **mock data** that matches the expected API response shape exactly
2. **Phase 2**: Replace mock data with real API calls
3. **Always**: Use typed interfaces (`types/*.ts`) so the switch from mock to real is seamless

```typescript
// ✅ Good: Typed mock data
const mockProducts: Product[] = [
  { id: '1', name_en: 'Cotton Panjabi', name_bn: 'সুতি পাঞ্জাবি', price: 1299, ... }
];

// ❌ Bad: Untyped inline data
const products = [{ name: 'Something', price: 100 }];
```

### Commit Message Convention

```
feat(component): Add ProductCard with all states
fix(cart): Fix quantity animation on mobile
style(homepage): Match hero banner spacing to reference
refactor(api): Extract shared fetch wrapper
chore(deps): Add framer-motion for carousel animations
```

---

## Appendix A: Quick Reference — CSS-to-Tailwind Mapping

Use this when converting HTML reference styles to Tailwind classes:

| CSS Property                              | Tailwind Equivalent (configure in theme)    |
| ----------------------------------------- | ------------------------------------------- |
| `color: var(--red)`                       | `text-brand-red`                            |
| `background: var(--bg)`                   | `bg-page`                                   |
| `border: 1px solid var(--line)`           | `border border-line`                        |
| `color: var(--muted)`                     | `text-muted`                                |
| `color: var(--navy)`                      | `text-navy`                                 |
| `border-radius: var(--r)`                 | `rounded-brand` (14px)                      |
| `box-shadow: var(--sh)`                   | `shadow-light`                              |
| `box-shadow: var(--sh2)`                  | `shadow-heavy`                              |
| `background: var(--pink)`                 | `bg-pink`                                   |
| `color: var(--ok)`                        | `text-success`                              |

> [!TIP]
> Define all of these as custom values in `tailwind.config.ts` under `theme.extend`. This way, every developer and agent uses the same token names.

---

## Appendix B: Tailwind Config Skeleton

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          red: '#C51F4B',
          'red-dark': '#a3163c',
        },
        pink: '#F7DCE4',
        navy: '#253858',
        page: '#fbf8f9',
        line: '#eee5e8',
        muted: '#667590',
        success: '#1f8a5b',
      },
      borderRadius: {
        brand: '14px',
      },
      boxShadow: {
        light: '0 6px 24px rgba(37, 56, 88, 0.08)',
        heavy: '0 14px 40px rgba(37, 56, 88, 0.16)',
      },
      fontFamily: {
        sans: ['var(--font-jakarta)', 'var(--font-hind)', 'system-ui', 'sans-serif'],
        bangla: ['var(--font-hind)', 'var(--font-jakarta)', 'system-ui', 'sans-serif'],
      },
      screens: {
        sm: '760px',
        md: '820px',
        lg: '1024px',
        xl: '1200px',
      },
    },
  },
  plugins: [],
};

export default config;
```

---

## Appendix C: Key TypeScript Interfaces (Starting Point)

```typescript
// types/product.ts
export interface Product {
  id: string;
  slug: string;
  name_en: string;
  name_bn: string;
  description_en: string;
  description_bn: string;
  brand: Brand;
  category: CategoryRef;
  price: number;
  originalPrice?: number;
  discountPercent?: number;
  currency: 'BDT';
  images: ProductImage[];
  videos?: ProductVideo[];
  variants?: Variant[];
  rating: number;
  reviewCount: number;
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock';
  stockQuantity?: number;
  sku: string;
  badges?: ('new' | 'sale' | 'bestseller' | 'trending')[];
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductImage {
  id: string;
  url: string;
  alt_en: string;
  alt_bn: string;
  width: number;
  height: number;
  isMain: boolean;
}

export interface Variant {
  id: string;
  type: 'size' | 'color' | 'material' | string;
  label_en: string;
  label_bn: string;
  value: string;
  colorHex?: string;    // For color variants
  imageUrl?: string;    // Variant-specific image
  priceAdjustment?: number;
  stockQuantity: number;
  sku: string;
}

// types/category.ts
export interface Category {
  id: string;
  slug: string;
  name_en: string;
  name_bn: string;
  description_en: string;
  description_bn: string;
  icon: string;          // Lucide icon name or SVG path
  accentColor: string;   // e.g., '#D9B99B'
  lightTint: string;     // e.g., '#F4E9DD'
  subcategories: Subcategory[];
  productCount: number;
}

// types/cart.ts
export interface CartItem {
  product: Product;
  variant?: Variant;
  quantity: number;
  addedAt: string;
}

export interface CartState {
  items: CartItem[];
  addItem: (product: Product, variant?: Variant, quantity?: number) => void;
  removeItem: (productId: string, variantId?: string) => void;
  updateQuantity: (productId: string, variantId: string | undefined, quantity: number) => void;
  clearCart: () => void;
  total: number;
  itemCount: number;
  isFreeDelivery: boolean;
  amountToFreeDelivery: number;
}
```

---

*Last updated: Auto-generated by AI agent. This document is the single source of truth for all frontend development on SharkMart.*
