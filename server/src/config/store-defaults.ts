/**
 * Fallback values for the store's identity and delivery pricing.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * Two packages need the same defaults and cannot import from each other:
 *
 *   `src/lib/brand.ts`      the storefront constant (browser + server components)
 *   this file               the API's fallback when a setting row is absent
 *
 * Duplicating them is unavoidable, so the duplication lives in exactly one place
 * per package and both files say so. The runtime value comes from the `Setting`
 * table (`services/settings.service.ts`); everything here is only what a fresh
 * database renders before anyone has saved a setting.
 *
 * ── Why the delivery numbers moved here ────────────────────────────────────
 *
 * `order.service.ts` used to own them as literals, and `settings.service.ts`
 * needs the same numbers as defaults. Importing `order.service` from
 * `settings.service` while `order.service` imports `settings.service` for the
 * live fee is a cycle — and a cycle in the checkout path is the kind of bug that
 * only appears in production. Both sides import from here instead.
 *
 * The values match AGENTS.md landmine #3 (৳60 flat, free at ৳2,000) and the
 * reference's `totals()`.
 */

export const BRAND_FALLBACK = {
  name: 'SharkMart',
  nameParts: { first: 'Shark', second: 'Mart' },
  tagline: 'Fast Delivery',
  domain: 'sharkmart.com.bd',
  supportEmail: 'support@sharkmart.com.bd',
  phone: '09XX-XXXXXX',
  address: 'Dhaka, Bangladesh',
  logo: { src: '/brand/sharkmart-logo.png' },
} as const;

/** ৳60 flat, free at ৳2,000. */
export const DELIVERY_DEFAULTS = {
  standardFeePoisha: 6_000,
  freeThresholdPoisha: 200_000,
  /** Express is a surcharge on top of the standard charge. */
  expressSurchargePoisha: 10_000,
} as const;
