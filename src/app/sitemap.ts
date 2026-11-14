import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/lib/brand';
import { API_BASE_URL, API_PREFIX } from '@/lib/api/config';

/**
 * `sitemap.xml`.
 *
 * ── Why this fetches the API instead of Prisma ─────────────────────────────
 *
 * The storefront is a separate package from the API and does not import the
 * Prisma client; the only supported way to read the catalogue from here is the
 * public HTTP API. That is also the correct boundary: a sitemap listing products
 * that the storefront would 404 on is worse than no sitemap.
 *
 * ── The failure mode is deliberate ─────────────────────────────────────────
 *
 * `fetchJson` returns null on any failure — unreachable API, non-200, bad JSON —
 * and the sitemap degrades to its static pages. A build that fails because the
 * catalogue endpoint was momentarily down would be a build that cannot be
 * deployed from a clean machine, which is the one thing CI exists to guarantee.
 * With `revalidate`, the full list appears on the next successful pass.
 *
 * `limit=500` is the endpoint's own cap (server/src/validators/catalog.schema.ts).
 * Asking for more is a 422, not a silent clamp — the same trap that once failed
 * `next build` on a product page.
 */

export const revalidate = 3600;

/** Server-side calls carry the internal token, exactly as `client.ts` does. */
function internalToken(): string | undefined {
  const token = process.env.INTERNAL_API_TOKEN;
  return token && token.length > 0 ? token : undefined;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const token = internalToken();
    const response = await fetch(`${API_BASE_URL}${API_PREFIX}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(token ? { 'X-Internal-Token': token } : {}),
      },
      next: { revalidate },
      /**
       * A build must not hang on an API that accepts the connection and then
       * says nothing. Five seconds is far longer than this endpoint needs and
       * short enough that a wedged host costs a build seconds, not the whole
       * CI job.
       */
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { data?: T };
    return body.data ?? null;
  } catch {
    return null;
  }
}

/** The pages that exist regardless of what the catalogue holds. */
const STATIC_PAGES: Array<{ path: string; priority: number; frequency: 'daily' | 'weekly' | 'monthly' | 'yearly' }> = [
  { path: '/', priority: 1, frequency: 'daily' },
  { path: '/help', priority: 0.6, frequency: 'monthly' },
  { path: '/return', priority: 0.5, frequency: 'yearly' },
  { path: '/terms', priority: 0.3, frequency: 'yearly' },
  { path: '/privacy', priority: 0.3, frequency: 'yearly' },
  { path: '/about', priority: 0.4, frequency: 'yearly' },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [slugs, categories] = await Promise.all([
    fetchJson<string[]>('/products/slugs?limit=500'),
    fetchJson<Array<{ slug: string }>>('/categories'),
  ]);

  const staticEntries: MetadataRoute.Sitemap = STATIC_PAGES.map((page) => ({
    url: `${SITE_URL}${page.path}`,
    changeFrequency: page.frequency,
    priority: page.priority,
  }));

  const categoryEntries: MetadataRoute.Sitemap = (categories ?? []).map((category) => ({
    url: `${SITE_URL}/category/${category.slug}`,
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const productEntries: MetadataRoute.Sitemap = (slugs ?? []).map((slug) => ({
    url: `${SITE_URL}/product/${slug}`,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  return [...staticEntries, ...categoryEntries, ...productEntries];
}
