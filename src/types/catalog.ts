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
