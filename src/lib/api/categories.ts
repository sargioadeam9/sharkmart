/**
 * Category and brand API functions.
 */

import type { ApiSuccess } from '@/types/api';
import type { BrandDto, CategoryDto } from '@/types/catalog';
import { resolve } from './client';
import {
  mockGetBrand,
  mockGetCategory,
  mockListBrands,
  mockListCategories,
} from '@/lib/mock';

export function listCategories(): Promise<ApiSuccess<CategoryDto[]>> {
  return resolve('/categories', mockListCategories);
}

export function getCategory(slug: string): Promise<ApiSuccess<CategoryDto>> {
  return resolve(`/categories/${encodeURIComponent(slug)}`, () => {
    const category = mockGetCategory(slug);
    if (!category) throw new Error(`Category not found: ${slug}`);
    return { success: true as const, data: category };
  });
}

export function listBrands(): Promise<ApiSuccess<BrandDto[]>> {
  return resolve('/brands', mockListBrands);
}

export function getBrand(slug: string): Promise<ApiSuccess<BrandDto>> {
  return resolve(`/brands/${encodeURIComponent(slug)}`, () => {
    const brand = mockGetBrand(slug);
    if (!brand) throw new Error(`Brand not found: ${slug}`);
    return { success: true as const, data: brand };
  });
}
