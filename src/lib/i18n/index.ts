/**
 * i18n — ported from the reference's `T{en,bn}` object.
 *
 * The reference does:
 *   const t = (k, v) => {
 *     let s = (T[st.lang][k] ?? T.en[k] ?? k);
 *     if (v) for (const x in v) s = s.replace('{' + x + '}', nf(v[x]));
 *     return s;
 *   };
 *
 * We keep the same semantics — including the fallback-to-English and the
 * fallback-to-the-key — but make the key set a real TypeScript union so a
 * typo is a compile error instead of a stray `add_to_cart` on screen.
 *
 * Deliberately framework-free: no provider, no context, no client hook. A
 * server component can call `t()` directly, which keeps Phase 3 pages
 * server-rendered by default (frontend.md Rule 1).
 */

import { en } from './translations/en';
import { bn } from './translations/bn';
import type { Lang } from '@/lib/format';

export type TranslationKey = keyof typeof en;

export const TRANSLATIONS: Record<Lang, Record<TranslationKey, string>> = {
  en,
  bn,
};

/** Values substituted into `{name}` placeholders. */
export type TranslationVars = Record<string, string | number>;

export const DEFAULT_LANG: Lang = 'en';

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'bn';
}

/**
 * Bangla numerals for interpolated numbers, matching the reference's `nf()`.
 * The reference renders `{n}` values in Bangla digits when the language is bn,
 * so "Only {n} left" becomes "মাত্র ৪টি বাকি".
 */
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

export function toBanglaDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

/** Locale-aware number rendering used by `t()` for placeholder values. */
export function localizeNumber(value: string | number, lang: Lang): string {
  if (typeof value === 'number') {
    return new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-US').format(value);
  }
  return lang === 'bn' ? toBanglaDigits(value) : value;
}

/**
 * Translate a key.
 *
 *   t('en', 'add')                       -> "Add to Cart"
 *   t('bn', 'left', { n: 4 })            -> "মাত্র ৪টি বাকি"
 *   t('en', 'showing', { a: 20, b: 168 })-> "Showing 20 of 168 products"
 *
 * Missing key: falls back to English, then to the key itself — same as the
 * reference. A missing key is a bug, not a runtime crash.
 */
export function t(
  lang: Lang,
  key: TranslationKey,
  vars?: TranslationVars,
): string {
  const dict = TRANSLATIONS[lang] ?? TRANSLATIONS[DEFAULT_LANG];
  let out: string = dict[key] ?? en[key] ?? key;

  if (vars) {
    for (const [name, raw] of Object.entries(vars)) {
      out = out.replaceAll(`{${name}}`, localizeNumber(raw, lang));
    }
  }

  return out;
}

/** Bind a language once — handy inside a component that renders many strings. */
export function translator(lang: Lang) {
  return (key: TranslationKey, vars?: TranslationVars) => t(lang, key, vars);
}

export type Translator = ReturnType<typeof translator>;

/** The `<body>` class that swaps the font stack and heading line-height. */
export function bodyClass(lang: Lang): string {
  return lang === 'bn' ? 'bn' : '';
}

/** `lang` attribute for `<html>`. */
export function htmlLang(lang: Lang): string {
  return lang === 'bn' ? 'bn-BD' : 'en';
}
