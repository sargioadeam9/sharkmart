/**
 * `/api/v1/admin/brands` — the brand module of the admin panel.
 *
 * ── The delete contract, and why it is the opposite of categories ───────────
 *
 * Read from `information_schema`:
 *
 *   product.brandId -> brand   SET NULL
 *
 * That is the whole rule, and it is the dangerous one. Deleting a brand with 12
 * products does NOT fail. MySQL nulls `brandId` on all 12, the products keep
 * selling, and the storefront renders them with a blank brand name. Nothing
 * raises, nothing logs, and the first symptom is a customer asking why a product
 * has no brand.
 *
 * So this service refuses to delete a brand that has products unless the caller
 * says `?detach=true`. The flag is not a formality — it is the difference
 * between an accident and a decision. When it is given:
 *
 *   - the affected count is computed BEFORE the write,
 *   - the same count is returned in the response so the screen can say
 *     "12 products now have no brand",
 *   - the audit row records the count and the sample product names.
 *
 * ── A note on the STOP condition ───────────────────────────────────────────
 *
 * Changing `product.brandId` to `RESTRICT` would be the safer schema, and it is
 * NOT done here. That is a schema change and a product decision: it would make
 * "delete this brand" impossible until every product is re-branded, which is a
 * workflow the owner has not asked for. It is reported in HANDOFF instead.
 *
 * ── sortOrder ──────────────────────────────────────────────────────────────
 *
 * Same collision as categories: the seed has brands sharing `sortOrder`. New
 * brands append to the end, and `reorder()` renumbers the whole group to 0..n-1
 * in one transaction.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { withAudit } from '../../services/audit.service.js';
import type { BrandCreateInput, BrandUpdateInput } from '../../validators/adminCatalog.schema.js';

export interface Actor {
  userId: string;
  ipAddress: string | null;
}

/** Named refusal, carried in `details.reason`. See `category.service.ts`. */
export type BrandRefusal = 'BRAND_IN_USE';

export interface BrandRow {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  logo: string | null;
  taglineEn: string | null;
  taglineBn: string | null;
  color: string | null;
  isOwnBrand: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  productCount: number;
}

export interface BrandListResult {
  items: BrandRow[];
  total: number;
}

const BRAND_SELECT = {
  id: true,
  slug: true,
  nameEn: true,
  nameBn: true,
  logo: true,
  taglineEn: true,
  taglineBn: true,
  color: true,
  isOwnBrand: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} as const;

type BrandDbRow = Prisma.BrandGetPayload<{ select: typeof BRAND_SELECT }>;

interface CountedBrandRow extends BrandDbRow {
  _count: { products: number };
}

const COUNTED_SELECT = {
  ...BRAND_SELECT,
  _count: { select: { products: true } },
} as const;

function toRow(row: CountedBrandRow): BrandRow {
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
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    productCount: row._count.products,
  };
}

function activeWhere(active: 'all' | 'true' | 'false'): { isActive?: boolean } {
  if (active === 'all') return {};
  return { isActive: active === 'true' };
}

/**
 * GET /admin/brands
 *
 * `sort=products` orders by product count, which is the "which brands actually
 * matter" view. It is done in the database via `_count`, not in the browser —
 * sorting a page of 25 in the client would be correct today and wrong the first
 * time the list is paginated.
 */
export async function listBrands(input: {
  q?: string;
  active: 'all' | 'true' | 'false';
  sort: 'sortOrder' | 'name' | 'products';
}): Promise<BrandListResult> {
  const where: Prisma.BrandWhereInput = { ...activeWhere(input.active) };

  if (input.q) {
    where.OR = [
      { nameEn: { contains: input.q } },
      { nameBn: { contains: input.q } },
      { slug: { contains: input.q } },
      { taglineEn: { contains: input.q } },
    ];
  }

  const orderBy: Prisma.BrandOrderByWithRelationInput[] =
    input.sort === 'name'
      ? [{ nameEn: 'asc' }]
      : input.sort === 'products'
        ? [{ products: { _count: 'desc' } }, { nameEn: 'asc' }]
        : [{ sortOrder: 'asc' }, { nameEn: 'asc' }];

  const rows = (await prisma.brand.findMany({
    where,
    select: COUNTED_SELECT,
    orderBy,
  })) as CountedBrandRow[];

  return { items: rows.map(toRow), total: rows.length };
}

/** GET /admin/brands/:id */
export async function getBrand(id: string): Promise<BrandRow> {
  const row = (await prisma.brand.findUnique({
    where: { id },
    select: COUNTED_SELECT,
  })) as CountedBrandRow | null;

  if (!row) throw notFound('Brand');
  return toRow(row);
}

/**
 * Turns a Prisma unique-constraint failure into the contract's 409.
 *
 * `Brand_slug_key` -> `slug`. Same helper shape as `category.service.ts` and
 * `product.service.ts`, so every module reports a conflict the same way.
 */
function rethrowConflict(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const raw = Array.isArray(error.meta?.target)
      ? (error.meta.target as string[]).join('_')
      : String(error.meta?.target ?? '');
    const parts = raw.split('_');
    const field =
      parts.length >= 3 && parts[parts.length - 1] === 'key'
        ? parts.slice(1, -1).join('_')
        : raw || 'value';

    throw new HttpError(409, 'CONFLICT', `That ${field} is already in use.`, { field });
  }
  throw error;
}

/**
 * POST /admin/brands
 *
 * A brand is always top-level — there is no parent — so `sortOrder` is simply
 * the current brand count, which appends it to the end.
 */
export async function createBrand(input: BrandCreateInput, actor: Actor): Promise<BrandRow> {
  const count = await prisma.brand.count();

  const created = await withAudit<BrandDbRow>(
    (row) => ({
      userId: actor.userId,
      action: 'brand.create',
      entity: 'brand',
      entityId: row.id,
      changes: { after: row as unknown as Prisma.InputJsonValue },
      ipAddress: actor.ipAddress,
    }),
    async (tx) =>
      tx.brand.create({
        data: {
          slug: input.slug,
          nameEn: input.nameEn,
          nameBn: input.nameBn,
          logo: input.logo,
          taglineEn: input.taglineEn,
          taglineBn: input.taglineBn,
          color: input.color,
          isOwnBrand: input.isOwnBrand,
          isActive: input.isActive,
          sortOrder: count,
        },
        select: BRAND_SELECT,
      }),
  ).catch(rethrowConflict);

  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    productCount: 0,
  };
}

/** PATCH /admin/brands/:id */
export async function updateBrand(
  id: string,
  input: BrandUpdateInput,
  actor: Actor,
): Promise<BrandRow> {
  const before = await prisma.brand.findUnique({ where: { id }, select: BRAND_SELECT });
  if (!before) throw notFound('Brand');

  const after = await withAudit<CountedBrandRow>(
    {
      userId: actor.userId,
      action: 'brand.update',
      entity: 'brand',
      entityId: id,
      changes: { before: before as unknown as Prisma.InputJsonValue },
      ipAddress: actor.ipAddress,
    },
    async (tx) =>
      tx.brand.update({
        where: { id },
        data: {
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.nameBn !== undefined ? { nameBn: input.nameBn } : {}),
          ...(input.logo !== undefined ? { logo: input.logo } : {}),
          ...(input.taglineEn !== undefined ? { taglineEn: input.taglineEn } : {}),
          ...(input.taglineBn !== undefined ? { taglineBn: input.taglineBn } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.isOwnBrand !== undefined ? { isOwnBrand: input.isOwnBrand } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        select: COUNTED_SELECT,
      }),
  ).catch(rethrowConflict);

  return toRow(after);
}

/**
 * POST /admin/brands/:id/reorder
 *
 * Brands have no parent, so the group is every brand. Same two-pass renumber as
 * categories, for the same reason.
 */
export async function reorderBrands(
  orderedIds: string[],
  actor: Actor,
): Promise<{ updated: number }> {
  const all = await prisma.brand.findMany({ select: { id: true } });
  const known = new Set(all.map((row) => row.id));

  if (orderedIds.length !== known.size) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      `There are ${known.size} brands; the request sent ${orderedIds.length}. Send the complete list so the renumber cannot collide.`,
      { field: 'orderedIds', expected: known.size, received: orderedIds.length },
    );
  }

  const foreign = orderedIds.filter((candidate) => !known.has(candidate));
  if (foreign.length) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Some of those ids are not brands.', {
      field: 'orderedIds',
      foreignIds: foreign,
    });
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'brand.reorder',
      entity: 'brand',
      entityId: orderedIds[0]!,
      changes: { orderedIds },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx.brand.update({ where: { id: orderedIds[index]! }, data: { sortOrder: -(index + 1) } });
      }
      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx.brand.update({ where: { id: orderedIds[index]! }, data: { sortOrder: index } });
      }
      return null;
    },
  );

  return { updated: orderedIds.length };
}

/** POST /admin/brands/:id/active */
export async function setBrandActive(
  id: string,
  isActive: boolean,
  actor: Actor,
): Promise<BrandRow> {
  const before = await prisma.brand.findUnique({
    where: { id },
    select: { id: true, isActive: true },
  });
  if (!before) throw notFound('Brand');

  if (before.isActive === isActive) return getBrand(id);

  const after = await withAudit(
    {
      userId: actor.userId,
      action: 'brand.active',
      entity: 'brand',
      entityId: id,
      changes: { before: { isActive: before.isActive }, after: { isActive } },
      ipAddress: actor.ipAddress,
    },
    async (tx) =>
      tx.brand.update({ where: { id }, data: { isActive }, select: COUNTED_SELECT }),
  );

  return toRow(after as CountedBrandRow);
}

/**
 * DELETE /admin/brands/:id
 *
 * Refuses a brand with products unless `?detach=true`. See the file header:
 * `SET NULL` means the delete succeeds silently and 12 products lose their
 * brand, so the refusal is the only thing standing between an operator and a
 * storefront full of blank brand names.
 *
 * With `detach`, the products are explicitly nulled in the transaction rather
 * than relying on the FK action, and `affectedCount` comes back in the response
 * so the screen can state what happened.
 */
export async function deleteBrand(
  id: string,
  options: { detach: boolean },
  actor: Actor,
): Promise<{ deleted: true; affectedCount: number }> {
  const row = await prisma.brand.findUnique({
    where: { id },
    select: { ...BRAND_SELECT, _count: { select: { products: true } } },
  });

  if (!row) throw notFound('Brand');

  const productCount = row._count.products;

  if (productCount > 0 && !options.detach) {
    const sample = await prisma.product.findMany({
      where: { brandId: id },
      select: { id: true, nameEn: true },
      take: 3,
      orderBy: { nameEn: 'asc' },
    });

    throw new HttpError(
      409,
      'CONFLICT',
      `${productCount} product${productCount === 1 ? '' : 's'} use this brand. Deleting would leave them with no brand at all — the storefront would show a blank name. Send ?detach=true to do that on purpose.`,
      {
        reason: 'BRAND_IN_USE' satisfies BrandRefusal,
        productCount,
        products: sample.map((product) => ({ id: product.id, nameEn: product.nameEn })),
      },
    );
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'brand.delete',
      entity: 'brand',
      entityId: id,
      changes: {
        deleted: row as unknown as Prisma.InputJsonValue,
        affectedCount: productCount,
        detachRequested: options.detach,
      },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      if (productCount > 0) {
        // Explicit rather than relying on `SET NULL`. If the FK action is ever
        // changed to RESTRICT, this line is what keeps the documented
        // detach path working instead of turning into a 500.
        await tx.product.updateMany({ where: { brandId: id }, data: { brandId: null } });
      }
      await tx.brand.delete({ where: { id } });
      return null;
    },
  );

  return { deleted: true, affectedCount: productCount };
}
