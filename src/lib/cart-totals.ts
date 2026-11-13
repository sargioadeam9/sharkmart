/**
 * Cart totals — the storefront's mirror of the reference's `totals()`.
 *
 * Source: oshoppingbd.html line 779
 *   function totals(){
 *     let sub=0, disc=0;
 *     st.cart.forEach(i => { const p=P[i.id-1]; sub += (p.p+i.d)*i.q; if(p.o) disc += (p.o-p.p)*i.q });
 *     const del = !st.cart.length ? 0 : sub >= 2000 ? 0 : 60;
 *     return { sub, disc, del, tot: sub+del };
 *   }
 *
 * Two things the reference does that are easy to get wrong:
 *
 * 1. `disc` is the *saving*, not a deduction from `sub`. The reference's
 *    subtotal already uses the discounted unit price, so the total is
 *    `sub + del` — discount is displayed for information only. Subtracting it
 *    again would double-count the discount.
 * 2. An empty cart pays no delivery, even though 0 < 2000.
 *
 * All arithmetic is integer poisha. No floats touch money (AGENTS.md #4).
 */

import type { CartLine, CartTotals } from '@/lib/store/cart-store';
import { DEFAULT_DELIVERY_RULES, deliveryFeePoisha, type DeliveryRules } from '@/lib/commerce';

export function cartTotals(
  lines: CartLine[],
  rules: DeliveryRules = DEFAULT_DELIVERY_RULES,
): CartTotals {
  let subtotalPoisha = 0;
  let discountPoisha = 0;
  let itemCount = 0;

  for (const line of lines) {
    const unit = line.unitPricePoisha;
    const original = line.originalUnitPricePoisha;

    subtotalPoisha += unit * line.quantity;
    itemCount += line.quantity;

    // A struck-through price only counts as a saving when it is actually higher.
    if (original > unit) {
      discountPoisha += (original - unit) * line.quantity;
    }
  }

  const deliveryFee = deliveryFeePoisha(subtotalPoisha, rules);

  return {
    subtotalPoisha,
    discountPoisha,
    deliveryFeePoisha: deliveryFee,
    totalPoisha: subtotalPoisha + deliveryFee,
    itemCount,
    lineCount: lines.length,
  };
}
