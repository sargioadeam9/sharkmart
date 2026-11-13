/**
 * Storefront commerce rules.
 *
 * Source: totals() in oshoppingbd.html (line 779)
 *   const del = !st.cart.length ? 0 : sub >= 2000 ? 0 : 60;
 *
 * ── These numbers are now settings, not constants ──────────────────────────
 *
 * The admin panel can change the flat fee and the free-delivery threshold. The
 * server charges from those settings (`deliveryChargeFor` reads them), so the
 * storefront must display from the same values or the cart will quote one price
 * and the order will charge another.
 *
 * Every function here therefore takes `DeliveryRules`, and every caller passes
 * the rules it got from `useStore()`. The defaults below are what a page renders
 * before the settings load, and they match the reference exactly — so a failed
 * read looks like yesterday's site, not a broken one.
 *
 * The server still recomputes every amount at checkout and remains the only
 * authority (AGENTS.md §7.3). This file is display only.
 */

export interface DeliveryRules {
  /** Flat charge below the threshold, in poisha. */
  feePoisha: number;
  /** At or above this subtotal, delivery is free. */
  freeThresholdPoisha: number;
}

/** Free delivery at or above ৳2,000. */
export const FREE_DELIVERY_THRESHOLD_POISHA = 200_000;

/** Flat ৳60 below the threshold. */
export const STANDARD_DELIVERY_FEE_POISHA = 6_000;

export const DEFAULT_DELIVERY_RULES: DeliveryRules = {
  feePoisha: STANDARD_DELIVERY_FEE_POISHA,
  freeThresholdPoisha: FREE_DELIVERY_THRESHOLD_POISHA,
};

/** Delivery fee for a given cart subtotal. Empty cart pays nothing. */
export function deliveryFeePoisha(
  subtotalPoisha: number,
  rules: DeliveryRules = DEFAULT_DELIVERY_RULES,
): number {
  if (subtotalPoisha <= 0) return 0;
  return subtotalPoisha >= rules.freeThresholdPoisha ? 0 : rules.feePoisha;
}

/** 0–100, for the free-delivery progress bar. */
export function freeDeliveryProgressPercent(
  subtotalPoisha: number,
  rules: DeliveryRules = DEFAULT_DELIVERY_RULES,
): number {
  if (rules.freeThresholdPoisha <= 0) return 100;
  const pct = (subtotalPoisha / rules.freeThresholdPoisha) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** How much more is needed to unlock free delivery. */
export function amountToFreeDeliveryPoisha(
  subtotalPoisha: number,
  rules: DeliveryRules = DEFAULT_DELIVERY_RULES,
): number {
  return Math.max(0, rules.freeThresholdPoisha - subtotalPoisha);
}
