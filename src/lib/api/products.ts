/**
 * Product API functions. Components import from here — never from the mock
 * layer, never from `fetch`.
 *
 * Signature stability is the point: Phase 6 implements the server side of
 * these paths and nothing on the frontend changes.
 */

import type { ApiSuccess } from '@/types/api';
import type {
  ProductDetailDto,
  ProductDto,
  ProductListQuery,
} from '@/types/catalog';
import { ApiClientError, resolve } from './client';
import { MAX_PAGE_LIMIT } from './config';
import {
  mockGetProduct,
  mockGetProductDetail,
  mockListProductSlugs,
  mockListProducts,
} from '@/lib/mock';

/**
 * The mock layer has to fail the way the wire fails, or the route cannot tell
 * "this product does not exist" (404, render the 404 boundary) from "the API is
 * down" (rethrow, keep the last good ISR page). A bare `Error` collapses both
 * into one and the page 404s on a five-second blip.
 */
function notFoundError(slug: string): ApiClientError {
  return new ApiClientError(
    { code: 'NOT_FOUND', message: `Product not found: ${slug}` },
    404,
  );
}

function toQueryString(query: ProductListQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function listProducts(
  query: ProductListQuery = {},
): Promise<ApiSuccess<ProductDto[]>> {
  return resolve(`/products${toQueryString(query)}`, () => mockListProducts(query));
}

export function getProduct(slug: string): Promise<ApiSuccess<ProductDto>> {
  return resolve(`/products/${encodeURIComponent(slug)}`, () => {
    const product = mockGetProduct(slug);
    if (!product) {
      throw notFoundError(slug);
    }
    return { success: true as const, data: product };
  });
}

/**
 * Every product slug, for `generateStaticParams`.
 *
 * Bounded at 200 — the same cap `loadProductPageData` and `loadCategoryData`
 * already use for their catalog reads, and comfortably above the current
 * catalog. A catalog that outgrows it does not break: the slugs past the bound
 * are simply not prerendered and fall through to ISR on first request. Raising
 * the bound is a build-time cost decision, not a correctness one.
 */
export function listProductSlugs(): Promise<ApiSuccess<string[]>> {
  return resolve('/products/slugs?limit=200', () => mockListProductSlugs(200));
}

/**
 * The detail endpoint.
 *
 * The server serves the full detail at `/products/:slug` — the same path the
 * list uses for a single product, because the flat `ProductDetailDto` is a
 * superset of `ProductDto`. There is no `/detail` suffix: that was the plan in
 * Phase 0 and the server did not implement it, so calling it would 404 on every
 * product page the moment the mock switch flips.
 */
export function getProductDetail(
  slug: string,
): Promise<ApiSuccess<ProductDetailDto>> {
  return resolve(`/products/${encodeURIComponent(slug)}`, () => {
    const product = mockGetProductDetail(slug);
    if (!product) {
      throw notFoundError(slug);
    }
    return { success: true as const, data: product };
  });
}

/**
 * Search the catalog.
 *
 * There is no separate search endpoint on the frontend side: the server's
 * `/products?q=` already does the bilingual `contains` over nameEn, nameBn, sku,
 * brand and category names (`product.service.ts`), and `/api/v1/search` wraps
 * the same service. Going through `/products` keeps one query shape for both the
 * results page and the type-ahead, so a term that suggests also returns.
 *
 * `limit` is bounded by `MAX_PAGE_LIMIT` rather than trusted: the server rejects
 * anything above its cap with a 422, and a type-ahead must never be the thing
 * that trips that.
 *
 * `signal` lets the caller abort an in-flight suggestion request when the user
 * keeps typing. It is passed through to `fetch`; the mock path resolves
 * synchronously and ignores it.
 */
export function searchProducts(
  term: string,
  options: {
    limit?: number;
    sort?: ProductListQuery['sort'];
    page?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ApiSuccess<ProductDto[]>> {
  const q = term.trim();
  const limit = Math.min(options.limit ?? 7, MAX_PAGE_LIMIT);

  return resolve(
    `/products${toQueryString({ q, limit, sort: options.sort, page: options.page })}`,
    () => mockListProducts({ q, limit, sort: options.sort, page: options.page }),
    { signal: options.signal },
  );
}
