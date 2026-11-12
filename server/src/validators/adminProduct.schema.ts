/**
 * Zod schemas for the admin products API — security.md §7.
 *
 * Styled like `catalog.schema.ts`: every object is `.strict()`, every numeric
 * query field is coerced and bounded, and the bounds are real (an admin asking
 * for `limit=100000` is the same denial-of-service as a stranger asking).
 *
 * Three rules specific to this surface:
 *
 *   1. **Money is integer poisha.** `basePricePoisha` and friends reject floats
 *      and numeric strings. A price of `1299.5` is not a price; it is a bug that
 *      would round differently in three places.
 *   2. **Create cannot set publish state.** `isPublished`, `isDraft` and
 *      `archivedAt` are absent from the create schema on purpose — a new product
 *      always starts as a draft, whatever the body says. Publishing is its own
 *      endpoint with its own preconditions.
 *   3. **PATCH is partial but not permissive.** Every field is `.optional()`, and
 *      an empty object is rejected: a PATCH that changes nothing should not
 *      write an audit row claiming it did.
 */

import { z } from 'zod';

/** Page size ceiling for the admin list. Higher than the public 100? No — same cap. */
export const ADMIN_MAX_LIMIT = 100;
export const ADMIN_DEFAULT_LIMIT = 20;

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(ADMIN_MAX_LIMIT).default(ADMIN_DEFAULT_LIMIT);

/** A slug: lowercase, digits, hyphens. Rejects path traversal before Prisma. */
const slug = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug');

/**
 * A positive integer amount of poisha.
 *
 * `z.number().int()` rejects `1299.5` and `"1299"` both, which is the point:
 * money arrives as a JSON number and must already be whole poisha. `z.coerce`
 * would silently turn `"1299"` into a number and hide a client bug.
 */
const poisha = z.number().int('must be an integer number of poisha');

/** A non-negative integer poisha amount, for optional price fields. */
const poishaNonNegative = z.number().int('must be an integer number of poisha').min(0);

/** Optional bilingual text. Empty string is normalised to null by the service. */
const text = (max: number) => z.string().max(max).optional();

// ─── List ──────────────────────────────────────────────────────────────────

export const adminProductListQuery = z
  .object({
    page,
    limit,
    q: z.string().trim().min(1).max(120).optional(),
    categoryId: z.string().uuid('must be a category id').optional(),
    brandId: z.string().uuid('must be a brand id').optional(),
    /**
     * `all` is the default and means "everything, including archived".
     * The three named states are mutually exclusive by construction.
     */
    status: z.enum(['all', 'published', 'draft', 'archived']).default('all'),
    /**
     * Stock is an aggregate over WarehouseStock, so it cannot be a plain column
     * predicate. The service resolves it to an id set BEFORE pagination — see
     * the note in product.service.ts. Anything else makes `total` lie.
     */
    stock: z.enum(['all', 'in', 'low', 'out']).default('all'),
    sort: z
      .enum(['newest', 'oldest', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'updated'])
      .default('updated'),
  })
  .strict();

export type AdminProductListInput = z.infer<typeof adminProductListQuery>;

// ─── Params ────────────────────────────────────────────────────────────────

export const productIdParams = z.object({ id: z.string().uuid('must be a product id') }).strict();

export const productImageParams = z
  .object({
    id: z.string().uuid('must be a product id'),
    imageId: z.string().uuid('must be an image id'),
  })
  .strict();

export const productVariantParams = z
  .object({
    id: z.string().uuid('must be a product id'),
    variantId: z.string().uuid('must be a variant id'),
  })
  .strict();

// ─── Create ────────────────────────────────────────────────────────────────

/**
 * The fields a create may set.
 *
 * Deliberately absent: `isPublished`, `isDraft`, `archivedAt`, `flashSaleSold`,
 * `ratingAvg`, `reviewCount`. The first three are publish state and belong to
 * the publish/archive endpoints; the last three are aggregates the system owns.
 */
export const adminProductCreateBody = z
  .object({
    nameEn: z.string().trim().min(1, 'nameEn is required').max(200),
    nameBn: z.string().trim().min(1, 'nameBn is required').max(200),
    slug: slug.optional(),
    sku: z.string().trim().min(1, 'sku is required').max(64),
    barcode: text(64),
    categoryId: z.string().uuid('categoryId must be a category id'),
    brandId: z.string().uuid('brandId must be a brand id').nullable().optional(),
    descriptionEn: text(20000),
    descriptionBn: text(20000),
    basePricePoisha: poisha.min(0),
    discountPercent: z.number().int().min(0).max(100).default(0),
    discountPricePoisha: poishaNonNegative.nullable().optional(),
    originalPricePoisha: poishaNonNegative.default(0),
    flashSalePricePoisha: poishaNonNegative.nullable().optional(),
    isFeatured: z.boolean().default(false),
    isFlashSale: z.boolean().default(false),
    flashSaleStart: z.string().datetime().nullable().optional(),
    flashSaleEnd: z.string().datetime().nullable().optional(),
    flashSaleStock: z.number().int().min(0).nullable().optional(),
    metaTitleEn: text(200),
    metaTitleBn: text(200),
    metaDescEn: text(400),
    metaDescBn: text(400),
  })
  .strict()
  .refine(
    (value) =>
      value.discountPricePoisha === null ||
      value.discountPricePoisha === undefined ||
      value.discountPricePoisha < value.basePricePoisha,
    {
      message: 'discountPricePoisha must be less than basePricePoisha',
      path: ['discountPricePoisha'],
    },
  );

export type AdminProductCreateInput = z.infer<typeof adminProductCreateBody>;

// ─── Update ────────────────────────────────────────────────────────────────

/**
 * PATCH — every field optional, at least one required.
 *
 * The same price cross-check as create, but it can only run when both sides are
 * present in the body. When only one is, the service compares against the stored
 * row instead — a partial update must not be able to slip a discount price above
 * the base price by omitting the base price.
 */
export const adminProductUpdateBody = z
  .object({
    nameEn: z.string().trim().min(1).max(200).optional(),
    nameBn: z.string().trim().min(1).max(200).optional(),
    slug: slug.optional(),
    sku: z.string().trim().min(1).max(64).optional(),
    barcode: z.string().trim().max(64).nullable().optional(),
    categoryId: z.string().uuid().optional(),
    brandId: z.string().uuid().nullable().optional(),
    descriptionEn: z.string().max(20000).nullable().optional(),
    descriptionBn: z.string().max(20000).nullable().optional(),
    basePricePoisha: poisha.min(0).optional(),
    discountPercent: z.number().int().min(0).max(100).optional(),
    discountPricePoisha: poishaNonNegative.nullable().optional(),
    originalPricePoisha: poishaNonNegative.optional(),
    flashSalePricePoisha: poishaNonNegative.nullable().optional(),
    isFeatured: z.boolean().optional(),
    isFlashSale: z.boolean().optional(),
    flashSaleStart: z.string().datetime().nullable().optional(),
    flashSaleEnd: z.string().datetime().nullable().optional(),
    flashSaleStock: z.number().int().min(0).nullable().optional(),
    metaTitleEn: z.string().max(200).nullable().optional(),
    metaTitleBn: z.string().max(200).nullable().optional(),
    metaDescEn: z.string().max(400).nullable().optional(),
    metaDescBn: z.string().max(400).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  });

export type AdminProductUpdateInput = z.infer<typeof adminProductUpdateBody>;

// ─── Publish / archive ─────────────────────────────────────────────────────

export const publishBody = z.object({ publish: z.boolean() }).strict();

// ─── Images ────────────────────────────────────────────────────────────────

/**
 * Images are URLs, not uploads.
 *
 * There is no upload infrastructure in this project (no multer, no storage
 * service), and B1 does not invent one. A URL is validated as an http(s) URL so
 * a `javascript:` or `data:` payload cannot be stored and later rendered into an
 * `<img src>`.
 */
const imageUrl = z
  .string()
  .trim()
  .min(1, 'url is required')
  .max(2048)
  .refine((value) => /^https?:\/\//i.test(value), 'url must start with http:// or https://');

export const productImageCreateBody = z
  .object({
    url: imageUrl,
    altEn: text(200),
    altBn: text(200),
    isMain: z.boolean().default(false),
  })
  .strict();

export const productImageReorderBody = z
  .object({
    /** Image ids in their new order. The service verifies they all belong here. */
    imageIds: z.array(z.string().uuid()).min(1).max(50),
  })
  .strict();

export const productImageUpdateBody = z
  .object({
    altEn: z.string().max(200).nullable().optional(),
    altBn: z.string().max(200).nullable().optional(),
    isMain: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  });

// ─── Variants ──────────────────────────────────────────────────────────────

export const variantCreateBody = z
  .object({
    sku: z.string().trim().min(1, 'sku is required').max(64),
    barcode: text(64),
    nameEn: z.string().trim().min(1, 'nameEn is required').max(200),
    nameBn: z.string().trim().min(1, 'nameBn is required').max(200),
    pricePoisha: poisha.min(0),
    stock: z.number().int().min(0).default(0),
    isActive: z.boolean().default(true),
  })
  .strict();

export const variantUpdateBody = z
  .object({
    sku: z.string().trim().min(1).max(64).optional(),
    barcode: z.string().trim().max(64).nullable().optional(),
    nameEn: z.string().trim().min(1).max(200).optional(),
    nameBn: z.string().trim().min(1).max(200).optional(),
    pricePoisha: poisha.min(0).optional(),
    stock: z.number().int().min(0).optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be provided',
  });
