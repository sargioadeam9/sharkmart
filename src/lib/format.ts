/**
 * Money and number formatting.
 *
 * Two different conventions exist in this project — do not unify them:
 *
 *   Storefront : toLocaleString('en-US') / ('bn-BD')   ->  ৳1,284  ·  ৳১,২৮৪
 *   Admin      : toLocaleString('en-IN')  (lakh)       ->  ৳4,82,350
 *
 * Money is transported and stored as an integer number of poisha.
 * 1 taka = 100 poisha. Never use floats for money.
 */

export type Lang = 'en' | 'bn';

export const LOCALES: Record<Lang, string> = {
  en: 'en-US',
  bn: 'bn-BD',
};

/** ৳1,890 — plain number with locale-aware grouping. */
export function formatNumber(value: number, lang: Lang = 'en'): string {
  return new Intl.NumberFormat(LOCALES[lang]).format(value);
}

/**
 * ৳1,890 — from poisha, rounded to whole taka.
 *
 * The reference's money formatter is `fmt = n => '৳' + nf(Math.round(n))`
 * (oshoppingbd.html): it rounds to whole taka, always. Variant deltas are
 * computed as `round(price * .12 * i / 10) * 10` poisha, which lands on
 * multiples of 10 poisha — a tenth of a taka — so without this rounding a
 * selected variant would render as `৳১,৮৯৩.৬০`, a price the reference never
 * shows and a shop in Bangladesh never quotes.
 *
 * Rounding happens at display only. The stored and transported value stays an
 * integer number of poisha (AGENTS.md landmine #4), and checkout recomputes
 * every total server-side.
 */
export function formatMoney(poisha: number, lang: Lang = 'en'): string {
  return `৳${new Intl.NumberFormat(LOCALES[lang], {
    maximumFractionDigits: 0,
  }).format(Math.round(poisha / 100))}`;
}

/**
 * ৳4,82,350 — admin surfaces only. Lakh grouping, matching
 * `toLocaleString('en-IN')` in admin panel.html.
 */
export function formatMoneyAdmin(poisha: number): string {
  return `৳${new Intl.NumberFormat('en-IN').format(Math.round(poisha / 100))}`;
}

/** Taka -> poisha, for input handling. 18.5 -> 1850 */
export function toPoisha(taka: number): number {
  return Math.round(taka * 100);
}

/** Poisha -> taka, for display in inputs. 1850 -> 18.5 */
export function toTaka(poisha: number): number {
  return poisha / 100;
}
