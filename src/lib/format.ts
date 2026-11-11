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
 * ৳1,890 — from poisha. Shows decimals only when the amount is not a whole taka.
 * Bangla mode renders Bangla numerals (৳১,৮৯০).
 */
export function formatMoney(poisha: number, lang: Lang = 'en'): string {
  const taka = poisha / 100;
  const hasFraction = !Number.isInteger(taka);

  return `৳${new Intl.NumberFormat(LOCALES[lang], {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(taka)}`;
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
