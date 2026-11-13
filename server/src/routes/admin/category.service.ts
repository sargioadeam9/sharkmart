/**
 * `/api/v1/admin/categories` — the category module of the admin panel.
 *
 * ── The delete contract is the whole point of this file ─────────────────────
 *
 * Read from `information_schema`, not assumed:
 *
 *   product.categoryId              -> category       RESTRICT
 *   category.parentId               -> category       SET NULL
 *   productattribute.categoryId     -> category       SET NULL
 *
 * Only ONE of those three raises an error. `RESTRICT` on products means a
 * category with products cannot be deleted — the database stops it, and a raw
 * FK error must never reach the client, so this service checks first and
 * returns a 409 that names the products.
 *
 * The other two are silent. Deleting a parent category does not fail: MySQL
 * nulls `parentId` on its children and they are promoted to root. Deleting a
 * category with attributes does not fail either: the 16 `ProductAttribute` rows
 * quietly lose their category and become global. Neither raises anything, and
 * the storefront keeps rendering, so the damage is invisible until someone
 * notices the nav has 18 roots instead of 14.
 *
 * So no delete here is a bare DELETE. Each one:
 *   1. computes the blast radius BEFORE the write,
 *   2. returns it in the 409 so the operator can see what would happen,
 *   3. requires an explicit flag (`?reparent=true`) to proceed when the blast
 *      radius is non-empty,
 *   4. records what actually happened in the audit row.
 *
 * ── Depth is two, and that is a data decision ───────────────────────────────
 *
 * `CategoryDto` in `src/types/catalog.ts` is `{ subcategories: SubcategoryDto[] }`
 * — two levels, and `mega-menu.tsx:188` maps exactly that. A grandchild would
 * be creatable and then never rendered anywhere on the storefront. So
 * `assertDepth()` refuses a third level at write time rather than letting the
 * admin panel build a tree the storefront cannot show.
 *
 * This is NOT the same as "the tree is flat": roots and children both exist and
 * both are real. It is "the storefront contract is two levels", and the API
 * enforces the contract it has.
 *
 * ── sortOrder ──────────────────────────────────────────────────────────────
 *
 * The seed has 14 distinct `sortOrder` values across 98 rows — values 0-5 are
 * each shared by 15 rows — so ordering within a parent is currently ambiguous
 * and the storefront's order is whatever MySQL returns. `reorder()` renumbers a
 * sibling group to 0..n-1 in one transaction, and `create()` appends to the end
 * of its parent instead of defaulting to 0. Both are what stop the collision
 * coming back.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import { withAudit } from '../../services/audit.service.js';
import type { CategoryCreateInput, CategoryUpdateInput } from '../../validators/adminCatalog.schema.js';

/** The acting user and their IP, for the audit row. */
export interface Actor {
  userId: string;
  ipAddress: string | null;
}

/**
 * The named reason for a refusal, carried in `details.reason`.
 *
 * `ApiErrorCode` is a closed union (`types/api.ts`) shared by every route in the
 * API, and widening it for one module would change the public contract for
 * every client. So the HTTP code stays `CONFLICT` — the house pattern, same as
 * `product.service.ts:337` — and the specific reason rides in `details`, where
 * the screen can branch on it without parsing a message string.
 */
export type CategoryRefusal = 'CATEGORY_IN_USE' | 'CATEGORY_HAS_CHILDREN' | 'CATEGORY_CYCLE';

export interface CategoryRow {
  id: string;
  slug: string;
  nameEn: string;
  nameBn: string;
  parentId: string | null;
  iconEmoji: string | null;
  bannerImage: string | null;
  accentColor: string | null;
  lightTintColor: string | null;
  sortOrder: number;
  isActive: boolean;
  metaTitleEn: string | null;
  metaTitleBn: string | null;
  metaDescEn: string | null;
  metaDescBn: string | null;
  createdAt: string;
  updatedAt: string;
  productCount: number;
  childCount: number;
  /** "Fashion / Men" — the disambiguator. Never render a bare name in a list. */
  path: string;
}

export interface CategoryTreeNode extends CategoryRow {
  children: CategoryRow[];
}

export interface CategoryListResult {
  view: 'tree' | 'flat';
  items: CategoryTreeNode[] | CategoryRow[];
  total: number;
  rootCount: number;
  childCount: number;
}

/** The columns every response carries. Explicit, never `SELECT *`. */
const CATEGORY_SELECT = {
  id: true,
  slug: true,
  nameEn: true,
  nameBn: true,
  parentId: true,
  iconEmoji: true,
  bannerImage: true,
  accentColor: true,
  lightTintColor: true,
  sortOrder: true,
  isActive: true,
  metaTitleEn: true,
  metaTitleBn: true,
  metaDescEn: true,
  metaDescBn: true,
  createdAt: true,
  updatedAt: true,
} as const;

type CategoryDbRow = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

/** A row plus the two counts, before the path is resolved. */
interface CountedRow extends CategoryDbRow {
  _count: { products: number; children: number };
}

const COUNTED_SELECT = {
  ...CATEGORY_SELECT,
  _count: { select: { products: true, children: true } },
} as const;

/**
 * Turns a row into the response shape, resolving the parent path.
 *
 * `parents` is a map of id -> { nameEn, parentId } for every category in the
 * result set. Passing it in rather than querying per row is what keeps this
 * from being an N+1: 98 categories are resolved from one extra query.
 */
function toRow(
  row: CountedRow,
  parents: Map<string, { nameEn: string; parentId: string | null }>,
): CategoryRow {
  const parent = row.parentId ? parents.get(row.parentId) : undefined;
  const path = parent ? `${parent.nameEn} / ${row.nameEn}` : row.nameEn;

  return {
    id: row.id,
    slug: row.slug,
    nameEn: row.nameEn,
    nameBn: row.nameBn,
    parentId: row.parentId,
    iconEmoji: row.iconEmoji,
    bannerImage: row.bannerImage,
    accentColor: row.accentColor,
    lightTintColor: row.lightTintColor,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    metaTitleEn: row.metaTitleEn,
    metaTitleBn: row.metaTitleBn,
    metaDescEn: row.metaDescEn,
    metaDescBn: row.metaDescBn,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    productCount: row._count.products,
    childCount: row._count.children,
    path,
  };
}

/** The `active` filter, in one place so list and detail cannot disagree. */
function activeWhere(active: 'all' | 'true' | 'false'): { isActive?: boolean } {
  if (active === 'all') return {};
  return { isActive: active === 'true' };
}

/**
 * GET /admin/categories
 *
 * `tree` returns roots with their children nested. `flat` returns every row
 * once, parent and child alike, each carrying `path`.
 *
 * Both are built from ONE query. The tree is grouped in memory from the same
 * rows the flat view returns, so the two views cannot report different counts
 * for the same category — which is exactly what would happen if the tree
 * endpoint counted children with a separate aggregate.
 *
 * A child whose parent was filtered out (because `active=true` and the parent
 * is inactive) is returned as a root in the tree view rather than being
 * dropped. Dropping it would make an active category unreachable in the admin
 * panel, and the operator would have no way to find or fix it.
 */
export async function listCategories(input: {
  view: 'tree' | 'flat';
  q?: string;
  active: 'all' | 'true' | 'false';
}): Promise<CategoryListResult> {
  const where: Prisma.CategoryWhereInput = { ...activeWhere(input.active) };

  if (input.q) {
    where.OR = [
      { nameEn: { contains: input.q } },
      { nameBn: { contains: input.q } },
      { slug: { contains: input.q } },
    ];
  }

  const rows = (await prisma.category.findMany({
    where,
    select: COUNTED_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
  })) as CountedRow[];

  // One extra query for the parent names, so `path` costs nothing per row.
  const parentIds = [...new Set(rows.map((row) => row.parentId).filter((id): id is string => !!id))];
  const parentRows = parentIds.length
    ? await prisma.category.findMany({
        where: { id: { in: parentIds } },
        select: { id: true, nameEn: true, parentId: true },
      })
    : [];
  const parents = new Map(parentRows.map((row) => [row.id, row]));

  const mapped = rows.map((row) => toRow(row, parents));

  if (input.view === 'flat') {
    return {
      view: 'flat',
      items: mapped,
      total: mapped.length,
      rootCount: mapped.filter((row) => row.parentId === null).length,
      childCount: mapped.filter((row) => row.parentId !== null).length,
    };
  }

  const present = new Set(mapped.map((row) => row.id));
  const byParent = new Map<string, CategoryRow[]>();
  const roots: CategoryTreeNode[] = [];

  for (const row of mapped) {
    // A row is a root here if it has no parent, or its parent is not in this
    // result set. The second case is the filtered-out-parent case above.
    if (row.parentId === null || !present.has(row.parentId)) {
      roots.push({ ...row, children: [] });
      continue;
    }
    const siblings = byParent.get(row.parentId) ?? [];
    siblings.push(row);
    byParent.set(row.parentId, siblings);
  }

  for (const root of roots) {
    root.children = byParent.get(root.id) ?? [];
  }

  return {
    view: 'tree',
    items: roots,
    total: mapped.length,
    rootCount: roots.length,
    childCount: mapped.length - roots.length,
  };
}

/**
 * GET /admin/categories/:id
 *
 * The row plus its parent path, its product count and its children. The
 * children are returned with their own counts so the drawer can say
 * "4 sub-categories" and name them without a second request.
 */
export async function getCategory(id: string): Promise<CategoryRow & { children: CategoryRow[] }> {
  const row = (await prisma.category.findUnique({
    where: { id },
    select: COUNTED_SELECT,
  })) as CountedRow | null;

  if (!row) throw notFound('Category');

  const parent = row.parentId
    ? await prisma.category.findUnique({
        where: { id: row.parentId },
        select: { id: true, nameEn: true, parentId: true },
      })
    : null;

  const parents = new Map(parent ? [[parent.id, parent]] : []);

  const children = (await prisma.category.findMany({
    where: { parentId: id },
    select: COUNTED_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
  })) as CountedRow[];

  const childParents = new Map<string, { nameEn: string; parentId: string | null }>([
    ...parents,
    [row.id, { nameEn: row.nameEn, parentId: row.parentId }],
  ]);

  return {
    ...toRow(row, parents),
    children: children.map((child) => toRow(child, childParents)),
  };
}

/**
 * Refuses a third level.
 *
 * `parentId` must be a root. The storefront's mega menu renders
 * `CategoryDto.subcategories` and nothing below it, so a grandchild is data the
 * storefront cannot show. Checked on create and on re-parent, because both can
 * introduce depth.
 */
async function assertDepth(parentId: string | null, selfId?: string): Promise<void> {
  if (!parentId) return;

  const parent = await prisma.category.findUnique({
    where: { id: parentId },
    select: { id: true, parentId: true, nameEn: true },
  });

  if (!parent) throw notFound('Parent category');

  if (parent.parentId !== null) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      `"${parent.nameEn}" is already a sub-category. The storefront menu shows two levels, so a third would never appear.`,
      { field: 'parentId', reason: 'CATEGORY_DEPTH', maxDepth: 2 },
    );
  }

  if (selfId && parent.id === selfId) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'A category cannot be its own parent.', {
      field: 'parentId',
      reason: 'CATEGORY_CYCLE',
    });
  }
}

/**
 * Collects a node's descendants, breadth-first, with a visited set.
 *
 * The visited set is not decoration: if a cycle already exists in the data
 * (nothing prevents one at the database level — `parentId` is a plain
 * self-reference), a naive walk loops forever and the request hangs. A hang is
 * worse than an error because it takes the whole admin panel with it.
 */
async function descendantsOf(id: string): Promise<string[]> {
  const seen = new Set<string>([id]);
  const queue = [id];
  const found: string[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    const children = await prisma.category.findMany({
      where: { parentId: current },
      select: { id: true },
    });

    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      found.push(child.id);
      queue.push(child.id);
    }
  }

  return found;
}

/**
 * Turns a Prisma unique-constraint failure into the contract's 409.
 *
 * `Category_slug_key` -> `slug`. A compound `A_b_c_key` -> `b_c`. Same shape as
 * `product.service.ts` so every module reports a conflict the same way.
 *
 * Without this the raw `P2002` reaches the global handler and becomes a 500,
 * which tells the operator "something broke" when the truth is "that slug is
 * taken" — a message they can act on.
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
 * POST /admin/categories
 *
 * `sortOrder` is not taken from the client: the new row goes to the end of its
 * parent's group. Appending is what keeps a fresh category from landing in the
 * middle of the 15-row `sortOrder = 0` pile.
 */
export async function createCategory(
  input: CategoryCreateInput,
  actor: Actor,
): Promise<CategoryRow> {
  await assertDepth(input.parentId);

  const siblingCount = await prisma.category.count({ where: { parentId: input.parentId } });

  let created: CategoryDbRow;
  try {
    created = await withAudit<CategoryDbRow>(
    (row) => ({
      userId: actor.userId,
      action: 'category.create',
      entity: 'category',
      entityId: row.id,
      changes: { after: row as unknown as Prisma.InputJsonValue },
      ipAddress: actor.ipAddress,
    }),
    async (tx) => {
      const row = await tx.category.create({
        data: {
          slug: input.slug,
          nameEn: input.nameEn,
          nameBn: input.nameBn,
          parentId: input.parentId,
          iconEmoji: input.iconEmoji,
          bannerImage: input.bannerImage,
          accentColor: input.accentColor,
          lightTintColor: input.lightTintColor,
          isActive: input.isActive,
          metaTitleEn: input.metaTitleEn,
          metaTitleBn: input.metaTitleBn,
          metaDescEn: input.metaDescEn,
          metaDescBn: input.metaDescBn,
          sortOrder: siblingCount,
        },
        select: CATEGORY_SELECT,
      });
      return row;
    },
    );
  } catch (error) {
    rethrowConflict(error);
  }

  return {
    ...created,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
    productCount: 0,
    childCount: 0,
    path: created.nameEn,
  };
}

/**
 * PATCH /admin/categories/:id
 *
 * Re-parenting is checked three ways before the write:
 *   - the new parent must exist and be a root (depth),
 *   - it must not be this node (self-parent),
 *   - it must not be a descendant of this node (cycle).
 *
 * The third is the one that matters: setting a category's parent to its own
 * child makes the tree infinite, and the storefront nav walk would hang rather
 * than error. `descendantsOf` is bounded by a visited set for the same reason.
 */
export async function updateCategory(
  id: string,
  input: CategoryUpdateInput,
  actor: Actor,
): Promise<CategoryRow> {
  const before = await prisma.category.findUnique({ where: { id }, select: CATEGORY_SELECT });
  if (!before) throw notFound('Category');

  if (input.parentId !== undefined) {
    if (input.parentId === id) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'A category cannot be its own parent.', {
        field: 'parentId',
        reason: 'CATEGORY_CYCLE',
      });
    }

    const descendants = await descendantsOf(id);
    if (input.parentId && descendants.includes(input.parentId)) {
      throw new HttpError(
        422,
        'VALIDATION_ERROR',
        'That would move this category underneath one of its own sub-categories, which makes the tree infinite and the storefront menu hang.',
        { field: 'parentId', reason: 'CATEGORY_CYCLE', descendantCount: descendants.length },
      );
    }

    await assertDepth(input.parentId, id);
  }

  const after = await withAudit<CountedRow>(
    {
      userId: actor.userId,
      action: 'category.update',
      entity: 'category',
      entityId: id,
      changes: { before: before as unknown as Prisma.InputJsonValue },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      const row = await tx.category.update({
        where: { id },
        data: {
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.nameBn !== undefined ? { nameBn: input.nameBn } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.iconEmoji !== undefined ? { iconEmoji: input.iconEmoji } : {}),
          ...(input.bannerImage !== undefined ? { bannerImage: input.bannerImage } : {}),
          ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
          ...(input.lightTintColor !== undefined ? { lightTintColor: input.lightTintColor } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.metaTitleEn !== undefined ? { metaTitleEn: input.metaTitleEn } : {}),
          ...(input.metaTitleBn !== undefined ? { metaTitleBn: input.metaTitleBn } : {}),
          ...(input.metaDescEn !== undefined ? { metaDescEn: input.metaDescEn } : {}),
          ...(input.metaDescBn !== undefined ? { metaDescBn: input.metaDescBn } : {}),
        },
        select: COUNTED_SELECT,
      });
      return row;
    },
  ).catch(rethrowConflict);

  const parent = after.parentId
    ? await prisma.category.findUnique({
        where: { id: after.parentId },
        select: { id: true, nameEn: true, parentId: true },
      })
    : null;

  return toRow(after as CountedRow, new Map(parent ? [[parent.id, parent]] : []));
}

/**
 * POST /admin/categories/:id/reorder
 *
 * Renumbers one sibling group to 0..n-1, in one transaction.
 *
 * `:id` may be any member of the group — the group is defined by that row's
 * `parentId`, not by the id itself. Every id in `orderedIds` must belong to the
 * same parent, so a crafted list cannot renumber another parent's children.
 *
 * The whole group must be present. A partial list would renumber some rows into
 * a range that collides with the rows left out, which is the exact problem this
 * endpoint exists to fix.
 */
export async function reorderCategories(
  id: string,
  orderedIds: string[],
  actor: Actor,
): Promise<{ updated: number; parentId: string | null }> {
  const anchor = await prisma.category.findUnique({
    where: { id },
    select: { id: true, parentId: true },
  });
  if (!anchor) throw notFound('Category');

  const siblings = await prisma.category.findMany({
    where: { parentId: anchor.parentId },
    select: { id: true },
  });
  const siblingIds = new Set(siblings.map((row) => row.id));

  if (orderedIds.length !== siblingIds.size) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      `This group has ${siblingIds.size} categories; the request sent ${orderedIds.length}. Send the complete group so the renumber cannot collide.`,
      { field: 'orderedIds', expected: siblingIds.size, received: orderedIds.length },
    );
  }

  const foreign = orderedIds.filter((candidate) => !siblingIds.has(candidate));
  if (foreign.length) {
    throw new HttpError(
      422,
      'VALIDATION_ERROR',
      'Some of those categories are not in this group. Reordering cannot move a category between parents.',
      { field: 'orderedIds', foreignIds: foreign },
    );
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'category.reorder',
      entity: 'category',
      entityId: id,
      changes: { parentId: anchor.parentId, orderedIds },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      // Two passes: park the group on negative values first, then write 0..n-1.
      // `sortOrder` has no unique constraint today, but a single pass would
      // still be wrong the moment one is added, and negatives make the intent
      // unambiguous in the audit trail.
      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx.category.update({
          where: { id: orderedIds[index]! },
          data: { sortOrder: -(index + 1) },
        });
      }
      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx.category.update({
          where: { id: orderedIds[index]! },
          data: { sortOrder: index },
        });
      }
      return null;
    },
  );

  return { updated: orderedIds.length, parentId: anchor.parentId };
}

/** POST /admin/categories/:id/active */
export async function setCategoryActive(
  id: string,
  isActive: boolean,
  actor: Actor,
): Promise<CategoryRow> {
  const before = await prisma.category.findUnique({
    where: { id },
    select: { id: true, isActive: true },
  });
  if (!before) throw notFound('Category');

  if (before.isActive === isActive) {
    // A no-op writes nothing, including no audit row. An audit trail full of
    // "changed active from true to true" is noise that hides the real changes.
    return getCategory(id);
  }

  const after = await withAudit(
    {
      userId: actor.userId,
      action: 'category.active',
      entity: 'category',
      entityId: id,
      changes: { before: { isActive: before.isActive }, after: { isActive } },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      const row = await tx.category.update({
        where: { id },
        data: { isActive },
        select: COUNTED_SELECT,
      });
      return row;
    },
  );

  return toRow(after as CountedRow, new Map());
}

/**
 * DELETE /admin/categories/:id
 *
 * The blast radius, computed before anything is written:
 *
 *   products > 0        -> 409 CATEGORY_IN_USE, with the count and three names.
 *                          `RESTRICT` would throw a raw FK error; this returns
 *                          something the operator can act on.
 *   children > 0        -> 409 CATEGORY_HAS_CHILDREN, with the child names,
 *                          unless `?reparent=true`. Without the flag the
 *                          children would be silently promoted to root by
 *                          `SET NULL`, and the nav would quietly grow.
 *   attributes > 0      -> recorded in the audit row. `SET NULL` detaches them,
 *                          which is correct (an attribute with no category is a
 *                          global attribute), but it is a change and the audit
 *                          row should say so.
 *
 * The audit row records the counts that were true at delete time, so a later
 * reader can tell what the delete actually did rather than what it was supposed
 * to do.
 */
export async function deleteCategory(
  id: string,
  options: { reparent: boolean },
  actor: Actor,
): Promise<{ deleted: true; promotedChildren: number; detachedAttributes: number }> {
  const row = await prisma.category.findUnique({
    where: { id },
    select: {
      ...CATEGORY_SELECT,
      _count: { select: { products: true, children: true, attributes: true } },
    },
  });

  if (!row) throw notFound('Category');

  const productCount = row._count.products;
  const childCount = row._count.children;
  const attributeCount = row._count.attributes;

  if (productCount > 0) {
    const sample = await prisma.product.findMany({
      where: { categoryId: id },
      select: { id: true, nameEn: true },
      take: 3,
      orderBy: { nameEn: 'asc' },
    });

    throw new HttpError(
      409,
      'CONFLICT',
      `${productCount} product${productCount === 1 ? '' : 's'} use this category. Move them first — deleting would orphan them.`,
      {
        reason: 'CATEGORY_IN_USE' satisfies CategoryRefusal,
        productCount,
        products: sample.map((product) => ({ id: product.id, nameEn: product.nameEn })),
      },
    );
  }

  if (childCount > 0 && !options.reparent) {
    const children = await prisma.category.findMany({
      where: { parentId: id },
      select: { id: true, nameEn: true },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      take: 10,
    });

    throw new HttpError(
      409,
      'CONFLICT',
      `${childCount} sub-categor${childCount === 1 ? 'y' : 'ies'} sit under this one. Deleting would silently promote them to top-level. Send ?reparent=true to do that on purpose.`,
      {
        reason: 'CATEGORY_HAS_CHILDREN' satisfies CategoryRefusal,
        childCount,
        children: children.map((child) => ({ id: child.id, nameEn: child.nameEn })),
      },
    );
  }

  await withAudit(
    {
      userId: actor.userId,
      action: 'category.delete',
      entity: 'category',
      entityId: id,
      changes: {
        deleted: row as unknown as Prisma.InputJsonValue,
        // What the delete actually did, not what it was asked to do.
        promotedChildren: childCount,
        detachedAttributes: attributeCount,
        reparentRequested: options.reparent,
      },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      if (childCount > 0) {
        // Explicit, even though `SET NULL` would do it. An explicit update is
        // visible in the transaction and does not depend on the FK action
        // staying what it is today.
        await tx.category.updateMany({ where: { parentId: id }, data: { parentId: null } });
      }
      await tx.category.delete({ where: { id } });
      return null;
    },
  );

  return { deleted: true, promotedChildren: childCount, detachedAttributes: attributeCount };
}
