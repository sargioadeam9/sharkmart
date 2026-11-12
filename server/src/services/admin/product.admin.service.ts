/**
 * Admin product DTOs — the read shape for the panel, not the storefront.
 *
 * ── Why this file exists at all ─────────────────────────────────────────────
 *
 * `services/mappers.ts` produces `ProductDto`, which is the frozen storefront
 * contract (`src/types/catalog.ts`). It refuses to emit a draft
 * (mappers.ts:324) and it carries no barcode, no publish flags, no archived
 * state. The admin list needs all of those — it is a list *of* drafts as much as
 * of live products.
 *
 * So this is a second mapper with a second select. It does not import
 * `mapProductRows`, and `ProductDto` is not widened. A field added here is a
 * field the panel needs; a field added there is a contract change.
 *
 * ── The stock rule ─────────────────────────────────────────────────────────
 *
 * `Product` has no stock column (AGENTS.md landmine, schema.prisma:246). Stock
 * is either on the variants or in `WarehouseStock`, and which one depends on
 * whether the product has variants:
 *
 *   variants exist  -> sum(ProductVariant.stock)
 *   no variants     -> sum(WarehouseStock.quantity where variantId is null)
 *
 * That is the same rule `totalStock()` in mappers.ts:277 applies, and it is
 * applied here deliberately rather than re-derived: an operator looking at the
 * admin badge and the storefront badge must see the same number. A plain
 * `SUM(WarehouseStock.quantity)` would report 0 for every variant product,
 * because a variant product's warehouse rows are keyed by variant.
 */

import type { Prisma } from '@prisma/client';

// ─── Wire types ────────────────────────────────────────────────────────────

export type AdminStockStatus = 'in_stock' | 'low_stock' | 'out_of_stock';

export type AdminProductStatus = 'published' | 'draft' | 'archived';

export interface AdminProductListItem {
  id: string;
  slug: string;
  sku: string;
  barcode: string | null;
  nameEn: string;
  nameBn: string;
  categoryId: string;
  categoryNameEn: string;
  categoryNameBn: string;
  brandId: string | null;
  brandNameEn: string | null;
  brandNameBn: string | null;
  basePricePoisha: number;
  discountPercent: number;
  discountPricePoisha: number | null;
  originalPricePoisha: number;
  /** The price the customer actually pays, computed server-side. */
  payablePoisha: number;
  stock: number;
  stockStatus: AdminStockStatus;
  isPublished: boolean;
  isDraft: boolean;
  isFeatured: boolean;
  isFlashSale: boolean;
  archivedAt: string | null;
  status: AdminProductStatus;
  imageUrl: string | null;
  imageCount: number;
  variantCount: number;
  updatedAt: string;
  createdAt: string;
}

export interface AdminProductImage {
  id: string;
  url: string;
  altEn: string | null;
  altBn: string | null;
  sortOrder: number;
  isMain: boolean;
}

export interface AdminProductVariant {
  id: string;
  sku: string;
  barcode: string | null;
  nameEn: string;
  nameBn: string;
  pricePoisha: number;
  stock: number;
  reservedStock: number;
  sortOrder: number;
  isActive: boolean;
  options: Array<{
    id: string;
    attributeId: string;
    attributeNameEn: string;
    attributeNameBn: string;
    valueEn: string;
    valueBn: string;
  }>;
}

export interface AdminProductDetail extends AdminProductListItem {
  descriptionEn: string | null;
  descriptionBn: string | null;
  flashSalePricePoisha: number | null;
  flashSaleStart: string | null;
  flashSaleEnd: string | null;
  flashSaleStock: number | null;
  flashSaleSold: number;
  metaTitleEn: string | null;
  metaTitleBn: string | null;
  metaDescEn: string | null;
  metaDescBn: string | null;
  ratingAvg: number;
  reviewCount: number;
  images: AdminProductImage[];
  variants: AdminProductVariant[];
  specifications: Array<{
    id: string;
    labelEn: string;
    labelBn: string;
    valueEn: string;
    valueBn: string;
    sortOrder: number;
  }>;
  details: Array<{
    id: string;
    section: string;
    contentEn: string | null;
    contentBn: string | null;
    sortOrder: number;
  }>;
}

// ─── Selects ───────────────────────────────────────────────────────────────

/**
 * The list select — one row per product, no children except what the row needs.
 *
 * `images` is `take: 1` ordered by main-then-sort so the thumbnail is the main
 * image when one is set. `_count` gives the image and variant counts without
 * loading either collection.
 */
export const ADMIN_PRODUCT_LIST_SELECT = {
  id: true,
  slug: true,
  sku: true,
  barcode: true,
  nameEn: true,
  nameBn: true,
  categoryId: true,
  brandId: true,
  basePricePoisha: true,
  discountPercent: true,
  discountPricePoisha: true,
  originalPricePoisha: true,
  isPublished: true,
  isDraft: true,
  isFeatured: true,
  isFlashSale: true,
  archivedAt: true,
  updatedAt: true,
  createdAt: true,
  category: { select: { nameEn: true, nameBn: true } },
  brand: { select: { nameEn: true, nameBn: true } },
  images: {
    select: { url: true },
    orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }],
    take: 1,
  },
  _count: { select: { images: true, variants: true } },
} satisfies Prisma.ProductSelect;

export type AdminProductListRow = Prisma.ProductGetPayload<{
  select: typeof ADMIN_PRODUCT_LIST_SELECT;
}>;

/** The detail select — everything the editor renders. */
export const ADMIN_PRODUCT_DETAIL_SELECT = {
  ...ADMIN_PRODUCT_LIST_SELECT,
  descriptionEn: true,
  descriptionBn: true,
  flashSalePricePoisha: true,
  flashSaleStart: true,
  flashSaleEnd: true,
  flashSaleStock: true,
  flashSaleSold: true,
  metaTitleEn: true,
  metaTitleBn: true,
  metaDescEn: true,
  metaDescBn: true,
  ratingAvg: true,
  reviewCount: true,
  images: {
    select: { id: true, url: true, altEn: true, altBn: true, sortOrder: true, isMain: true },
    orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }],
  },
  variants: {
    select: {
      id: true,
      sku: true,
      barcode: true,
      nameEn: true,
      nameBn: true,
      pricePoisha: true,
      stock: true,
      reservedStock: true,
      sortOrder: true,
      isActive: true,
      options: {
        select: {
          id: true,
          attributeId: true,
          valueEn: true,
          valueBn: true,
          attribute: { select: { nameEn: true, nameBn: true } },
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
  },
  specifications: {
    select: {
      id: true,
      labelEn: true,
      labelBn: true,
      valueEn: true,
      valueBn: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: 'asc' },
  },
  details: {
    select: { id: true, section: true, contentEn: true, contentBn: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  },
} satisfies Prisma.ProductSelect;

export type AdminProductDetailRow = Prisma.ProductGetPayload<{
  select: typeof ADMIN_PRODUCT_DETAIL_SELECT;
}>;

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Stock state from a total quantity.
 *
 * Same thresholds as `stockStatusOf()` in mappers.ts:263 so the admin badge and
 * the storefront badge cannot disagree about what "low" means.
 */
export function adminStockStatusOf(quantity: number): AdminStockStatus {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= 5) return 'low_stock';
  return 'in_stock';
}

/**
 * The product's status, in one place.
 *
 * Archived wins over everything: an archived product that is still flagged
 * published is archived, because that is what the operator asked for. A product
 * is published only when both flags agree, matching the public `PUBLISHED`
 * filter — a row that is `isPublished` but still `isDraft` is a draft.
 */
export function adminProductStatus(row: {
  archivedAt: Date | null;
  isPublished: boolean;
  isDraft: boolean;
}): AdminProductStatus {
  if (row.archivedAt) return 'archived';
  return row.isPublished && !row.isDraft ? 'published' : 'draft';
}

/**
 * The price the customer pays.
 *
 * `basePricePoisha` is the current price in this schema (the seed writes the
 * sale price there and keeps the struck-through value in `originalPricePoisha`),
 * so the payable price is the base price. Same rule as `payablePrice()` in
 * mappers.ts:310 — the admin must not show a different "customer pays" than the
 * storefront charges.
 */
export function adminPayablePoisha(row: { basePricePoisha: number }): number {
  return row.basePricePoisha;
}

// ─── Mappers ───────────────────────────────────────────────────────────────

/** One list row → the admin list item. `stock` is resolved by the caller. */
export function toAdminListItem(row: AdminProductListRow, stock: number): AdminProductListItem {
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    barcode: row.barcode,
    nameEn: row.nameEn,
    nameBn: row.nameBn,
    categoryId: row.categoryId,
    categoryNameEn: row.category.nameEn,
    categoryNameBn: row.category.nameBn,
    brandId: row.brandId,
    brandNameEn: row.brand?.nameEn ?? null,
    brandNameBn: row.brand?.nameBn ?? null,
    basePricePoisha: row.basePricePoisha,
    discountPercent: row.discountPercent,
    discountPricePoisha: row.discountPricePoisha,
    originalPricePoisha: row.originalPricePoisha,
    payablePoisha: adminPayablePoisha(row),
    stock,
    stockStatus: adminStockStatusOf(stock),
    isPublished: row.isPublished,
    isDraft: row.isDraft,
    isFeatured: row.isFeatured,
    isFlashSale: row.isFlashSale,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    status: adminProductStatus(row),
    imageUrl: row.images[0]?.url ?? null,
    imageCount: row._count.images,
    variantCount: row._count.variants,
    updatedAt: row.updatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** One detail row → the full editor payload. */
export function toAdminDetail(row: AdminProductDetailRow, stock: number): AdminProductDetail {
  return {
    ...toAdminListItem(row, stock),
    descriptionEn: row.descriptionEn,
    descriptionBn: row.descriptionBn,
    flashSalePricePoisha: row.flashSalePricePoisha,
    flashSaleStart: row.flashSaleStart?.toISOString() ?? null,
    flashSaleEnd: row.flashSaleEnd?.toISOString() ?? null,
    flashSaleStock: row.flashSaleStock,
    flashSaleSold: row.flashSaleSold,
    metaTitleEn: row.metaTitleEn,
    metaTitleBn: row.metaTitleBn,
    metaDescEn: row.metaDescEn,
    metaDescBn: row.metaDescBn,
    ratingAvg: row.ratingAvg,
    reviewCount: row.reviewCount,
    images: row.images.map((image) => ({
      id: image.id,
      url: image.url,
      altEn: image.altEn,
      altBn: image.altBn,
      sortOrder: image.sortOrder,
      isMain: image.isMain,
    })),
    variants: row.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      nameEn: variant.nameEn,
      nameBn: variant.nameBn,
      pricePoisha: variant.pricePoisha,
      stock: variant.stock,
      reservedStock: variant.reservedStock,
      sortOrder: variant.sortOrder,
      isActive: variant.isActive,
      options: variant.options.map((option) => ({
        id: option.id,
        attributeId: option.attributeId,
        attributeNameEn: option.attribute.nameEn,
        attributeNameBn: option.attribute.nameBn,
        valueEn: option.valueEn,
        valueBn: option.valueBn,
      })),
    })),
    specifications: row.specifications,
    details: row.details.map((detail) => ({
      id: detail.id,
      section: detail.section,
      contentEn: detail.contentEn,
      contentBn: detail.contentBn,
      sortOrder: detail.sortOrder,
    })),
  };
}
