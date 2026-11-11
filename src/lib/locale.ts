/**
 * Locale seam — server-side language resolution.
 *
 * Language currently lives in two places: the UI store (localStorage, drives
 * every client component) and the `sm_lang` cookie (set by the language toggle,
 * readable on the server). The cookie is the seam. Today the server can only
 * *read* it; when `/bn` routing lands, this module is the single place that
 * changes.
 *
 * Why a cookie and not a header or a query param: the toggle already writes it,
 * it survives a refresh, it costs nothing on the wire, and `cookies()` is
 * readable from server components and `generateMetadata` alike.
 *
 * No `'use client'` here on purpose. `getLang()` uses `next/headers`, which
 * throws in a client component; keeping this module server-only makes that a
 * build error rather than a runtime surprise.
 */

import { cookies } from 'next/headers';

import { BRAND } from '@/lib/brand';
import { DEFAULT_LANG, isLang } from '@/lib/i18n';
import { LANG_COOKIE } from '@/lib/locale-cookie';
import type { Lang } from '@/lib/format';

export { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from '@/lib/locale-cookie';

/**
 * Reads the visitor's language on the server.
 *
 * Safe to call from a server component, a route handler or `generateMetadata`.
 * Returns `DEFAULT_LANG` when the cookie is absent, empty or not a known
 * language — a hand-edited cookie must never reach a render path as `undefined`.
 */
export async function getLang(): Promise<Lang> {
  const store = await cookies();
  const value = store.get(LANG_COOKIE)?.value;
  return isLang(value) ? value : DEFAULT_LANG;
}

/**
 * Prefixes a path for the active language.
 *
 * English is unprefixed; Bangla gets `/bn`. Every internal link that should
 * survive the locale switch must be built through this function.
 *
 * When locale routing lands, this becomes the only place that changes.
 */
export function localePath(path: string, lang: Lang): string {
  if (lang === 'en') return path;
  return `/bn${path.startsWith('/') ? path : `/${path}`}`;
}

/** Absolute URL for canonicals, OpenGraph and JSON-LD. */
export function absoluteUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${BRAND.url}${suffix}`;
}
