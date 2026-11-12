/**
 * DB row → wire DTO mappers.
 *
 * The storefront's `src/types/catalog.ts` is the frozen contract. These
 * functions are the only place a Prisma row becomes a `ProductDto`, so the
 * shape can never drift between endpoints.
 *
 * Three rules that are easy to get wrong and are enforced here:
 *
 *   1. Money is integer poisha on both sides. No conversion happens in a
 *      mapper — the seed already stored poisha.
 *   2. `stockStatus` is computed server-side from real warehouse stock, so the
 *      UI never guesses (catalog.ts: "Stock state is computed server-side").
 *   3. Draft and unpublished products never reach a public mapper. The filter
 *      is in the query, but the mapper also refuses to emit a draft, so a
 *      future caller that forgets the filter fails loudly instead of leaking.
 */

import type { Brand, Category, ProductImage } from '@prisma/client';

// ─── Wire types (mirror of src/types/catalog.ts) ──────────────────────────

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';
export type ProductBadge = 'new' | 'sale' | 'bestseller' | 'trending';

export interface CategoryRef {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
}

export interface BrandRef {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  color: string | null;
}

export interface ProductImageDto {
  id: string;
  url: string;
  altEn: string;
  altBn: string;
  isMain: boolean;
  sortOrder: number;
}

export interface ProductVariantDto {
  id: string;
  sku: string;
  nameEn: string;
  nameBn: string;
  pricePoisha: number;
  stock: number;
  stockStatus: StockStatus;
  isActive: boolean;
}

export interface ProductDto {
  id: string;
  slug: string;
  sku: string;
  nameEn: string;
  nameBn: string;
  descriptionEn: string | null;
  descriptionBn: string | null;
  category: CategoryRef;
  brand: BrandRef | null;
  pricePoisha: number;
  originalPricePoisha: number;
  discountPercent: number;
  images: ProductImageDto[];
  variants: ProductVariantDto[];
  rating: number;
  reviewCount: number;
  stockStatus: StockStatus;
  stockQuantity: number;
  isFeatured: boolean;
  isFlashSale: boolean;
  flashSalePricePoisha: number | null;
  flashSaleEndsAt: string | null;
  badges: ProductBadge[];
  createdAt: string;
  updatedAt: string;
}

export interface SubcategoryDto {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  productCount: number;
}

export interface CategoryDto {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  accentColor: string;
  lightTintColor: string;
  iconEmoji: string;
  sortOrder: number;
  productCount: number;
  subcategories: SubcategoryDto[];
}

export interface BrandDto {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  logo: string | null;
  taglineEn: string | null;
  taglineBn: string | null;
  color: string | null;
  isOwnBrand: boolean;
  sortOrder: number;
  productCount: number;
}

export interface VariantOptionDto {
  /**
   * Stable identity of this option *value* within the product: `attributeId:value`.
   *
   * Deliberately NOT a variant id. Since Phase 8 a variant is a full
   * combination across the axes, so one option value spans many variants and no
   * single id can name it. Use `VariantGroupDto.combinations` to turn a
   * selection into a real `ProductVariant.id`.
   */
  valueKey: string;
  nameEn: string;
  nameBn: string;
  priceDeltaPoisha: number;
  stock: number;
  swatch: string | null;
}

export interface VariantGroupDto {
  id: string;
  labelEn: string;
  labelBn: string;
  kind: 'button' | 'swatch';
  options: VariantOptionDto[];
  /** Selection key → `ProductVariant.id`. See `combinationKey()`. */
  combinations: Record<string, string>;
}

export interface ReviewDto {
  id: string;
  authorName: string;
  rating: number;
  createdAt: string;
  bodyEn: string;
  bodyBn: string;
  isVerifiedPurchase: boolean;
  helpfulCount: number;
}

export interface ProductDetailDto extends ProductDto {
  variantGroups: VariantGroupDto[];
  reviews: ReviewDto[];
  ratingBreakdown: number[];
  featuresEn: string[];
  featuresBn: string[];
  specs: { labelEn: string; labelBn: string; valueEn: string; valueBn: string }[];
  tintColor: string;
  accentColor: string;
}

// ─── Prisma row shapes (explicit selects, never `SELECT *`) ───────────────

/** The product columns every list endpoint needs — nothing more. */
export const PRODUCT_LIST_SELECT = {
  id: true,
  slug: true,
  sku: true,
  nameEn: true,
  nameBn: true,
  descriptionEn: true,
  descriptionBn: true,
  basePricePoisha: true,
  discountPercent: true,
  discountPricePoisha: true,
  originalPricePoisha: true,
  ratingAvg: true,
  reviewCount: true,
  isFeatured: true,
  isFlashSale: true,
  flashSalePricePoisha: true,
  flashSaleEnd: true,
  isPublished: true,
  isDraft: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, slug: true, nameEn: true, nameBn: true } },
  brand: { select: { id: true, slug: true, nameEn: true, nameBn: true, color: true } },
  images: {
    select: { id: true, url: true, altEn: true, altBn: true, isMain: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  variants: {
    select: {
      id: true,
      sku: true,
      nameEn: true,
      nameBn: true,
      pricePoisha: true,
      stock: true,
      isActive: true,
    },
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

export type ProductListRow = {
  id: string;
  slug: string;
  sku: string;
  nameEn: string;
  nameBn: string;
  descriptionEn: string | null;
  descriptionBn: string | null;
  basePricePoisha: number;
  discountPercent: number;
  discountPricePoisha: number | null;
  originalPricePoisha: number;
  ratingAvg: number;
  reviewCount: number;
  isFeatured: boolean;
  isFlashSale: boolean;
  flashSalePricePoisha: number | null;
  flashSaleEnd: Date | null;
  isPublished: boolean;
  isDraft: boolean;
  createdAt: Date;
  updatedAt: Date;
  category: Pick<Category, 'id' | 'slug' | 'nameEn' | 'nameBn'>;
  brand: Pick<Brand, 'id' | 'slug' | 'nameEn' | 'nameBn' | 'color'> | null;
  images: Pick<ProductImage, 'id' | 'url' | 'altEn' | 'altBn' | 'isMain' | 'sortOrder'>[];
  variants: {
    id: string;
    sku: string;
    nameEn: string;
    nameBn: string;
    pricePoisha: number;
    stock: number;
    isActive: boolean;
  }[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Stock state from real quantity.
 *
 * The thresholds match the mock layer (`stockStatusOf`), so a product does not
 * change its badge when the storefront flips from fixtures to the API.
 */
export function stockStatusOf(quantity: number): StockStatus {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= 5) return 'low_stock';
  return 'in_stock';
}

/**
 * Total available stock for a product.
 *
 * A product with variants has no meaningful stock of its own — the variants
 * carry it. A variant-less product's stock lives in `WarehouseStock`, which the
 * caller sums and passes in as `warehouseStock`. Both paths land here so the
 * rule is written once.
 */
function totalStock(row: ProductListRow, warehouseStock: number): number {
  if (row.variants.length > 0) {
    return row.variants.reduce((sum, v) => sum + v.stock, 0);
  }
  return warehouseStock;
}

/**
 * Badges, derived from the row rather than stored.
 *
 * Same rules as the mock layer so the storefront looks identical after the
 * flip: a discount is a sale, a high review count is a bestseller, and a
 * recently created product is new. `trending` has no column behind it yet, so
 * it is not invented here — a badge with no data is a lie on a card.
 */
function badgesFor(row: ProductListRow): ProductBadge[] {
  const badges: ProductBadge[] = [];
  if (row.discountPercent > 0) badges.push('sale');
  if (row.reviewCount > 300) badges.push('bestseller');

  const ageDays = (Date.now() - row.createdAt.getTime()) / 86_400_000;
  if (ageDays <= 30) badges.push('new');

  return badges;
}

/**
 * The price the customer actually pays.
 *
 * `basePricePoisha` is the current price in this schema (the seed writes the
 * sale price there and keeps the struck-through value in
 * `originalPricePoisha`), so the payable price is simply the base price.
 */
function payablePrice(row: ProductListRow): number {
  return row.basePricePoisha;
}

// ─── Mappers ──────────────────────────────────────────────────────────────

/**
 * One product row → `ProductDto`.
 *
 * `warehouseStock` is the summed `WarehouseStock.quantity` for a variant-less
 * product. Callers that already have it pass it in; a caller that does not gets
 * 0, which reads as out of stock rather than as an invented number.
 */
export function toProductDto(row: ProductListRow, warehouseStock = 0): ProductDto {
  if (row.isDraft || !row.isPublished) {
    throw new Error(
      `toProductDto: refusing to map unpublished product ${row.sku}. ` +
        'Public queries must filter isPublished=true AND isDraft=false.',
    );
  }

  const stock = totalStock(row, warehouseStock);

  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    nameEn: row.nameEn,
    nameBn: row.nameBn,
    descriptionEn: row.descriptionEn,
    descriptionBn: row.descriptionBn,
    category: {
      id: row.category.id,
      slug: row.category.slug,
      nameEn: row.category.nameEn,
      nameBn: row.category.nameBn,
    },
    brand: row.brand
      ? {
          id: row.brand.id,
          slug: row.brand.slug,
          nameEn: row.brand.nameEn,
          nameBn: row.brand.nameBn,
          color: row.brand.color,
        }
      : null,
    pricePoisha: payablePrice(row),
    originalPricePoisha: row.originalPricePoisha,
    discountPercent: row.discountPercent,
    images: row.images.map((image) => ({
      id: image.id,
      url: image.url,
      altEn: image.altEn ?? row.nameEn,
      altBn: image.altBn ?? row.nameBn,
      isMain: image.isMain,
      sortOrder: image.sortOrder,
    })),
    variants: row.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      nameEn: variant.nameEn,
      nameBn: variant.nameBn,
      pricePoisha: variant.pricePoisha,
      stock: variant.stock,
      stockStatus: stockStatusOf(variant.stock),
      isActive: variant.isActive,
    })),
    rating: row.ratingAvg,
    reviewCount: row.reviewCount,
    stockStatus: stockStatusOf(stock),
    stockQuantity: stock,
    isFeatured: row.isFeatured,
    isFlashSale: row.isFlashSale,
    flashSalePricePoisha: row.flashSalePricePoisha,
    flashSaleEndsAt: row.flashSaleEnd?.toISOString() ?? null,
    badges: badgesFor(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A category row (with children and a product count) → `CategoryDto`. */
export function toCategoryDto(
  row: Category & { children?: Category[] },
  productCount: number,
  subcategoryCounts: Map<string, number>,
): CategoryDto {
  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.nameEn,
    nameBn: row.nameBn,
    accentColor: row.accentColor ?? '#C51F4B',
    lightTintColor: row.lightTintColor ?? '#F7DCE4',
    iconEmoji: row.iconEmoji ?? '🛍️',
    sortOrder: row.sortOrder,
    productCount,
    subcategories: (row.children ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((child) => ({
        id: child.id,
        slug: child.slug,
        nameEn: child.nameEn,
        nameBn: child.nameBn,
        productCount: subcategoryCounts.get(child.id) ?? 0,
      })),
  };
}

/** A brand row → `BrandDto`. */
export function toBrandDto(row: Brand, productCount: number): BrandDto {
  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.nameEn,
    nameBn: row.nameBn,
    logo: row.logo,
    taglineEn: row.taglineEn,
    taglineBn: row.taglineBn,
    color: row.color,
    isOwnBrand: row.isOwnBrand,
    sortOrder: row.sortOrder,
    productCount,
  };
}

/** An approved review row (with its author) → `ReviewDto`. */
export function toReviewDto(row: {
  id: string;
  rating: number;
  createdAt: Date;
  contentEn: string | null;
  contentBn: string | null;
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  user: { name: string };
}): ReviewDto {
  return {
    id: row.id,
    authorName: row.user.name,
    rating: row.rating,
    createdAt: row.createdAt.toISOString(),
    bodyEn: row.contentEn ?? '',
    bodyBn: row.contentBn ?? '',
    isVerifiedPurchase: row.isVerifiedPurchase,
    helpfulCount: row.helpfulCount,
  };
}

/** A specification row → the detail DTO's spec shape. */
export function toSpecDto(row: {
  labelEn: string;
  labelBn: string;
  valueEn: string;
  valueBn: string;
}) {
  return {
    labelEn: row.labelEn,
    labelBn: row.labelBn,
    valueEn: row.valueEn,
    valueBn: row.valueBn,
  };
}

/**
 * Rating histogram, index 0 = 5 stars.
 *
 * Derived from the product's own average rather than a fixed distribution, so
 * a 3.2-rated product does not display a histogram that implies 4.6. Same
 * formula as the mock layer, so the bars do not jump when the API takes over.
 */
export function buildRatingBreakdown(rating: number, reviewCount: number): number[] {
  if (reviewCount <= 0) return [0, 0, 0, 0, 0];

  const weights = [5, 4, 3, 2, 1].map((star) => {
    const distance = Math.abs(star - rating);
    return Math.max(0, 1 - distance / 2.5) ** 2;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  const percents = weights.map((w) => Math.round((w / total) * 100));

  // Force the sum to 100 by adjusting the largest bucket — a breakdown that
  // adds to 98% looks like a bug to anyone who checks.
  const drift = 100 - percents.reduce((sum, p) => sum + p, 0);
  const largest = percents.indexOf(Math.max(...percents));
  if (largest >= 0) percents[largest] = (percents[largest] ?? 0) + drift;

  return percents;
}

/**
 * Groups a product's variants by their axis, for the storefront's pill UI.
 *
 * The wire's `ProductVariantDto` is flat and carries no axis, which is right
 * for the cart (it needs an id and a price) and useless for the detail page
 * (it needs "Size: S M L XL"). This rebuilds the group shape from the option's
 * `ProductAttribute`, preserving the attribute's own order so the pills do not
 * reshuffle between requests.
 *
 * Since Phase 8 a variant is a full *combination* across the axes, so the same
 * option value appears once per variant that carries it. The groups therefore
 * dedupe by value, and the mapping from a selection to a real variant id is
 * published separately as `combinations` — see `combinationKey()`.
 *
 * `priceDeltaPoisha` is a delta because the reference computes `p.p + o.d` for
 * the selected combination; the variant's own `pricePoisha` stays absolute.
 */
export function toVariantGroups(
  variants: {
    id: string;
    nameEn: string;
    nameBn: string;
    pricePoisha: number;
    stock: number;
    sortOrder: number;
    options: {
      valueEn: string;
      valueBn: string;
      attribute: { id: string; nameEn: string; nameBn: string; type: string; sortOrder: number };
    }[];
  }[],
  _basePricePoisha: number,
): VariantGroupDto[] {
  const groups = new Map<string, VariantGroupDto & { sortOrder: number }>();
  const combinations: Record<string, string> = {};

  if (variants.length === 0) return [];

  // The cheapest variant is the all-first-options combination, whose deltas are
  // all zero. Every option's delta is therefore its cheapest containing
  // variant's price minus this floor — exact, because deltas are additive.
  const floorPrice = Math.min(...variants.map((variant) => variant.pricePoisha));

  for (const variant of variants) {
    combinations[combinationKey(variant.options.map((option) => ({
      attributeId: option.attribute.id,
      valueEn: option.valueEn,
    })))] = variant.id;

    for (const option of variant.options) {
      const { attribute } = option;
      let group = groups.get(attribute.id);

      if (!group) {
        group = {
          id: attribute.id,
          labelEn: attribute.nameEn,
          labelBn: attribute.nameBn,
          // Only colour renders swatches; every other axis is a labelled pill.
          kind: attribute.type === 'COLOR' ? 'swatch' : 'button',
          options: [],
          combinations,
          sortOrder: attribute.sortOrder,
        };
        groups.set(attribute.id, group);
      }

      const existing = group.options.find((o) => o.nameEn === option.valueEn);
      if (existing) {
        // An option is selectable while *any* combination carrying it has
        // stock, so the pill takes the best of its variants, not the first.
        existing.stock = Math.max(existing.stock, variant.stock);
        existing.priceDeltaPoisha = Math.min(
          existing.priceDeltaPoisha,
          variant.pricePoisha - floorPrice,
        );
        continue;
      }

      group.options.push({
        valueKey: `${attribute.id}:${option.valueEn}`,
        nameEn: option.valueEn,
        nameBn: option.valueBn,
        priceDeltaPoisha: variant.pricePoisha - floorPrice,
        stock: variant.stock,
        // The reference's four swatch hexes live in the catalog, not the DB -
        // the seed stores the colour name only, so the hex is resolved by name.
        swatch: attribute.type === 'COLOR' ? SWATCH_HEX[option.valueEn] ?? null : null,
      });
    }
  }

  return [...groups.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ sortOrder: _sortOrder, ...group }) => ({
      ...group,
      combinations,
      options: group.options.sort((a, b) => a.nameEn.localeCompare(b.nameEn)),
    }));
}

/**
 * The stable key for one selection: every `attributeId:value` pair, sorted.
 *
 * The client builds the same string from its selected options, so a selection
 * resolves to a variant id without the client having to know the combination
 * table's shape. Sorting makes the key independent of axis order.
 */
export function combinationKey(
  selection: { attributeId: string; valueEn: string }[],
): string {
  return selection
    .map((part) => `${part.attributeId}:${part.valueEn}`)
    .sort()
    .join('|');
}

/** The reference's four swatches, verbatim (oshoppingbd.html L720). */
const SWATCH_HEX: Record<string, string> = {
  Black: '#1e2430',
  Navy: '#253858',
  Crimson: '#C51F4B',
  Sand: '#D9B99B',
};
