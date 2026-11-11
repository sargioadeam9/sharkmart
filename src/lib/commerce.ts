/**
 * Storefront commerce rules.
 *
 * Source: totals() in oshoppingbd.html (line 779)
 *   const del = !st.cart.length ? 0 : sub >= 2000 ? 0 : 60;
 *
 * The client mirrors these rules for display only. The server recomputes
 * every amount at checkout and is the only authority — see AGENTS.md §7.3.
 */

/** Free delivery at or above ৳2,000. */
export const FREE_DELIVERY_THRESHOLD_POISHA = 200_000;

/** Flat ৳60 below the threshold. */
export const STANDARD_DELIVERY_FEE_POISHA = 6_000;

/** Delivery fee for a given cart subtotal. Empty cart pays nothing. */
export function deliveryFeePoisha(subtotalPoisha: number): number {
  if (subtotalPoisha <= 0) return 0;
  return subtotalPoisha >= FREE_DELIVERY_THRESHOLD_POISHA
    ? 0
    : STANDARD_DELIVERY_FEE_POISHA;
}

/** 0–100, for the free-delivery progress bar. Reference uses sub / 20. */
export function freeDeliveryProgressPercent(subtotalPoisha: number): number {
  const pct = (subtotalPoisha / FREE_DELIVERY_THRESHOLD_POISHA) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** How much more is needed to unlock free delivery. */
export function amountToFreeDeliveryPoisha(subtotalPoisha: number): number {
  return Math.max(0, FREE_DELIVERY_THRESHOLD_POISHA - subtotalPoisha);
}
