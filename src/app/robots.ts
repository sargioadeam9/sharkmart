import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/brand';

/**
 * `robots.txt`.
 *
 * ── What is disallowed, and why each one ───────────────────────────────────
 *
 *   /admin        the panel. It is already `noindex` in its own layout and
 *                 behind auth, but a crawler that finds `/admin/login` wastes
 *                 budget and a bot that finds a session bug should not be
 *                 pointed at it.
 *   /profile      personal.
 *   /orders       personal — a signed-in order list.
 *   /cart         meaningless without a session; every visitor gets an empty
 *                 one.
 *   /checkout     a form with no content.
 *   /wishlist     a personal list held in localStorage.
 *   /login        auth forms are phishing templates' favourite thing to clone;
 *                 they are `noindex` too, this is belt and braces.
 *   /register
 *   /forgot-password
 *   /reset-password  a token in a URL must never be crawled.
 *   /track        a form; the useful part is the result, which is per-order.
 *   /search       infinite query space, every result a near-duplicate.
 *
 * Everything else — the catalogue, the categories, the policy pages — is open.
 * Those policy pages are the ones a customer searches for by name ("return
 * policy"), so disallowing them would be self-harm.
 */

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/profile',
          '/orders',
          '/cart',
          '/checkout',
          '/wishlist',
          '/login',
          '/register',
          '/forgot-password',
          '/reset-password',
          '/track',
          '/search',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
