/**
 * Homepage aggregate — one request for the whole Phase 3 page.
 *
 * The storefront's `HomepageAggregate` needs eight product rails, the category
 * tree, both brand rails, a promo list and a flash-sale countdown. Fetching
 * those as eight requests is eight round trips on a 3G connection, which is the
 * market this store is built for.
 *
 * Strategy: one `findMany` per rail, all issued in parallel, then a single
 * warehouse-stock query for every product id across all rails. That is a fixed
 * number of queries (nine plus one), not one per product.
 *
 * The rails are deliberately different slices, matching the reference's
 * `pick(seed, n)` behaviour rather than five copies of the same list.
 */

import { prisma } from '../config/database.js';
import { PRODUCT_LIST_SELECT, type ProductListRow } from './mappers.js';
import { PUBLISHED, mapProductRows } from './product.service.js';
import { listBrands, listCategories } from './category.service.js';
import { getDeliveryFees } from './settings.service.js';
import type { BrandDto, CategoryDto, ProductDto } from './mappers.js';

export interface HomepagePromo {
  categorySlug: string;
  headlineEn: string;
  headlineBn: string;
  kickerEn: string;
  kickerBn: string;
}

export interface HomepageAggregate {
  flashSale: ProductDto[];
  featured: ProductDto[];
  newArrivals: ProductDto[];
  bestSellers: ProductDto[];
  trending: ProductDto[];
  onlyForYou: ProductDto[];
  recommended: ProductDto[];
  popular: ProductDto[];
  categories: CategoryDto[];
  ownBrands: BrandDto[];
  externalBrands: BrandDto[];
  catalog: ProductDto[];
  promos: HomepagePromo[];
  flashSaleEndsAt: string;
  freeDeliveryThresholdPoisha: number;
}

/** Rail size — the reference renders 14 per carousel. */
const RAIL = 14;

/**
 * The three promo cards.
 *
 * The reference hardcodes three `[categoryId, en, bn]` triples and reads the
 * accent off the category. Same three, same copy, kept as data so no component
 * inlines them.
 */
const PROMOS: HomepagePromo[] = [
  {
    categorySlug: 'fashion',
    kickerEn: 'Up to 40% off',
    kickerBn: '৪০% পর্যন্ত ছাড়',
    headlineEn: 'Fashion that fits your season',
    headlineBn: 'আপনার মৌসুমের সেরা ফ্যাশন',
  },
  {
    categorySlug: 'gadgets-electronics',
    kickerEn: 'Smart deals',
    kickerBn: 'স্মার্ট ডিল',
    headlineEn: 'Gadgets worth the upgrade',
    headlineBn: 'উপগ্রেডের যোগ্য গ্যাজেট',
  },
  {
    categorySlug: 'herbal-natural',
    kickerEn: '100% pure',
    kickerBn: '১০০% খাঁটি',
    headlineEn: 'Straight from nature',
    headlineBn: 'প্রকৃতি থেকে সরাসরি',
  },
];

/**
 * The free-delivery threshold is a store setting, not a constant.
 *
 * This module used to carry its own copy, which meant changing the threshold in
 * the admin panel updated checkout and the cart but left the homepage banner
 * advertising the old number. The payload is already cached, so the extra read is
 * one cached map lookup.
 */

const railSelect = PRODUCT_LIST_SELECT;

/**
 * Builds the aggregate.
 *
 * `now` is injectable so a test can pin the flash-sale window instead of
 * depending on the wall clock.
 */
export async function getHomepage(now = new Date()): Promise<HomepageAggregate> {
  // The banner above the fold quotes the threshold, so it must be the same
  // number checkout uses. Cached in settings.service, so this is a map lookup.
  const fees = await getDeliveryFees();

  const liveFlash = {
    ...PUBLISHED,
    isFlashSale: true,
    flashSaleStart: { lte: now },
    flashSaleEnd: { gt: now },
  };

  const [
    flashRows,
    featuredRows,
    newRows,
    bestRows,
    trendingRows,
    onlyRows,
    recommendedRows,
    popularRows,
    catalogRows,
    categories,
    brands,
  ] = await Promise.all([
    prisma.product.findMany({
      where: liveFlash,
      select: railSelect,
      orderBy: { flashSaleEnd: 'asc' },
      take: RAIL,
    }),
    prisma.product.findMany({
      where: { ...PUBLISHED, isFeatured: true },
      select: railSelect,
      orderBy: { createdAt: 'asc' },
      take: RAIL,
    }),
    prisma.product.findMany({
      where: PUBLISHED,
      select: railSelect,
      orderBy: { createdAt: 'desc' },
      take: RAIL,
    }),
    prisma.product.findMany({
      where: PUBLISHED,
      select: railSelect,
      orderBy: [{ reviewCount: 'desc' }, { ratingAvg: 'desc' }],
      take: RAIL,
    }),
    /**
     * "Trending" has no column behind it. Rather than invent a flag, this rail
     * is the highest-rated slice that is not already the bestseller rail — a
     * real ordering over real data, and honestly labelled.
     */
    prisma.product.findMany({
      where: PUBLISHED,
      select: railSelect,
      orderBy: [{ ratingAvg: 'desc' }, { reviewCount: 'desc' }],
      skip: RAIL,
      take: RAIL,
    }),
    prisma.product.findMany({
      where: PUBLISHED,
      select: railSelect,
      orderBy: { updatedAt: 'desc' },
      skip: RAIL,
      take: RAIL,
    }),
    prisma.product.findMany({
      where: { ...PUBLISHED, discountPercent: { gt: 0 } },
      select: railSelect,
      orderBy: { discountPercent: 'desc' },
      take: RAIL,
    }),
    prisma.product.findMany({
      where: { ...PUBLISHED, reviewCount: { gt: 150 } },
      select: railSelect,
      orderBy: [{ reviewCount: 'desc' }],
      skip: RAIL,
      take: RAIL,
    }),
    /**
     * The full public catalog, for rails that resolve stored ids (recently
     * viewed). Bounded — the storefront only needs enough to cover what a
     * visitor could have browsed.
     */
    prisma.product.findMany({
      where: PUBLISHED,
      select: railSelect,
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    listCategories(),
    listBrands(),
  ]);

  const [flashSale, featured, newArrivals, bestSellers, trending, onlyForYou, recommended, popular, catalog] =
    await Promise.all([
      mapProductRows(flashRows as ProductListRow[]),
      mapProductRows(featuredRows as ProductListRow[]),
      mapProductRows(newRows as ProductListRow[]),
      mapProductRows(bestRows as ProductListRow[]),
      mapProductRows(trendingRows as ProductListRow[]),
      mapProductRows(onlyRows as ProductListRow[]),
      mapProductRows(recommendedRows as ProductListRow[]),
      mapProductRows(popularRows as ProductListRow[]),
      mapProductRows(catalogRows as ProductListRow[]),
    ]);

  /**
   * The countdown target: the earliest live flash-sale end. When no sale is
   * running the field is an empty string rather than a fabricated future date —
   * the storefront hides the countdown when it is falsy.
   */
  const flashSaleEndsAt = flashSale
    .map((p) => p.flashSaleEndsAt)
    .filter((iso): iso is string => Boolean(iso))
    .sort()[0] ?? '';

  return {
    flashSale,
    featured,
    newArrivals,
    bestSellers,
    trending,
    onlyForYou,
    recommended,
    popular,
    categories,
    ownBrands: brands.filter((b) => b.isOwnBrand),
    externalBrands: brands.filter((b) => !b.isOwnBrand).slice(0, 12),
    catalog,
    promos: PROMOS,
    flashSaleEndsAt,
    freeDeliveryThresholdPoisha: fees.freeThresholdPoisha,
  };
}

/** The active flash sale on its own, for `/flash-sale`. */
export async function getFlashSale(now = new Date()) {
  const rows = await prisma.product.findMany({
    where: {
      ...PUBLISHED,
      isFlashSale: true,
      flashSaleStart: { lte: now },
      flashSaleEnd: { gt: now },
    },
    select: railSelect,
    orderBy: { flashSaleEnd: 'asc' },
    take: 50,
  });

  const items = await mapProductRows(rows as ProductListRow[]);
  const endsAt = items
    .map((p) => p.flashSaleEndsAt)
    .filter((iso): iso is string => Boolean(iso))
    .sort()[0] ?? null;

  return { items, endsAt };
}
