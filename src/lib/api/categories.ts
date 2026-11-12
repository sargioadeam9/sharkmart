/**
 * Category and brand API functions.
 *
 * Two of these need a shape adjustment rather than a straight pass-through:
 * the server's `/categories/:slug` and `/brands/:slug` return the record *and*
 * its products (`{ category, products }`), because the category page needs both
 * and one round trip beats two. The components read a bare `CategoryDto`, so
 * the unwrap happens here — the one place that knows both shapes.
 */

import type { ApiSuccess } from '@/types/api';
import type { BrandDto, CategoryDto, ProductDto } from '@/types/catalog';
import { apiFetch, resolve } from './client';
import { USE_MOCK } from './config';
import {
  mockGetBrand,
  mockGetCategory,
  mockListBrands,
  mockListCategories,
} from '@/lib/mock';

export function listCategories(): Promise<ApiSuccess<CategoryDto[]>> {
  return resolve('/categories', mockListCategories);
}

/**
 * One category, without its products.
 *
 * The server sends `{ category, products }`; the page loads products through
 * `listProducts` separately (it needs filters and a different limit), so the
 * product array in this response is redundant here and is dropped.
 */
export async function getCategory(slug: string): Promise<ApiSuccess<CategoryDto>> {
  if (USE_MOCK) {
    return resolve(`/categories/${encodeURIComponent(slug)}`, () => {
      const category = mockGetCategory(slug);
      if (!category) throw new Error(`Category not found: ${slug}`);
      return { success: true as const, data: category };
    });
  }

  const response = await apiFetch<{ category: CategoryDto; products: ProductDto[] }>(
    `/categories/${encodeURIComponent(slug)}`,
  );

  return { success: true, data: response.data.category };
}

export function listBrands(): Promise<ApiSuccess<BrandDto[]>> {
  return resolve('/brands', mockListBrands);
}

/** One brand, without its products. Same unwrap as `getCategory`. */
export async function getBrand(slug: string): Promise<ApiSuccess<BrandDto>> {
  if (USE_MOCK) {
    return resolve(`/brands/${encodeURIComponent(slug)}`, () => {
      const brand = mockGetBrand(slug);
      if (!brand) throw new Error(`Brand not found: ${slug}`);
      return { success: true as const, data: brand };
    });
  }

  const response = await apiFetch<{ brand: BrandDto; products: ProductDto[] }>(
    `/brands/${encodeURIComponent(slug)}`,
  );

  return { success: true, data: response.data.brand };
}
