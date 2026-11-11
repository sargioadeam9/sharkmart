/**
 * Product API functions. Components import from here — never from the mock
 * layer, never from `fetch`.
 *
 * Signature stability is the point: Phase 6 implements the server side of
 * these paths and nothing on the frontend changes.
 */

import type { ApiSuccess } from '@/types/api';
import type { ProductDto, ProductListQuery } from '@/types/catalog';
import { resolve } from './client';
import { mockGetProduct, mockListProducts } from '@/lib/mock';

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
      throw new Error(`Product not found: ${slug}`);
    }
    return { success: true as const, data: product };
  });
}
