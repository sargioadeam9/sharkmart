/**
 * Product detail data assembly — server-safe.
 *
 * Same pattern as `src/lib/category-data.ts`: the route calls this during the
 * server render and hands the result to the client component as `initialData`,
 * so the first HTML response already contains the title, price, gallery and
 * specs. Without it the page ships a skeleton and the crawler sees nothing —
 * the bug fixed in 977153b.
 *
 * No `'use client'` here on purpose.
 *
 * Rails: the four cross-sell rails need *other* products. They are resolved
 * here, on the server, and passed as small arrays. The client never receives
 * the catalog — that is what made the first homepage 492 KB.
 */

import type { ProductDetailDto, ProductDto } from '@/types/catalog';
import { getProductDetail, listProducts } from '@/lib/api/products';

export interface ProductRails {
  /** Same category, in stock, excluding this product. */
  related: ProductDto[];
  /** Same category, reversed — the reference's "Similar Products". */
  similar: ProductDto[];
  /** Same brand, in stock, excluding this product. */
  fromBrand: ProductDto[];
  /** Deterministic offset pick — the reference's "Customers Also Viewed". */
  alsoViewed: ProductDto[];
}

export interface ProductPageData {
  product: ProductDetailDto;
  rails: ProductRails;
}

/**
 * How many products a rail carries.
 *
 * The reference slices ten (`same.slice(0,10)`). Ten is also the point where a
 * rail stops being a suggestion and becomes a second listing page, so it stays.
 */
const RAIL_SIZE = 10;

/**
 * Deterministic "also viewed" pick.
 *
 * The reference does `pick(id+3, 12)` — a seeded shuffle. Reproducing the shape
 * without the shuffle: take a stable slice starting at an offset derived from
 * the product id. Same product, same rail, every render, so the server and the
 * client agree.
 */
function pickAlsoViewed(
  products: ProductDto[],
  excludeId: string,
  seed: number,
): ProductDto[] {
  const pool = products.filter((p) => p.id !== excludeId);
  if (pool.length <= RAIL_SIZE) return pool;

  const offset = seed % pool.length;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
  return rotated.slice(0, RAIL_SIZE);
}

export async function loadProductPageData(
  slug: string,
): Promise<ProductPageData> {
  const detailResponse = await getProductDetail(slug);
  const product = detailResponse.data;

  /**
   * One catalog fetch serves all four rails. Fetching per rail would be four
   * round trips for data that is already in hand.
   */
  const [categoryResponse, brandResponse] = await Promise.all([
    listProducts({ category: product.category.slug, limit: 200 }),
    product.brand
      ? listProducts({ brand: product.brand.slug, limit: 200 })
      : Promise.resolve({ success: true as const, data: [] as ProductDto[] }),
  ]);

  const inCategory = categoryResponse.data.filter(
    (p) => p.id !== product.id && p.stockStatus !== 'out_of_stock',
  );
  const inBrand = brandResponse.data.filter(
    (p) => p.id !== product.id && p.stockStatus !== 'out_of_stock',
  );

  const seed = product.id
    .split('')
    .reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 100000, 7);

  return {
    product,
    rails: {
      related: inCategory.slice(0, RAIL_SIZE),
      similar: [...inCategory].reverse().slice(0, RAIL_SIZE),
      fromBrand: inBrand.slice(0, RAIL_SIZE),
      alsoViewed: pickAlsoViewed(categoryResponse.data, product.id, seed),
    },
  };
}
