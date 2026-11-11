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
