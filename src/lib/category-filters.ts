/**
 * Category listing filter state — URL is the single source of truth.
 *
 * Why the URL and not component state: the Phase 4 gate requires filters and
 * sort to "survive refresh via URL" and links to be shareable, and back/forward
 * to work. A `useState` filter loses all three. So the query string is the
 * state, `router.replace` writes it, and `useSearchParams` reads it back.
 *
 * Two rules that keep this honest:
 *
 *   1. `router.replace`, never `push`. A filter tweak is not a navigation —
 *      pushing would put every checkbox click in the back stack, so the back
 *      button would walk through twelve filter states before leaving the page.
 *
 *   2. `scroll: false`. Next scrolls to the top on a route change by default,
 *      which would throw the customer back to the hero every time they ticked a
 *      brand. The gate calls this out explicitly.
 *
 * Parsing is total: every field has a defined default and garbage in the URL
 * (`?min=abc`, `?sort=nonsense`, `?rating=9`) degrades to the default instead of
 * producing an empty grid or a crash.
 */

import type { ProductListQuery } from '@/types/catalog';
import { MAX_PAGE_LIMIT } from '@/lib/api/config';

/** Sort keys, in the order the reference's `<select>` lists them. */
export const SORT_OPTIONS = [
  'relevance',
  'newest',
  'popular',
  'price_asc',
  'price_desc',
  'rating',
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number];

/** Rating floors the reference offers: all, 4★+, 3★+. */
export const RATING_OPTIONS = [0, 4, 3] as const;

export interface CategoryFilters {
  /** Brand slugs. Empty means "no brand restriction", not "no brands". */
  brands: string[];
  /** Inclusive bounds in poisha. `null` means unbounded. */
  minPricePoisha: number | null;
  maxPricePoisha: number | null;
  /** 0 = all ratings. */
  minRating: number;
  inStockOnly: boolean;
  onDiscountOnly: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTERS: CategoryFilters = {
  brands: [],
  minPricePoisha: null,
  maxPricePoisha: null,
  minRating: 0,
  inStockOnly: false,
  onDiscountOnly: false,
  sort: 'relevance',
};

/** URL param names. Short, because these end up in shared links. */
export const PARAM = {
  brand: 'brand',
  min: 'min',
  max: 'max',
  rating: 'rating',
  stock: 'stock',
  discount: 'discount',
  sort: 'sort',
} as const;

function positiveInt(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function isSortKey(value: string | null): value is SortKey {
  return value !== null && (SORT_OPTIONS as readonly string[]).includes(value);
}

function isRatingFloor(value: number | null): value is 0 | 3 | 4 {
  return value === 0 || value === 3 || value === 4;
}

/**
 * Read filters out of a query string.
 *
 * `availableBrands` is passed so an unknown `?brand=ghost` is dropped rather
 * than silently filtering the grid to nothing — a stale shared link should show
 * products, not an empty page.
 */
export function parseFilters(
  params: URLSearchParams,
  availableBrands?: readonly string[],
): CategoryFilters {
  const rawBrands = params.getAll(PARAM.brand);
  const brands =
    availableBrands === undefined
      ? rawBrands
      : rawBrands.filter((slug) => availableBrands.includes(slug));

  const rating = positiveInt(params.get(PARAM.rating));
  const sort = params.get(PARAM.sort);

  return {
    brands,
    minPricePoisha: positiveInt(params.get(PARAM.min)),
    maxPricePoisha: positiveInt(params.get(PARAM.max)),
    minRating: isRatingFloor(rating) ? rating : 0,
    inStockOnly: params.get(PARAM.stock) === '1',
    onDiscountOnly: params.get(PARAM.discount) === '1',
    sort: isSortKey(sort) ? sort : 'relevance',
  };
}

/**
 * Write filters into a query string, omitting every default.
 *
 * Omission matters: `?brand=&min=&max=&rating=0&sort=relevance` is noise in a
 * shared link and makes it impossible to tell "cleared" from "never set".
 */
export function toSearchParams(filters: CategoryFilters): URLSearchParams {
  const params = new URLSearchParams();

  for (const brand of filters.brands) params.append(PARAM.brand, brand);
  if (filters.minPricePoisha !== null) params.set(PARAM.min, String(filters.minPricePoisha));
  if (filters.maxPricePoisha !== null) params.set(PARAM.max, String(filters.maxPricePoisha));
  if (filters.minRating !== 0) params.set(PARAM.rating, String(filters.minRating));
  if (filters.inStockOnly) params.set(PARAM.stock, '1');
  if (filters.onDiscountOnly) params.set(PARAM.discount, '1');
  if (filters.sort !== 'relevance') params.set(PARAM.sort, filters.sort);

  return params;
}

/** True when anything is narrowed — drives the "Clear filters" affordance. */
export function hasActiveFilters(filters: CategoryFilters): boolean {
  return (
    filters.brands.length > 0 ||
    filters.minPricePoisha !== null ||
    filters.maxPricePoisha !== null ||
    filters.minRating !== 0 ||
    filters.inStockOnly ||
    filters.onDiscountOnly ||
    filters.sort !== 'relevance'
  );
}

/**
 * Translate filters into the product API query.
 *
 * The category page fetches the category's products once, unfiltered, and
 * `applyClientFilters` narrows them. So this only carries the category — the
 * rest would be redundant work the API does and the client then re-does.
 *
 * Phase 6 can move the whole filter set server-side; when it does, this function
 * grows the fields back and `applyClientFilters` can be dropped.
 */
export function toProductQuery(
  categorySlug: string,
  _filters: CategoryFilters,
): ProductListQuery {
  return {
    category: categorySlug,
    limit: MAX_PAGE_LIMIT,
  };
}

/**
 * Applies every filter and the sort, client-side.
 *
 * Why client-side and not through the API: the category page fetches the
 * category's products ONCE and filters that array. That is what makes the gate's
 * "filtering must not refetch the whole page" true, and it keeps the filter
 * response instant on a 3G connection.
 *
 * This function is therefore the complete filter, not a supplement to the API's.
 * An earlier version only handled brand and rating, which meant the price
 * slider, the stock toggle and the discount toggle silently did nothing — the
 * URL updated and the grid did not. Everything the panel can set is applied
 * here, and the sort is applied last.
 */
export function applyClientFilters<
  T extends {
    brand: { slug: string } | null;
    rating: number;
    pricePoisha: number;
    stockStatus: string;
    discountPercent: number;
    createdAt: string;
    reviewCount: number;
  },
>(products: T[], filters: CategoryFilters): T[] {
  let out = products;

  if (filters.brands.length > 0) {
    const wanted = new Set(filters.brands);
    out = out.filter((p) => p.brand !== null && wanted.has(p.brand.slug));
  }

  if (filters.minPricePoisha !== null) {
    const floor = filters.minPricePoisha;
    out = out.filter((p) => p.pricePoisha >= floor);
  }

  if (filters.maxPricePoisha !== null) {
    const ceiling = filters.maxPricePoisha;
    out = out.filter((p) => p.pricePoisha <= ceiling);
  }

  if (filters.minRating > 0) {
    out = out.filter((p) => p.rating >= filters.minRating);
  }

  if (filters.inStockOnly) {
    out = out.filter((p) => p.stockStatus !== 'out_of_stock');
  }

  if (filters.onDiscountOnly) {
    out = out.filter((p) => p.discountPercent > 0);
  }

  // Sort is applied to a copy so the caller's array is never mutated.
  switch (filters.sort) {
    case 'newest':
      out = [...out].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case 'popular':
      out = [...out].sort((a, b) => b.reviewCount - a.reviewCount);
      break;
    case 'price_asc':
      out = [...out].sort((a, b) => a.pricePoisha - b.pricePoisha);
      break;
    case 'price_desc':
      out = [...out].sort((a, b) => b.pricePoisha - a.pricePoisha);
      break;
    case 'rating':
      out = [...out].sort((a, b) => b.rating - a.rating);
      break;
    default:
      // 'relevance' keeps the API's order.
      break;
  }

  return out;
}
