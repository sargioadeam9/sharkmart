/**
 * Single source of truth for the brand.
 *
 * The frozen reference files still say "OShoppingBD" / "ShoppingBD". That is
 * the old brand. Never edit those files — override here and import this
 * constant everywhere. No component may type the brand name inline.
 *
 * See AGENTS.md §2.1.
 */

export const BRAND = {
  name: 'SharkMart',

  /** Wordmark split: "Shark" is navy, "Mart" is brand red. */
  nameParts: {
    first: 'Shark',
    second: 'Mart',
  },

  tagline: 'Fast Delivery',
  taglineBn: 'দ্রুত ডেলিভারি',

  domain: 'sharkmart.com.bd',
  url: 'https://sharkmart.com.bd',
  supportEmail: 'support@sharkmart.com.bd',
  phone: '09XX-XXXXXX',
  address: 'Dhaka, Bangladesh',

  logo: {
    src: '/brand/sharkmart-logo.png',
    width: 2073,
    height: 758,
    alt: 'SharkMart',
  },
} as const;

export type Brand = typeof BRAND;

/**
 * The public origin, for every absolute URL the site emits: `metadataBase`
 * (which canonical and OpenGraph resolve against), and later the sitemap.
 *
 * `NEXT_PUBLIC_SITE_URL` wins over the constant, because that is the one thing a
 * resold install must change and it should not be a code edit. `BRAND.url` is the
 * fallback so a checkout with no `.env.local` still builds and renders the
 * original domain rather than `new URL(undefined)` throwing at build time.
 *
 * A malformed value falls back instead of throwing: a typo in an env var should
 * not fail a deploy with a stack trace from a module import.
 */
function resolveSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!raw) return BRAND.url;

  try {
    // `.origin` drops any trailing slash or path someone pastes in.
    return new URL(raw).origin;
  } catch {
    console.warn(
      `[brand] NEXT_PUBLIC_SITE_URL is not a valid URL (${raw}) — using ${BRAND.url}`,
    );
    return BRAND.url;
  }
}

export const SITE_URL = resolveSiteUrl();
