/**
 * Catalog domain types — the wire shapes for products, categories and brands.
 *
 * These are the shapes the API returns and the mock layer must reproduce
 * exactly. They are deliberately NOT the Prisma models: the database stores
 * `Decimal` and relation objects, the wire carries integer poisha and flat
 * display-ready fields.
 *
 * Bilingual law: every user-facing string is a pair. There is no `name`.
 */

import type { Lang } from '@/lib/format';

export type { Lang };

/** Stock state is computed server-side so the UI never guesses. */
export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

/** Badge flags the reference renders on a product card. */
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
  /** Absolute price of this variant, in poisha. Not a delta. */
  pricePoisha: number;
  stock: number;
  stockStatus: StockStatus;
  isActive: boolean;
}

/**
 * A product as the storefront consumes it.
 *
 * Money fields, all integer poisha:
 *   pricePoisha          what the customer pays now
 *   originalPricePoisha  the struck-through price, 0 when there is no discount
 *   discountPercent      0 when there is no discount
 */
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
  /** Hex accent — data, so it is allowed inline in style props. */
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

/**
 * One selectable option inside a variant group.
 *
 * `priceDeltaPoisha` is a delta, not an absolute price, because the reference
 * computes `p.p + o.d` for the selected combination. The DTO's own
 * `ProductVariantDto.pricePoisha` stays absolute for the cart; this is the
 * display-side shape the detail page needs.
 */
export interface VariantOptionDto {
  /**
   * Identity of this option *value*: `attributeId:value`. Not a variant id —
   * one value spans every variant that carries it. Resolve a selection through
   * `VariantGroupDto.combinations`.
   */
  valueKey: string;
  nameEn: string;
  nameBn: string;
  /** Added to the base price. Integer poisha, may be 0. */
  priceDeltaPoisha: number;
  stock: number;
  /** Hex swatch. Present only on colour groups. */
  swatch: string | null;
}

/** A variant axis: Size, Colour, Weight, Model, Edition, Pack. */
export interface VariantGroupDto {
  id: string;
  /** The axis label, bilingual. */
  labelEn: string;
  labelBn: string;
  /** `swatch` renders circles, `button` renders labelled pills. */
  kind: 'button' | 'swatch';
  options: VariantOptionDto[];
  /**
   * Selection → real `ProductVariant.id`.
   *
   * A variant is a full combination across the axes, so no single group can
   * name the variant a selection resolves to. The key is every
   * `attributeId:value` pair sorted and joined with `|`; the client builds the
   * same string from its selected options. Identical on every group of a
   * product — it is one table, repeated for convenience.
   */
  combinations: Record<string, string>;
}

/** A single customer review. Never fabricated — absent means an empty state. */
export interface ReviewDto {
  id: string;
  authorName: string;
  rating: number;
  /** ISO date. Formatted at the edge. */
  createdAt: string;
  bodyEn: string;
  bodyBn: string;
  isVerifiedPurchase: boolean;
  helpfulCount: number;
}

/**
 * Everything the product detail page needs beyond the base `ProductDto`.
 *
 * Kept as a separate interface rather than widening `ProductDto`: the list
 * endpoints do not carry reviews or variant groups, and making them optional on
 * the shared type would push `undefined` checks into every card.
 */
export interface ProductDetailDto extends ProductDto {
  variantGroups: VariantGroupDto[];
  reviews: ReviewDto[];
  /** Rating histogram, index 0 = 5 stars. Empty when there are no reviews. */
  ratingBreakdown: number[];
  /** Bullet features for the Features tab. Empty renders nothing. */
  featuresEn: string[];
  featuresBn: string[];
  /** Key/value rows for the Specs tab. */
  specs: { labelEn: string; labelBn: string; valueEn: string; valueBn: string }[];
  /** Category light tint, for the gallery backdrop. */
  tintColor: string;
  /** Category accent, for hover borders. */
  accentColor: string;
}

/** Query shape for the product list endpoint. */
export interface ProductListQuery {
  page?: number;
  limit?: number;
  category?: string;
  brand?: string;
  q?: string;
  minPricePoisha?: number;
  maxPricePoisha?: number;
  inStockOnly?: boolean;
  onDiscountOnly?: boolean;
  sort?: 'relevance' | 'newest' | 'popular' | 'price_asc' | 'price_desc' | 'rating';
}

/** Picks the right half of a bilingual pair. One helper, used everywhere. */
export function localized(
  lang: Lang,
  en: string | null | undefined,
  bn: string | null | undefined,
): string {
  const value = lang === 'bn' ? bn : en;
  return value ?? en ?? bn ?? '';
}
