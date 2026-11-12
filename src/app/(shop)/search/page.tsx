import type { Metadata } from 'next';

import type { ProductDto } from '@/types/catalog';
import { BRAND } from '@/lib/brand';
import { searchProducts } from '@/lib/api/products';
import { MAX_PAGE_LIMIT } from '@/lib/api/config';
import type { SortKey } from '@/lib/category-filters';
import { SearchResults } from '@/components/search/search-results';

/**
 * `/search` — server-rendered results.
 *
 * The term comes from `?q=`. Results load here, on the server, and are passed to
 * the client component as `initialData`, so the first HTML response already
 * contains the grid. A search page that paints results only after an effect is
 * useless to a crawler and slow for the shopper — same reasoning as the category
 * route.
 *
 * `noindex, follow`: a result page is thin, duplicated content that changes with
 * every term. It must not enter the index, but its links to real products should
 * still be followed. The canonical is deliberately omitted — pointing every
 * result page at one URL would be a lie about what the page contains.
 *
 * A missing or 1-character query is NOT a 404. It is a page with an empty state
 * and a prompt, because `/search` with no term is a legitimate arrival (the
 * header box submits empty, a bookmark loses its query) and a 404 there would be
 * a dead end for no reason.
 */

export const revalidate = 300;

/** `?sort=` is validated against the same keys the listing accepts. */
const SORT_KEYS: readonly SortKey[] = [
  'relevance',
  'newest',
  'popular',
  'price_asc',
  'price_desc',
  'rating',
];

function parseSort(raw: string | string[] | undefined): SortKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return SORT_KEYS.includes(value as SortKey) ? (value as SortKey) : 'relevance';
}

/** First value of a search param, trimmed. Total: a garbage value is just empty. */
function parseTerm(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? '').trim().slice(0, 120);
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const term = parseTerm(params.q);

  // The root layout's template appends "| SharkMart", so the brand is not
  // repeated here.
  const title = term ? `Search: ${term}` : 'Search';

  return {
    title,
    description: term
      ? `Products matching “${term}” at ${BRAND.name}. Cash on Delivery across Bangladesh.`
      : `Search the ${BRAND.name} catalog.`,
    robots: { index: false, follow: true },
  };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const term = parseTerm(params.q);
  const sort = parseSort(params.sort);

  /**
   * Below two characters there is nothing worth asking the API for: a
   * single letter matches most of the catalog and the server would do real work
   * to return a meaningless page. The component renders the prompt instead.
   *
   * The result set must be paged. `MAX_PAGE_LIMIT` is 100 and the catalog is
   * already 168, so a single read silently dropped every match past the first
   * hundred — a term whose products all lived on page 2 returned "no results"
   * while the products plainly existed. The loop is bounded by the server's own
   * `total` plus a hard ceiling.
   */
  let results: ProductDto[] = [];
  if (term.length >= 2) {
    try {
      const CEILING = 10; // 10 × 100 = 1,000 results; a search page needs no more.

      for (let page = 1; page <= CEILING; page++) {
        const response = await searchProducts(term, {
          limit: MAX_PAGE_LIMIT,
          sort,
          page,
        });
        results.push(...response.data);

        const total = response.meta?.total ?? results.length;
        if (response.data.length === 0 || results.length >= total) break;
      }
    } catch {
      /**
       * An API failure must not 500 the page. The component renders its empty
       * state, which still offers real escapes, and the shopper can retype.
       * A search page that dies on a blip is worse than one that finds nothing.
       */
      results = [];
    }
  }

  return <SearchResults term={term} initialData={results} initialSort={sort} />;
}
