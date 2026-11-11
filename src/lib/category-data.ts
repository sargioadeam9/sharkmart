/**
 * Category data assembly — server-safe.
 *
 * Extracted from `CategoryPage` so the route can load it during the server
 * render and pass it down as `initialData`. Without this the page ships an
 * empty skeleton to the crawler and only fills in after hydration.
 *
 * No `'use client'` here on purpose: this module must run on the server.
 */

import type { BrandDto, CategoryDto, ProductDto } from '@/types/catalog';
import { getCategory, listBrands } from '@/lib/api/categories';
import { listProducts } from '@/lib/api/products';

export interface CategoryData {
  category: CategoryDto;
  products: ProductDto[];
  brands: BrandDto[];
}

/**
 * Loads everything one category page needs, in parallel, and derives the
 * brand list from the products actually in this category.
 *
 * Why derive instead of using the full brand list: the reference does the same
 * (`[...new Set(ps.map(p => p.b))]`), so its filter never offers a brand with
 * zero results in that category.
 *
 * Why the extra lookup: a product DTO only carries a `BrandRef` (id/slug/names/
 * colour) with no `isOwnBrand`, and the reference renders the house brand as a
 * `.bt` tile and partners as `.ex` chips. The flag has to come from the brand
 * record, never from a hardcoded `false`.
 */
export async function loadCategoryData(slug: string): Promise<CategoryData> {
  const [categoryResponse, productsResponse, brandsResponse] = await Promise.all([
    getCategory(slug),
    listProducts({ category: slug, limit: 200 }),
    listBrands(),
  ]);

  const products = productsResponse.data;
  const brandRecords = new Map(brandsResponse.data.map((b) => [b.slug, b]));

  const seen = new Map<string, BrandDto>();
  for (const product of products) {
    const brand = product.brand;
    if (!brand || seen.has(brand.slug)) continue;

    const record = brandRecords.get(brand.slug);
    seen.set(brand.slug, {
      id: brand.id,
      slug: brand.slug,
      nameEn: brand.nameEn,
      nameBn: brand.nameBn,
      logo: record?.logo ?? null,
      taglineEn: record?.taglineEn ?? null,
      taglineBn: record?.taglineBn ?? null,
      color: brand.color,
      isOwnBrand: record?.isOwnBrand ?? false,
      sortOrder: seen.size,
      productCount: products.filter((p) => p.brand?.slug === brand.slug).length,
    });
  }

  return {
    category: categoryResponse.data,
    products,
    brands: [...seen.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn)),
  };
}
