/**
 * Admin product service — list, detail, create, update, publish, archive, delete,
 * images and variants.
 *
 * ── The two things that are easy to get wrong here ─────────────────────────
 *
 * **1. Stock filtering must happen before pagination.**
 *
 * `Product` has no stock column. Stock is `SUM(ProductVariant.stock)` for a
 * product with variants, and `SUM(WarehouseStock.quantity)` for one without.
 * Neither is a column, so `?stock=out` cannot be a `where` predicate over the
 * product table.
 *
 * The storefront solves this by filtering the mapped page afterwards
 * (product.service.ts:193) and documents that `total` is then wrong. That is
 * acceptable there because the storefront uses it as a client-side filter and
 * never reads the count. It is NOT acceptable here: the admin list renders
 * "showing 1-20 of N" and a stock filter that leaves N counting the unfiltered
 * set produces a page count that lies, plus pages that are short or empty.
 *
 * So the stock filter resolves to a set of product ids FIRST, and that set goes
 * into the same `where` used by both the page query and the count. One `where`,
 * two queries, no disagreement.
 *
 * The cost is that resolving the set scans the catalog's stock aggregates rather
 * than one page. At this catalog's size (~170 products) that is a handful of
 * milliseconds. If the catalog grows into the tens of thousands this becomes a
 * materialised `totalStock` column maintained by the inventory module, and that
 * is a B4 decision, not a B1 one — noted in HANDOFF.md rather than guessed at.
 *
 * **2. Every mutation is audited in the same transaction.**
 *
 * `withAudit()` from services/audit.service.ts wraps each write, so the change
 * and its `AuditLog` row commit or roll back together (security.md §14). The
 * `ipAddress` comes from `req.ip`, never a header read by hand.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { withAudit, diffChanges } from '../../services/audit.service.js';
import { invalidateTag } from '../../services/cache.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import {
  ADMIN_PRODUCT_DETAIL_SELECT,
  ADMIN_PRODUCT_LIST_SELECT,
  adminPayablePoisha,
  adminProductStatus,
  adminStockStatusOf,
  toAdminDetail,
  toAdminListItem,
  type AdminProductDetail,
  type AdminProductListItem,
  type AdminProductListRow,
} from '../../services/admin/product.admin.service.js';
import type {
  AdminProductCreateInput,
  AdminProductListInput,
  AdminProductUpdateInput,
} from '../../validators/adminProduct.schema.js';

/** Who is acting, and from where. Passed from the route, never guessed. */
export interface Actor {
  userId: string;
  ipAddress: string | null;
}

export interface AdminProductListResult {
  items: AdminProductListItem[];
  total: number;
  page: number;
  limit: number;
}

// ─── Stock resolution ──────────────────────────────────────────────────────

/**
 * Total stock per product, for every product that has any.
 *
 * Two grouped queries, not one per product:
 *
 *   - `ProductVariant.stock` summed by product — this is also the set of
 *     products that HAVE variants.
 *   - `WarehouseStock.quantity` summed by product where `variantId` is null —
 *     variant-less products only, matching how the seed writes them
 *     (seed.ts:738) and how `totalStock()` reads them (mappers.ts:277).
 *
 * A product with variants takes the variant sum even when it is 0; a variant
 * product's warehouse rows are keyed by variant and must not be added on top.
 */
async function stockByProduct(): Promise<Map<string, number>> {
  const [variantSums, warehouseSums] = await Promise.all([
    prisma.productVariant.groupBy({
      by: ['productId'],
      _sum: { stock: true },
    }),
    prisma.warehouseStock.groupBy({
      by: ['productId'],
      where: { variantId: null },
      _sum: { quantity: true },
    }),
  ]);

  const totals = new Map<string, number>();

  for (const row of warehouseSums) {
    totals.set(row.productId, row._sum.quantity ?? 0);
  }
  // Variants win: overwrite, and this also registers variant products that have
  // no warehouse row at all (their total is the variant sum, possibly 0).
  for (const row of variantSums) {
    totals.set(row.productId, row._sum.stock ?? 0);
  }

  return totals;
}

/** Resolves one product's total stock. Used by detail and by the list page. */
async function stockForProduct(productId: string): Promise<number> {
  const variantSum = await prisma.productVariant.aggregate({
    where: { productId },
    _sum: { stock: true },
    _count: { id: true },
  });

  // `_count.id > 0` means the product has variants, so the variant sum is the
  // answer even when it is zero.
  if (variantSum._count.id > 0) return variantSum._sum.stock ?? 0;

  const warehouseSum = await prisma.warehouseStock.aggregate({
    where: { productId, variantId: null },
    _sum: { quantity: true },
  });

  return warehouseSum._sum.quantity ?? 0;
}

/** The product ids whose total stock falls in the requested band. */
async function productIdsByStockBand(band: 'in' | 'low' | 'out'): Promise<string[]> {
  const totals = await stockByProduct();
  const ids: string[] = [];

  for (const [productId, total] of totals) {
    const status = adminStockStatusOf(total);
    if (
      (band === 'out' && status === 'out_of_stock') ||
      (band === 'low' && status === 'low_stock') ||
      (band === 'in' && status === 'in_stock')
    ) {
      ids.push(productId);
    }
  }

  return ids;
}

// ─── Where clause ──────────────────────────────────────────────────────────

/**
 * Builds the one `where` shared by the page query and the count.
 *
 * The status filter is a real column predicate (archivedAt / isPublished /
 * isDraft), so it is cheap. The stock filter is an id set, resolved before this
 * runs — see the file header.
 */
async function whereFor(query: AdminProductListInput): Promise<Prisma.ProductWhereInput> {
  const where: Prisma.ProductWhereInput = {};

  switch (query.status) {
    case 'published':
      where.archivedAt = null;
      where.isPublished = true;
      where.isDraft = false;
      break;
    case 'draft':
      where.archivedAt = null;
      where.NOT = { isPublished: true, isDraft: false };
      break;
    case 'archived':
      where.archivedAt = { not: null };
      break;
    case 'all':
    default:
      /**
       * "All" means every product the panel works with — published and draft —
       * and NOT archived ones.
       *
       * Archived is its own tab, not a state inside "all". If archived rows
       * appeared in the default list, archiving a product would leave it on
       * screen and the operator would conclude the archive did nothing. The
       * `archived` case above is the only way to see them.
       */
      where.archivedAt = null;
      break;
  }

  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.brandId) where.brandId = query.brandId;

  if (query.q) {
    const needle = query.q.trim();
    // The collation is utf8mb4_unicode_ci, so a plain `contains` is already
    // case-insensitive. Bangla has no case, so the same predicate serves both.
    where.OR = [
      { nameEn: { contains: needle } },
      { nameBn: { contains: needle } },
      { sku: { contains: needle } },
      { barcode: { contains: needle } },
      { slug: { contains: needle } },
    ];
  }

  if (query.stock !== 'all') {
    const ids = await productIdsByStockBand(query.stock);
    // An empty set must still narrow to nothing. `in: []` does that correctly
    // in Prisma (no rows), which is what we want: "no products are out of
    // stock" is an empty list, not the whole catalog.
    where.id = { in: ids };
  }

  return where;
}

/** Wire sort key → Prisma orderBy. */
function orderByFor(sort: AdminProductListInput['sort']): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'newest':
      return [{ createdAt: 'desc' }];
    case 'oldest':
      return [{ createdAt: 'asc' }];
    case 'name_asc':
      return [{ nameEn: 'asc' }];
    case 'name_desc':
      return [{ nameEn: 'desc' }];
    case 'price_asc':
      return [{ basePricePoisha: 'asc' }];
    case 'price_desc':
      return [{ basePricePoisha: 'desc' }];
    case 'updated':
    default:
      return [{ updatedAt: 'desc' }];
  }
}

// ─── List ──────────────────────────────────────────────────────────────────

export async function listAdminProducts(
  query: AdminProductListInput,
): Promise<AdminProductListResult> {
  const where = await whereFor(query);
  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: ADMIN_PRODUCT_LIST_SELECT,
      orderBy: orderByFor(query.sort),
      skip,
      take: query.limit,
    }),
    prisma.product.count({ where }),
  ]);

  /**
   * One grouped query for the page's stock, not one per row.
   *
   * The page is at most `limit` rows, so the `in` list is bounded. Products
   * absent from the map have no stock rows at all, which reads as 0.
   */
  const ids = rows.map((row) => row.id);
  const stockMap = new Map<string, number>();

  if (ids.length > 0) {
    const [variantSums, warehouseSums] = await Promise.all([
      prisma.productVariant.groupBy({
        by: ['productId'],
        where: { productId: { in: ids } },
        _sum: { stock: true },
      }),
      prisma.warehouseStock.groupBy({
        by: ['productId'],
        where: { productId: { in: ids }, variantId: null },
        _sum: { quantity: true },
      }),
    ]);

    for (const row of warehouseSums) stockMap.set(row.productId, row._sum.quantity ?? 0);
    for (const row of variantSums) stockMap.set(row.productId, row._sum.stock ?? 0);
  }

  const items = (rows as AdminProductListRow[]).map((row) =>
    toAdminListItem(row, stockMap.get(row.id) ?? 0),
  );

  return { items, total, page: query.page, limit: query.limit };
}

// ─── Detail ────────────────────────────────────────────────────────────────

export async function getAdminProduct(id: string): Promise<AdminProductDetail> {
  const row = await prisma.product.findUnique({
    where: { id },
    select: ADMIN_PRODUCT_DETAIL_SELECT,
  });

  if (!row) throw notFound('Product');

  return toAdminDetail(row, await stockForProduct(id));
}

// ─── Prisma error translation ──────────────────────────────────────────────

/**
 * Turns a unique-constraint violation into a 409 naming the field.
 *
 * A raw P2002 reaching the client is a 500 with a stack trace in dev and an
 * unhelpful "Something went wrong" in production. The admin form needs to know
 * *which* field collided so it can mark it.
 *
 * Prisma reports the constraint by its **index name**, not the column:
 * `Product_sku_key`, `ProductVariant_barcode_key`. The form wants `sku`. So the
 * model prefix and the `_key` suffix are stripped — the first segment after the
 * model is the field, and for a compound index the whole remainder is returned
 * so nothing is silently dropped.
 */
function translateUniqueError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = error.meta?.target;
    const raw = Array.isArray(target) ? String(target[0]) : typeof target === 'string' ? target : '';

    // `Product_sku_key` -> `sku`. A compound `A_b_c_key` -> `b_c`.
    const parts = raw.split('_');
    const field =
      parts.length >= 3 && parts[parts.length - 1] === 'key'
        ? parts.slice(1, -1).join('_')
        : raw || 'value';

    throw new HttpError(409, 'CONFLICT', `That ${field} is already in use.`, {
      field,
    });
  }
  throw error;
}

/** Lowercase slug from a name, for the auto-derived case. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Empty string → null, so a cleared field is stored as absent, not as "". */
function nullish(value: string | undefined | null): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** ISO string → Date, for the flash-sale window fields. */
function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

// ─── Create ────────────────────────────────────────────────────────────────

/**
 * Creates a product. Always a draft, always unpublished.
 *
 * `isPublished` and `isDraft` are not in the create schema at all, so a body
 * that sends them is rejected by `.strict()` rather than silently ignored. That
 * is stronger than "we overwrite them": a client that thinks it published
 * something gets told it did not.
 */
export async function createAdminProduct(
  input: AdminProductCreateInput,
  actor: Actor,
): Promise<AdminProductDetail> {
  const slug = input.slug ?? slugify(input.nameEn);

  if (slug.length === 0) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'A slug could not be derived from nameEn.', {
      field: 'slug',
    });
  }

  try {
    const created = await withAudit<{ id: string; nameEn: string; sku: string; slug: string }>(
      (product) => ({
        userId: actor.userId,
        action: 'product.create',
        entity: 'Product',
        entityId: product.id,
        changes: {
          nameEn: { from: null, to: product.nameEn },
          sku: { from: null, to: product.sku },
          slug: { from: null, to: product.slug },
        },
        ipAddress: actor.ipAddress,
      }),
      async (tx) =>
        tx.product.create({
          data: {
            nameEn: input.nameEn,
            nameBn: input.nameBn,
            slug,
            sku: input.sku,
            barcode: nullish(input.barcode) ?? null,
            categoryId: input.categoryId,
            brandId: input.brandId ?? null,
            descriptionEn: nullish(input.descriptionEn) ?? null,
            descriptionBn: nullish(input.descriptionBn) ?? null,
            basePricePoisha: input.basePricePoisha,
            discountPercent: input.discountPercent,
            discountPricePoisha: input.discountPricePoisha ?? null,
            originalPricePoisha: input.originalPricePoisha,
            flashSalePricePoisha: input.flashSalePricePoisha ?? null,
            isFeatured: input.isFeatured,
            isFlashSale: input.isFlashSale,
            flashSaleStart: toDate(input.flashSaleStart) ?? null,
            flashSaleEnd: toDate(input.flashSaleEnd) ?? null,
            flashSaleStock: input.flashSaleStock ?? null,
            metaTitleEn: nullish(input.metaTitleEn) ?? null,
            metaTitleBn: nullish(input.metaTitleBn) ?? null,
            metaDescEn: nullish(input.metaDescEn) ?? null,
            metaDescBn: nullish(input.metaDescBn) ?? null,
            // Publish state is not negotiable on create.
            isPublished: false,
            isDraft: true,
          },
          select: { id: true, nameEn: true, sku: true, slug: true },
        }),
    );

    await invalidateTag('products');
    return await getAdminProduct(created.id);
  } catch (error) {
    translateUniqueError(error);
  }
}

// ─── Update ────────────────────────────────────────────────────────────────

/**
 * Partial update, audited with a before/after diff.
 *
 * The price cross-check runs against the *merged* state: a PATCH that sends only
 * `basePricePoisha` still has to be checked against the stored
 * `discountPricePoisha`, or a caller could lower the base price below the
 * discount price by omitting it.
 */
export async function updateAdminProduct(
  id: string,
  input: AdminProductUpdateInput,
  actor: Actor,
): Promise<AdminProductDetail> {
  const before = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      nameEn: true,
      nameBn: true,
      slug: true,
      sku: true,
      barcode: true,
      categoryId: true,
      brandId: true,
      descriptionEn: true,
      descriptionBn: true,
      basePricePoisha: true,
      discountPercent: true,
      discountPricePoisha: true,
      originalPricePoisha: true,
      flashSalePricePoisha: true,
      isFeatured: true,
      isFlashSale: true,
      flashSaleStart: true,
      flashSaleEnd: true,
      flashSaleStock: true,
      metaTitleEn: true,
      metaTitleBn: true,
      metaDescEn: true,
      metaDescBn: true,
    },
  });

  if (!before) throw notFound('Product');

  const nextBase = input.basePricePoisha ?? before.basePricePoisha;
  const nextDiscount =
    input.discountPricePoisha !== undefined ? input.discountPricePoisha : before.discountPricePoisha;

  if (nextDiscount !== null && nextDiscount !== undefined && nextDiscount >= nextBase) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      'discountPricePoisha must be less than basePricePoisha.',
      { field: 'discountPricePoisha' },
    );
  }

  /** The explicit field allowlist. Never `data: req.body` (security.md §7). */
  const data: Prisma.ProductUpdateInput = {};

  if (input.nameEn !== undefined) data.nameEn = input.nameEn;
  if (input.nameBn !== undefined) data.nameBn = input.nameBn;
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.sku !== undefined) data.sku = input.sku;
  if (input.barcode !== undefined) data.barcode = nullish(input.barcode) ?? null;
  if (input.categoryId !== undefined) data.category = { connect: { id: input.categoryId } };
  if (input.brandId !== undefined) {
    data.brand = input.brandId === null ? { disconnect: true } : { connect: { id: input.brandId } };
  }
  if (input.descriptionEn !== undefined) data.descriptionEn = nullish(input.descriptionEn) ?? null;
  if (input.descriptionBn !== undefined) data.descriptionBn = nullish(input.descriptionBn) ?? null;
  if (input.basePricePoisha !== undefined) data.basePricePoisha = input.basePricePoisha;
  if (input.discountPercent !== undefined) data.discountPercent = input.discountPercent;
  if (input.discountPricePoisha !== undefined) data.discountPricePoisha = input.discountPricePoisha;
  if (input.originalPricePoisha !== undefined) data.originalPricePoisha = input.originalPricePoisha;
  if (input.flashSalePricePoisha !== undefined) {
    data.flashSalePricePoisha = input.flashSalePricePoisha;
  }
  if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured;
  if (input.isFlashSale !== undefined) data.isFlashSale = input.isFlashSale;
  if (input.flashSaleStart !== undefined) data.flashSaleStart = toDate(input.flashSaleStart) ?? null;
  if (input.flashSaleEnd !== undefined) data.flashSaleEnd = toDate(input.flashSaleEnd) ?? null;
  if (input.flashSaleStock !== undefined) data.flashSaleStock = input.flashSaleStock;
  if (input.metaTitleEn !== undefined) data.metaTitleEn = nullish(input.metaTitleEn) ?? null;
  if (input.metaTitleBn !== undefined) data.metaTitleBn = nullish(input.metaTitleBn) ?? null;
  if (input.metaDescEn !== undefined) data.metaDescEn = nullish(input.metaDescEn) ?? null;
  if (input.metaDescBn !== undefined) data.metaDescBn = nullish(input.metaDescBn) ?? null;

  /**
   * The diff is computed from the *request*, not from the update result.
   *
   * `diffChanges` compares the stored row against the fields the caller sent, so
   * the audit row carries exactly what changed and nothing else. Comparing the
   * whole updated row would list every field that differs from a stale snapshot.
   */
  const changes = diffChanges(
    before as unknown as Record<string, unknown>,
    input as unknown as Record<string, unknown>,
  );

  try {
    await withAudit(
      {
        userId: actor.userId,
        action: 'product.update',
        entity: 'Product',
        entityId: id,
        changes: changes as Prisma.InputJsonValue,
        ipAddress: actor.ipAddress,
      },
      async (tx) => tx.product.update({ where: { id }, data, select: { id: true } }),
    );

    await invalidateTag('products');
    return await getAdminProduct(id);
  } catch (error) {
    translateUniqueError(error);
  }
}

// ─── Publish ───────────────────────────────────────────────────────────────

/**
 * Publishes or unpublishes.
 *
 * Publishing has preconditions, and they are checked **all at once** so the
 * operator gets one list of what is missing rather than a game of whack-a-mole
 * through four round trips. Unpublishing has none — taking something down must
 * never be blocked.
 */
export async function setProductPublished(
  id: string,
  publish: boolean,
  actor: Actor,
): Promise<AdminProductDetail> {
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      nameEn: true,
      nameBn: true,
      categoryId: true,
      basePricePoisha: true,
      archivedAt: true,
      _count: { select: { images: true } },
    },
  });

  if (!product) throw notFound('Product');

  if (publish) {
    if (product.archivedAt) {
      throw new HttpError(
        409,
        'CONFLICT',
        'This product is archived. Restore it before publishing.',
      );
    }

    const missing: Array<{ field: string; message: string }> = [];

    if (!product.nameEn || product.nameEn.trim().length === 0) {
      missing.push({ field: 'nameEn', message: 'English name is required to publish.' });
    }
    if (!product.nameBn || product.nameBn.trim().length === 0) {
      missing.push({ field: 'nameBn', message: 'Bangla name is required to publish.' });
    }
    if (!product.categoryId) {
      missing.push({ field: 'categoryId', message: 'A category is required to publish.' });
    }
    if (!(product.basePricePoisha > 0)) {
      missing.push({
        field: 'basePricePoisha',
        message: 'A price greater than zero is required to publish.',
      });
    }
    if (product._count.images === 0) {
      missing.push({ field: 'images', message: 'At least one image is required to publish.' });
    }

    if (missing.length > 0) {
      throw new HttpError(
        422,
        'VALIDATION_ERROR',
        `Cannot publish: ${missing.length} requirement${missing.length === 1 ? '' : 's'} not met.`,
        missing,
      );
    }
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'product.publish',
      entity: 'Product',
      entityId: id,
      changes: { publish: { from: null, to: publish } },
      ipAddress: actor.ipAddress,
    },
    async (tx) =>
      tx.product.update({
        where: { id },
        data: { isPublished: publish, isDraft: !publish },
        select: { id: true },
      }),
  );

  await invalidateTag('products');
  return await getAdminProduct(id);
}

// ─── Archive ───────────────────────────────────────────────────────────────

/**
 * Soft archive.
 *
 * Sets `archivedAt` and unpublishes in one write. Unpublishing is part of
 * archiving, not a separate step: an archived product that stayed published
 * would keep selling while the operator believes it is put away.
 */
export async function archiveAdminProduct(id: string, actor: Actor): Promise<AdminProductDetail> {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, archivedAt: true },
  });

  if (!product) throw notFound('Product');

  if (product.archivedAt) {
    // Idempotent: archiving an archived product is a no-op, not an error.
    return await getAdminProduct(id);
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'product.archive',
      entity: 'Product',
      entityId: id,
      changes: { archivedAt: { from: null, to: new Date().toISOString() } },
      ipAddress: actor.ipAddress,
    },
    async (tx) =>
      tx.product.update({
        where: { id },
        data: { archivedAt: new Date(), isPublished: false, isDraft: true },
        select: { id: true },
      }),
  );

  await invalidateTag('products');
  return await getAdminProduct(id);
}

// ─── Delete ────────────────────────────────────────────────────────────────

/**
 * Hard delete, only when nothing references the product.
 *
 * `OrderItem.productId` is a required relation with no cascade, so deleting a
 * product that appears in an order would either fail at the database with an
 * opaque FK error or — worse, if the constraint were ever relaxed — orphan the
 * order history. The check is explicit and the refusal is a 409 that tells the
 * operator what to do instead.
 */
export async function deleteAdminProduct(id: string, actor: Actor): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id },
    select: { id: true, nameEn: true, sku: true, _count: { select: { orderItems: true } } },
  });

  if (!product) throw notFound('Product');

  if (product._count.orderItems > 0) {
    throw new HttpError(
      409,
      'CONFLICT',
      `This product appears in ${product._count.orderItems} order line${
        product._count.orderItems === 1 ? '' : 's'
      }. Archive it instead so the order history stays intact.`,
      { orderItemCount: product._count.orderItems },
    );
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'product.delete',
      entity: 'Product',
      entityId: id,
      changes: { nameEn: { from: product.nameEn, to: null }, sku: { from: product.sku, to: null } },
      ipAddress: actor.ipAddress,
    },
    async (tx) => tx.product.delete({ where: { id }, select: { id: true } }),
  );

  await invalidateTag('products');
}

// ─── Images ────────────────────────────────────────────────────────────────

/** Asserts the product exists, and returns its current image count. */
async function requireProduct(productId: string): Promise<{ imageCount: number }> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, _count: { select: { images: true } } },
  });
  if (!product) throw notFound('Product');
  return { imageCount: product._count.images };
}

/**
 * Adds an image by URL.
 *
 * The first image added to a product becomes the main image automatically. A
 * product with images and no main image renders a blank thumbnail everywhere,
 * so "no main" is not a state worth allowing on the add path.
 */
export async function addProductImage(
  productId: string,
  input: { url: string; altEn?: string; altBn?: string; isMain: boolean },
  actor: Actor,
): Promise<AdminProductDetail> {
  const { imageCount } = await requireProduct(productId);

  const shouldBeMain = input.isMain || imageCount === 0;

  const image = await withAudit<{ id: string; url: string }>(
    (created) => ({
      userId: actor.userId,
      action: 'product.image.add',
      entity: 'Product',
      entityId: productId,
      changes: { imageId: { from: null, to: created.id }, url: { from: null, to: created.url } },
      ipAddress: actor.ipAddress,
    }),
    async (tx) => {
      if (shouldBeMain) {
        // Only one main image. Clearing first keeps the invariant even if a
        // previous write left two rows flagged.
        await tx.productImage.updateMany({
          where: { productId, isMain: true },
          data: { isMain: false },
        });
      }

      return tx.productImage.create({
        data: {
          productId,
          url: input.url,
          altEn: nullish(input.altEn) ?? null,
          altBn: nullish(input.altBn) ?? null,
          sortOrder: imageCount,
          isMain: shouldBeMain,
        },
        select: { id: true, url: true },
      });
    },
  );

  await invalidateTag('products');
  void image;
  return await getAdminProduct(productId);
}

/**
 * Reorders images.
 *
 * Every id must belong to this product. Without that check a caller could
 * reorder another product's images by guessing ids — an IDOR, and the exact
 * class of bug security.md §6 calls the #1 eCommerce breach vector.
 */
export async function reorderProductImages(
  productId: string,
  imageIds: string[],
  actor: Actor,
): Promise<AdminProductDetail> {
  await requireProduct(productId);

  const owned = await prisma.productImage.findMany({
    where: { productId },
    select: { id: true },
  });

  const ownedIds = new Set(owned.map((image) => image.id));
  const foreign = imageIds.filter((imageId) => !ownedIds.has(imageId));

  if (foreign.length > 0) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      'One or more images do not belong to this product.',
      { field: 'imageIds', unknown: foreign },
    );
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'product.image.reorder',
      entity: 'Product',
      entityId: productId,
      changes: { order: { from: null, to: imageIds } },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      for (const [index, imageId] of imageIds.entries()) {
        await tx.productImage.update({ where: { id: imageId }, data: { sortOrder: index } });
      }
      return { count: imageIds.length };
    },
  );

  await invalidateTag('products');
  return await getAdminProduct(productId);
}

/** Edits alt text and the main flag on one image. */
export async function updateProductImage(
  productId: string,
  imageId: string,
  input: { altEn?: string | null; altBn?: string | null; isMain?: boolean },
  actor: Actor,
): Promise<AdminProductDetail> {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
    select: { id: true, altEn: true, altBn: true, isMain: true },
  });

  if (!image) throw notFound('Image');

  const data: Prisma.ProductImageUpdateInput = {};
  if (input.altEn !== undefined) data.altEn = nullish(input.altEn) ?? null;
  if (input.altBn !== undefined) data.altBn = nullish(input.altBn) ?? null;
  if (input.isMain !== undefined) data.isMain = input.isMain;

  await withAudit(
    {
      userId: actor.userId,
      action: 'product.image.update',
      entity: 'Product',
      entityId: productId,
      changes: diffChanges(
        image as unknown as Record<string, unknown>,
        input as unknown as Record<string, unknown>,
      ) as Prisma.InputJsonValue,
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      if (input.isMain === true) {
        await tx.productImage.updateMany({
          where: { productId, isMain: true, NOT: { id: imageId } },
          data: { isMain: false },
        });
      }
      return tx.productImage.update({ where: { id: imageId }, data, select: { id: true } });
    },
  );

  await invalidateTag('products');
  return await getAdminProduct(productId);
}

/**
 * Deletes one image.
 *
 * If it was the main image, the next image by sort order is promoted. Leaving a
 * product with images and no main is the state that renders a blank thumbnail.
 */
export async function deleteProductImage(
  productId: string,
  imageId: string,
  actor: Actor,
): Promise<AdminProductDetail> {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
    select: { id: true, url: true, isMain: true },
  });

  if (!image) throw notFound('Image');

  await withAudit(
    {
      userId: actor.userId,
      action: 'product.image.delete',
      entity: 'Product',
      entityId: productId,
      changes: { imageId: { from: image.id, to: null }, url: { from: image.url, to: null } },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });

      if (image.isMain) {
        const next = await tx.productImage.findFirst({
          where: { productId },
          orderBy: { sortOrder: 'asc' },
          select: { id: true },
        });
        if (next) {
          await tx.productImage.update({ where: { id: next.id }, data: { isMain: true } });
        }
      }

      return { id: imageId };
    },
  );

  await invalidateTag('products');
  return await getAdminProduct(productId);
}

// ─── Variants ──────────────────────────────────────────────────────────────

export async function createProductVariant(
  productId: string,
  input: {
    sku: string;
    barcode?: string;
    nameEn: string;
    nameBn: string;
    pricePoisha: number;
    stock: number;
    isActive: boolean;
  },
  actor: Actor,
): Promise<AdminProductDetail> {
  await requireProduct(productId);

  const count = await prisma.productVariant.count({ where: { productId } });

  try {
    await withAudit<{ id: string; sku: string }>(
      (created) => ({
        userId: actor.userId,
        action: 'product.variant.create',
        entity: 'Product',
        entityId: productId,
        changes: { variantId: { from: null, to: created.id }, sku: { from: null, to: created.sku } },
        ipAddress: actor.ipAddress,
      }),
      async (tx) =>
        tx.productVariant.create({
          data: {
            productId,
            sku: input.sku,
            barcode: nullish(input.barcode) ?? null,
            nameEn: input.nameEn,
            nameBn: input.nameBn,
            pricePoisha: input.pricePoisha,
            stock: input.stock,
            isActive: input.isActive,
            sortOrder: count,
          },
          select: { id: true, sku: true },
        }),
    );
  } catch (error) {
    translateUniqueError(error);
  }

  await invalidateTag('products');
  return await getAdminProduct(productId);
}

export async function updateProductVariant(
  productId: string,
  variantId: string,
  input: {
    sku?: string;
    barcode?: string | null;
    nameEn?: string;
    nameBn?: string;
    pricePoisha?: number;
    stock?: number;
    isActive?: boolean;
  },
  actor: Actor,
): Promise<AdminProductDetail> {
  const before = await prisma.productVariant.findFirst({
    where: { id: variantId, productId },
    select: {
      id: true,
      sku: true,
      barcode: true,
      nameEn: true,
      nameBn: true,
      pricePoisha: true,
      stock: true,
      isActive: true,
    },
  });

  if (!before) throw notFound('Variant');

  const data: Prisma.ProductVariantUpdateInput = {};
  if (input.sku !== undefined) data.sku = input.sku;
  if (input.barcode !== undefined) data.barcode = nullish(input.barcode) ?? null;
  if (input.nameEn !== undefined) data.nameEn = input.nameEn;
  if (input.nameBn !== undefined) data.nameBn = input.nameBn;
  if (input.pricePoisha !== undefined) data.pricePoisha = input.pricePoisha;
  if (input.stock !== undefined) data.stock = input.stock;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  try {
    await withAudit(
      {
        userId: actor.userId,
        action: 'product.variant.update',
        entity: 'Product',
        entityId: productId,
        changes: diffChanges(
          before as unknown as Record<string, unknown>,
          input as unknown as Record<string, unknown>,
        ) as Prisma.InputJsonValue,
        ipAddress: actor.ipAddress,
      },
      async (tx) =>
        tx.productVariant.update({ where: { id: variantId }, data, select: { id: true } }),
    );
  } catch (error) {
    translateUniqueError(error);
  }

  await invalidateTag('products');
  return await getAdminProduct(productId);
}

/**
 * Deletes a variant.
 *
 * Refused when an order line references it, for the same reason a product
 * delete is: the order snapshot must stay intact. `OrderItem.variantId` is
 * nullable, but the row that points at this variant would still dangle.
 */
export async function deleteProductVariant(
  productId: string,
  variantId: string,
  actor: Actor,
): Promise<AdminProductDetail> {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId },
    select: { id: true, sku: true, _count: { select: { orderItems: true } } },
  });

  if (!variant) throw notFound('Variant');

  if (variant._count.orderItems > 0) {
    throw new HttpError(
      409,
      'CONFLICT',
      `This variant appears in ${variant._count.orderItems} order line${
        variant._count.orderItems === 1 ? '' : 's'
      }. Deactivate it instead of deleting it.`,
      { orderItemCount: variant._count.orderItems },
    );
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'product.variant.delete',
      entity: 'Product',
      entityId: productId,
      changes: { variantId: { from: variant.id, to: null }, sku: { from: variant.sku, to: null } },
      ipAddress: actor.ipAddress,
    },
    async (tx) => tx.productVariant.delete({ where: { id: variantId }, select: { id: true } }),
  );

  await invalidateTag('products');
  return await getAdminProduct(productId);
}

// ─── Form options ──────────────────────────────────────────────────────────

/**
 * Categories and brands, flat, for the product form's selects.
 *
 * This is a read-only dependency of the product screen, not the Categories or
 * Brands module (that is B3). It exists so the product form is not blocked on a
 * screen that has not been built yet, and it is deliberately minimal: id, slug,
 * names, and the parent for categories so the select can indent a child.
 */
export async function productFormOptions(): Promise<{
  categories: Array<{
    id: string;
    slug: string;
    nameEn: string;
    nameBn: string;
    parentId: string | null;
    isActive: boolean;
  }>;
  brands: Array<{ id: string; slug: string; nameEn: string; nameBn: string; isActive: boolean }>;
}> {
  const [categories, brands] = await Promise.all([
    prisma.category.findMany({
      select: {
        id: true,
        slug: true,
        nameEn: true,
        nameBn: true,
        parentId: true,
        isActive: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    }),
    prisma.brand.findMany({
      select: { id: true, slug: true, nameEn: true, nameBn: true, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    }),
  ]);

  return { categories, brands };
}

/** Re-exported so the route file does not reach into the DTO module. */
export { adminProductStatus, adminPayablePoisha };
