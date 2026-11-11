/**
 * Locale cookie constants — client-safe.
 *
 * Deliberately separate from `src/lib/locale.ts`, which imports `next/headers`
 * and therefore cannot be pulled into a client bundle. The language toggle needs
 * the cookie name and lifetime; the server needs the same two values plus
 * `cookies()`. One definition, two importers, no duplication.
 */

/** The cookie the language toggle writes and the server reads. */
export const LANG_COOKIE = 'sm_lang';

/** One year, in seconds. */
export const LANG_COOKIE_MAX_AGE = 31_536_000;
