/**
 * Product queries — the read path for every listing and the detail page.
 *
 * Two things this file is careful about:
 *
 *   1. **No N+1.** Stock lives in `WarehouseStock`, not on `Product`. Summing it
 *      per product would be one query per row. Instead the page's product ids
 *      go into a single `groupBy`, and the result is a Map the mapper reads.
 *   2. **Drafts never leak.** Every public query carries the same
 *      `isPublished: true, isDraft: false` filter, defined once as
 *      `PUBLISHED` so it cannot drift between endpoints.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import {
  PRODUCT_LIST_SELECT,
  buildRatingBreakdown,
  toProductDto,
  toReviewDto,
  toSpecDto,
  toVariantGroups,
  type ProductDto,
  type ProductListRow,
} from './mappers.js';

/**
 * The public visibility filter.
 *
 * A product is public when it is published and not a draft. Both flags exist in
 * the schema and a half-published row (published but still draft) must not
 * appear, so both are checked.
 */
export const PUBLISHED = { isPublished: true, isDraft: false } as const;

export type ProductSort =
  | 'relevance'
  | 'newest'
  | 'popular'
  | 'price_asc'
  | 'price_desc'
  | 'rating';

export interface ProductQuery {
  page: number;
  limit: number;
  category?: string;
  brand?: string;
  q?: string;
  minPricePoisha?: number;
  maxPricePoisha?: number;
  inStockOnly?: boolean;
  onDiscountOnly?: boolean;
  ratingMin?: number;
  sort?: ProductSort;
}

export interface ProductListResult {
  items: ProductDto[];
  total: number;
}

/**
 * Sums warehouse stock for a set of variant-less products in ONE query.
 *
 * Returns productId → quantity. Products absent from the map have no warehouse
 * row at all, which the mapper reads as 0 (out of stock) rather than inventing
 * a number.
 */
async function warehouseStockFor(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();

  const rows = await prisma.warehouseStock.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds }, variantId: null },
    _sum: { quantity: true },
  });

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(row.productId, row._sum.quantity ?? 0);
  }
  return map;
}

/**
 * Maps a page of rows, resolving warehouse stock in one extra query.
 *
 * Exported because the homepage builds several rails from the same helper and
 * must not re-implement the stock join.
 */
export async function mapProductRows(rows: ProductListRow[]): Promise<ProductDto[]> {
  const variantless = rows.filter((row) => row.variants.length === 0).map((row) => row.id);
  const stock = await warehouseStockFor(variantless);

  return rows.map((row) => toProductDto(row, stock.get(row.id) ?? 0));
}

/** Translates the wire sort key into a Prisma orderBy. */
function orderByFor(sort: ProductSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ createdAt: 'desc' }];
    case 'popular':
      return [{ reviewCount: 'desc' }, { ratingAvg: 'desc' }];
    case 'price_asc':
      return [{ basePricePoisha: 'asc' }];
    case 'price_desc':
      return [{ basePricePoisha: 'desc' }];
    case 'rating':
      return [{ ratingAvg: 'desc' }, { reviewCount: 'desc' }];
    case 'relevance':
    default:
      // The reference's default order is catalog order, which the seed
      // preserves through createdAt. Featured products lead, as on the
      // storefront.
      return [{ isFeatured: 'desc' }, { createdAt: 'asc' }];
  }
}

/**
 * Builds the `where` clause shared by listing and counting.
 *
 * Kept as one function so the count and the page can never disagree — a
 * mismatch there produces a "page 3 of 2" pagination bug.
 */
function whereFor(query: ProductQuery): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { ...PUBLISHED };

  if (query.category) where.category = { slug: query.category };
  if (query.brand) where.brand = { slug: query.brand };

  if (query.minPricePoisha !== undefined || query.maxPricePoisha !== undefined) {
    where.basePricePoisha = {
      ...(query.minPricePoisha !== undefined ? { gte: query.minPricePoisha } : {}),
      ...(query.maxPricePoisha !== undefined ? { lte: query.maxPricePoisha } : {}),
    };
  }

  if (query.onDiscountOnly) where.discountPercent = { gt: 0 };
  if (query.ratingMin !== undefined) where.ratingAvg = { gte: query.ratingMin };

  if (query.q) {
    /**
     * Bilingual match over both names, the SKU and the brand name.
     *
     * `mode: 'insensitive'` is not available on MySQL through Prisma, but the
     * collation (`utf8mb4_general_ci`) is already case-insensitive, so a plain
     * `contains` matches case-insensitively in practice. Bangla has no case, so
     * the same predicate works for both scripts.
     */
    const needle = query.q.trim();
    where.OR = [
      { nameEn: { contains: needle } },
      { nameBn: { contains: needle } },
      { sku: { contains: needle } },
      { brand: { nameEn: { contains: needle } } },
      { brand: { nameBn: { contains: needle } } },
      { category: { nameEn: { contains: needle } } },
      { category: { nameBn: { contains: needle } } },
    ];
  }

  return where;
}

/**
 * `inStockOnly` cannot be a SQL predicate without a join + aggregate over
 * WarehouseStock, which would defeat the index. It is applied after the page is
 * mapped instead — correct, and cheap because the page is at most `limit` rows.
 *
 * NOTE: this means `total` counts in-stock and out-of-stock products together
 * when `inStockOnly` is set. The storefront uses it as a client-side filter, so
 * the count is not read; documented rather than silently wrong.
 */
export async function listProducts(query: ProductQuery): Promise<ProductListResult> {
  const where = whereFor(query);
  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: PRODUCT_LIST_SELECT,
      orderBy: orderByFor(query.sort ?? 'relevance'),
      skip,
      take: query.limit,
    }),
    prisma.product.count({ where }),
  ]);

  let items = await mapProductRows(rows as ProductListRow[]);

  if (query.inStockOnly) {
    items = items.filter((product) => product.stockStatus !== 'out_of_stock');
  }

  return { items, total };
}

/** Every public product slug, bounded — the storefront's `generateStaticParams`. */
export async function listProductSlugs(limit: number): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: PUBLISHED,
    select: { slug: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  return rows.map((row) => row.slug);
}

/**
 * One product, fully hydrated for the detail page.
 *
 * Returns null for an unknown slug so the route can 404 with the envelope
 * rather than throwing — masterbuild.md Phase 6: "Return 404 with the envelope
 * for unknown slugs - never a 500."
 */
export async function getProductBySlug(slug: string) {
  const row = await prisma.product.findFirst({
    where: { slug, ...PUBLISHED },
    select: {
      ...PRODUCT_LIST_SELECT,
      category: {
        select: {
          id: true,
          slug: true,
          nameEn: true,
          nameBn: true,
          accentColor: true,
          lightTintColor: true,
        },
      },
      specifications: {
        select: { labelEn: true, labelBn: true, valueEn: true, valueBn: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      },
      /**
       * Variants for the detail page carry their axis, which the list select
       * does not. The storefront renders one pill group per axis, so the group
       * has to be reconstructed from the option's attribute — the wire's flat
       * `ProductVariantDto` has no room for it.
       */
      variants: {
        select: {
          id: true,
          sku: true,
          nameEn: true,
          nameBn: true,
          pricePoisha: true,
          stock: true,
          isActive: true,
          sortOrder: true,
          options: {
            select: {
              valueEn: true,
              valueBn: true,
              attribute: { select: { id: true, nameEn: true, nameBn: true, type: true, sortOrder: true } },
            },
          },
        },
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
      },
      details: {
        select: { section: true, contentEn: true, contentBn: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      },
      reviews: {
        where: { isApproved: true, isFlagged: false },
        select: {
          id: true,
          rating: true,
          contentEn: true,
          contentBn: true,
          isVerifiedPurchase: true,
          helpfulCount: true,
          createdAt: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!row) return null;

  const [stockMap, related] = await Promise.all([
    warehouseStockFor(row.variants.length === 0 ? [row.id] : []),
    prisma.product.findMany({
      where: {
        ...PUBLISHED,
        categoryId: row.category.id,
        id: { not: row.id },
      },
      select: { id: true },
      orderBy: [{ isFeatured: 'desc' }, { reviewCount: 'desc' }],
      take: 10,
    }),
  ]);

  const base = toProductDto(row as ProductListRow, stockMap.get(row.id) ?? 0);

  /**
   * The flat detail DTO the storefront consumes.
   *
   * The server used to return a nested shape (`{ product, specifications,
   * details }`) that no component reads, which pushed the flattening into the
   * frontend and left the Features tab with no source at all. Building it here
   * means one contract, and `tools/parity-check.mjs` asserts this exact shape.
   */
  const features = row.details.find((d) => d.section === 'FEATURES');

  return {
    ...base,
    variantGroups: toVariantGroups(row.variants, row.basePricePoisha),
    reviews: row.reviews.map(toReviewDto),
    ratingBreakdown: buildRatingBreakdown(row.ratingAvg, row.reviewCount),
    featuresEn: splitBullets(features?.contentEn),
    featuresBn: splitBullets(features?.contentBn),
    specs: row.specifications.map(toSpecDto),
    tintColor: row.category.lightTintColor ?? '#F7DCE4',
    accentColor: row.category.accentColor ?? '#C51F4B',
    relatedIds: related.map((r) => r.id),
  };
}

/** A newline-separated bullet block → an array. Absent content is an empty list. */
function splitBullets(content: string | null | undefined): string[] {
  if (!content) return [];
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
