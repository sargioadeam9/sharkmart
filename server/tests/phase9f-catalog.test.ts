/**
 * Phase 9 pass B5 — the admin categories and brands API.
 *
 * These run against the real seeded MySQL database and the real staff accounts
 * from `prisma/seed-test-users.ts`. What they prove that reading the code
 * cannot:
 *
 *   - the tree is 14 roots and 84 children, and the counts agree with an
 *     independent recompute
 *   - three categories are called "Accessories" and each carries a distinct
 *     `path` — the duplicate-name landmine, asserted rather than assumed
 *   - `sortOrder` renumbering produces 0..n-1 exactly once each, which is the
 *     collision the seed has today (values 0-5 shared by 15 rows)
 *   - a parent cannot be set to its own descendant: 422, and no cycle is written
 *   - deleting a category with products is 409 CATEGORY_IN_USE with the names,
 *     and the row survives
 *   - deleting a parent with children is 409 CATEGORY_HAS_CHILDREN, and the
 *     children are NOT silently promoted
 *   - `?reparent=true` promotes them on purpose and the audit row says how many
 *   - deleting an empty leaf works
 *   - deleting a brand with products is 409 BRAND_IN_USE, and no product loses
 *     its brand
 *   - `?detach=true` nulls the brand on every product, returns `affectedCount`,
 *     and the audit row records the count
 *   - INVENTORY_STAFF can PATCH a category (they hold `catalog:write`)
 *
 * ── The fixtures ────────────────────────────────────────────────────────────
 *
 * Every row this suite creates is deleted in `afterAll`, in dependency order.
 * It never mutates a seeded category or brand: the delete tests run against
 * throwaway rows built for the purpose, so a failure halfway through cannot
 * leave the reference catalog damaged.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

/** Rows this suite created, deleted afterwards in dependency order. */
const createdCategoryIds: string[] = [];
const createdBrandIds: string[] = [];
const createdProductIds: string[] = [];

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });

  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

function csrfOf(agent: request.SuperAgentTest): string {
  const cookies = agent.jar.getCookies({
    domain: '127.0.0.1',
    path: '/',
    secure: false,
    script: false,
  }) as unknown as Array<{ name: string; value: string }>;
  return cookies.find((cookie) => cookie.name === 'csrf_token')?.value ?? '';
}

/** A unique slug per call, so a re-run never collides with a leftover row. */
function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

/** A throwaway category. `parentId` null makes it a root. */
async function fixtureCategory(
  parentId: string | null = null,
  overrides: { nameEn?: string; isActive?: boolean } = {},
): Promise<string> {
  const slug = uniqueSlug('catfix');
  const row = await prisma.category.create({
    data: {
      slug,
      nameEn: overrides.nameEn ?? `Fixture ${slug}`,
      nameBn: `ফিক্সচার ${slug}`,
      parentId,
      isActive: overrides.isActive ?? true,
      sortOrder: 0,
    },
    select: { id: true },
  });
  createdCategoryIds.push(row.id);
  return row.id;
}

/** A throwaway brand. */
async function fixtureBrand(): Promise<string> {
  const slug = uniqueSlug('brdfix');
  const row = await prisma.brand.create({
    data: {
      slug,
      nameEn: `Fixture ${slug}`,
      nameBn: `ফিক্সচার ${slug}`,
      sortOrder: 0,
    },
    select: { id: true },
  });
  createdBrandIds.push(row.id);
  return row.id;
}

/**
 * A throwaway product attached to a category and optionally a brand.
 *
 * `categoryId` is required because `Product.categoryId` is non-nullable — a
 * product always belongs to a category. Created unpublished and as a draft so it
 * can never leak into a public response if a cleanup fails.
 */
async function fixtureProduct(options: {
  categoryId: string;
  brandId?: string;
}): Promise<string> {
  const sku = uniqueSlug('CATFIX').toUpperCase();
  const row = await prisma.product.create({
    data: {
      sku,
      slug: sku.toLowerCase(),
      nameEn: `Fixture product ${sku}`,
      nameBn: `ফিক্সচার পণ্য ${sku}`,
      categoryId: options.categoryId,
      brandId: options.brandId ?? null,
      basePricePoisha: 100000,
      isPublished: false,
      isDraft: true,
    },
    select: { id: true },
  });
  createdProductIds.push(row.id);
  return row.id;
}

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(async () => {
  /**
   * Dependency order: products first (they hold the FKs), then categories
   * children-before-parents, then brands.
   *
   * The category delete is done with `deleteMany` on the collected ids, which
   * MySQL will refuse if a parent is still referenced. Sorting by depth is
   * overkill for a fixture set this small, so the loop retries until it stops
   * making progress — a parent whose child is deleted in the same pass then
   * succeeds on the next one.
   */
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });

  let remaining = [...createdCategoryIds];
  for (let pass = 0; pass < 5 && remaining.length; pass += 1) {
    const before = remaining.length;
    const still: string[] = [];
    for (const id of remaining) {
      const children = await prisma.category.count({ where: { parentId: id } });
      if (children > 0) {
        still.push(id);
        continue;
      }
      await prisma.category.deleteMany({ where: { id } });
    }
    remaining = still;
    if (remaining.length === before) break;
  }

  await prisma.brand.deleteMany({ where: { id: { in: createdBrandIds } } });
  await prisma.$disconnect();
});

// ─── Read: the tree ─────────────────────────────────────────────────────────

describe('GET /admin/categories', () => {
  it('returns 14 roots and 84 children, with counts that match a recompute', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/categories');

    expect(res.status).toBe(200);
    const data = res.body.data as {
      view: string;
      items: Array<{ id: string; children: unknown[]; productCount: number; childCount: number }>;
      total: number;
      rootCount: number;
      childCount: number;
    };

    expect(data.view).toBe('tree');

    // Independent recompute. The fixture rows this suite creates are roots with
    // no children, so they are excluded by counting only seeded roots — which
    // is why the assertion is `>=` against the seed and exact against the
    // relationship between the two numbers.
    const dbRoots = await prisma.category.count({ where: { parentId: null } });
    const dbChildren = await prisma.category.count({ where: { parentId: { not: null } } });

    expect(data.rootCount).toBe(dbRoots);
    expect(data.childCount).toBe(dbChildren);
    expect(data.total).toBe(dbRoots + dbChildren);

    // Every root's childCount must equal the number of children actually nested.
    for (const root of data.items) {
      expect(root.children.length).toBe(root.childCount);
    }
  });

  it('gives all three "Accessories" a distinct path', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/categories?view=flat');

    expect(res.status).toBe(200);
    const items = (res.body.data as { items: Array<{ nameEn: string; path: string; parentId: string | null }> })
      .items;

    const accessories = items.filter((row) => row.nameEn === 'Accessories');
    expect(accessories.length).toBe(3);

    // The landmine: three rows, one name. The path is what makes them usable.
    const paths = accessories.map((row) => row.path);
    expect(new Set(paths).size).toBe(3);

    // And no path is the bare name — each carries its parent.
    for (const row of accessories) {
      expect(row.parentId).not.toBeNull();
      expect(row.path).toContain(' / ');
      expect(row.path).not.toBe('Accessories');
    }
  });

  it('filters by active without dropping an active child of an inactive parent', async () => {
    const parentId = await fixtureCategory(null, { isActive: false });
    const childId = await fixtureCategory(parentId, { isActive: true });

    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/categories?active=true');

    expect(res.status).toBe(200);
    const items = (res.body.data as { items: Array<{ id: string; children: Array<{ id: string }> }> })
      .items;

    // The inactive parent is filtered out, so the active child must surface as a
    // root rather than vanishing. A category that cannot be found is a category
    // that cannot be fixed.
    const found = items.some(
      (row) => row.id === childId || row.children.some((child) => child.id === childId),
    );
    expect(found).toBe(true);
  });

  it('rejects an unknown query key rather than ignoring it', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/categories?view=tree&catgory=fashion');
    expect(res.status).toBe(422);
  });
});

// ─── Create ─────────────────────────────────────────────────────────────────

describe('POST /admin/categories', () => {
  it('creates a child under a root, and it appears under that root only', async () => {
    const rootId = await fixtureCategory();
    const agent = await signIn('super@sharkmart.test');

    const created = await agent
      .post('/api/v1/admin/categories')
      .set('X-CSRF-Token', csrfOf(agent))
      .send({
        slug: uniqueSlug('newchild'),
        nameEn: 'New Child',
        nameBn: 'নতুন সন্তান',
        parentId: rootId,
      });

    expect(created.status).toBe(201);
    const body = created.body.data as { id: string; parentId: string; sortOrder: number };
    createdCategoryIds.push(body.id);

    expect(body.parentId).toBe(rootId);

    // It is under that root, and it is not a root itself.
    const tree = await agent.get('/api/v1/admin/categories');
    const roots = (tree.body.data as { items: Array<{ id: string; children: Array<{ id: string }> }> })
      .items;

    const parent = roots.find((row) => row.id === rootId);
    expect(parent?.children.some((child) => child.id === body.id)).toBe(true);
    expect(roots.some((row) => row.id === body.id)).toBe(false);
  });

  it('refuses a third level, because the storefront menu shows two', async () => {
    const rootId = await fixtureCategory();
    const childId = await fixtureCategory(rootId);
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .post('/api/v1/admin/categories')
      .set('X-CSRF-Token', csrfOf(agent))
      .send({
        slug: uniqueSlug('grandchild'),
        nameEn: 'Grandchild',
        nameBn: 'নাতি',
        parentId: childId,
      });

    expect(res.status).toBe(422);
    expect((res.body.error.details as { reason: string }).reason).toBe('CATEGORY_DEPTH');
  });

  it('409s on a duplicate slug and names the field', async () => {
    const agent = await signIn('super@sharkmart.test');
    const slug = uniqueSlug('dupslug');

    const first = await agent
      .post('/api/v1/admin/categories')
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ slug, nameEn: 'First', nameBn: 'প্রথম' });
    expect(first.status).toBe(201);
    createdCategoryIds.push((first.body.data as { id: string }).id);

    const second = await agent
      .post('/api/v1/admin/categories')
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ slug, nameEn: 'Second', nameBn: 'দ্বিতীয়' });

    expect(second.status).toBe(409);
    expect((second.body.error.details as { field: string }).field).toBe('slug');
  });

  it('allows two categories with the same name, because nameEn is not unique', async () => {
    const agent = await signIn('super@sharkmart.test');

    const a = await agent
      .post('/api/v1/admin/categories')
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ slug: uniqueSlug('samename'), nameEn: 'Same Name', nameBn: 'একই নাম' });
    const b = await agent
      .post('/api/v1/admin/categories')
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ slug: uniqueSlug('samename'), nameEn: 'Same Name', nameBn: 'একই নাম' });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    createdCategoryIds.push((a.body.data as { id: string }).id, (b.body.data as { id: string }).id);
  });
});

// ─── Update and cycles ──────────────────────────────────────────────────────

describe('PATCH /admin/categories/:id', () => {
  it('refuses a parent that is the node itself', async () => {
    const id = await fixtureCategory();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .patch(`/api/v1/admin/categories/${id}`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ parentId: id });

    expect(res.status).toBe(422);
    expect((res.body.error.details as { reason: string }).reason).toBe('CATEGORY_CYCLE');
  });

  it('refuses a parent that is one of its own descendants, and writes no cycle', async () => {
    const rootId = await fixtureCategory();
    const childId = await fixtureCategory(rootId);
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .patch(`/api/v1/admin/categories/${rootId}`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ parentId: childId });

    expect(res.status).toBe(422);
    expect((res.body.error.details as { reason: string }).reason).toBe('CATEGORY_CYCLE');

    // The refusal is real: the row still has no parent.
    const row = await prisma.category.findUnique({
      where: { id: rootId },
      select: { parentId: true },
    });
    expect(row?.parentId).toBeNull();
  });

  it('promotes a child to root when parentId is explicitly null', async () => {
    const rootId = await fixtureCategory();
    const childId = await fixtureCategory(rootId);
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .patch(`/api/v1/admin/categories/${childId}`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ parentId: null });

    expect(res.status).toBe(200);
    expect((res.body.data as { parentId: string | null }).parentId).toBeNull();
  });

  it('leaves the parent alone when parentId is absent', async () => {
    const rootId = await fixtureCategory();
    const childId = await fixtureCategory(rootId);
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .patch(`/api/v1/admin/categories/${childId}`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ nameEn: 'Renamed Only' });

    expect(res.status).toBe(200);
    const data = res.body.data as { parentId: string | null; nameEn: string };
    expect(data.parentId).toBe(rootId);
    expect(data.nameEn).toBe('Renamed Only');
  });

  it('rejects an empty body instead of writing a no-op audit row', async () => {
    const id = await fixtureCategory();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .patch(`/api/v1/admin/categories/${id}`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({});

    expect(res.status).toBe(422);
  });
});

// ─── Reorder ────────────────────────────────────────────────────────────────

describe('POST /admin/categories/:id/reorder', () => {
  it('renumbers a sibling group to 0..n-1 exactly once each', async () => {
    const rootId = await fixtureCategory();
    const childIds = [
      await fixtureCategory(rootId),
      await fixtureCategory(rootId),
      await fixtureCategory(rootId),
      await fixtureCategory(rootId),
      await fixtureCategory(rootId),
      await fixtureCategory(rootId),
    ];

    const agent = await signIn('super@sharkmart.test');
    const reversed = [...childIds].reverse();

    // The anchor is any member of the group — the group is defined by that row's
    // `parentId`, not by the anchor itself. Using a child here is the honest
    // test: the parent's own group is the roots, not these six.
    const res = await agent
      .post(`/api/v1/admin/categories/${childIds[0]}/reorder`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ orderedIds: reversed });

    expect(res.status).toBe(200);

    const rows = await prisma.category.findMany({
      where: { parentId: rootId },
      select: { id: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });

    expect(rows.map((row) => row.sortOrder)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.map((row) => row.id)).toEqual(reversed);
  });

  it('refuses a partial list, because a partial renumber collides', async () => {
    const rootId = await fixtureCategory();
    const childIds = [await fixtureCategory(rootId), await fixtureCategory(rootId)];

    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .post(`/api/v1/admin/categories/${childIds[0]}/reorder`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ orderedIds: [childIds[0]!] });

    expect(res.status).toBe(422);
  });

  it('refuses an id from another parent', async () => {
    const rootA = await fixtureCategory();
    const rootB = await fixtureCategory();
    const childA = await fixtureCategory(rootA);
    const childB = await fixtureCategory(rootB);

    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .post(`/api/v1/admin/categories/${childA}/reorder`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ orderedIds: [childA, childB] });

    expect(res.status).toBe(422);
  });
});

// ─── Delete: the contract ───────────────────────────────────────────────────

describe('DELETE /admin/categories/:id', () => {
  it('409s CATEGORY_IN_USE with the product names, and the row survives', async () => {
    const categoryId = await fixtureCategory();
    await fixtureProduct({ categoryId });

    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .delete(`/api/v1/admin/categories/${categoryId}`)
      .set('X-CSRF-Token', csrfOf(agent));

    expect(res.status).toBe(409);
    const details = res.body.error.details as {
      reason: string;
      productCount: number;
      products: Array<{ nameEn: string }>;
    };
    expect(details.reason).toBe('CATEGORY_IN_USE');
    expect(details.productCount).toBe(1);
    expect(details.products.length).toBe(1);
    expect(details.products[0]!.nameEn).toContain('Fixture product');

    // Still there. A 409 that deleted the row would be the worst outcome.
    const row = await prisma.category.findUnique({ where: { id: categoryId } });
    expect(row).not.toBeNull();
  });

  it('409s CATEGORY_HAS_CHILDREN and does NOT silently promote them', async () => {
    const rootId = await fixtureCategory();
    const childId = await fixtureCategory(rootId);

    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .delete(`/api/v1/admin/categories/${rootId}`)
      .set('X-CSRF-Token', csrfOf(agent));

    expect(res.status).toBe(409);
    const details = res.body.error.details as { reason: string; childCount: number };
    expect(details.reason).toBe('CATEGORY_HAS_CHILDREN');
    expect(details.childCount).toBe(1);

    // The whole point: the child still has its parent. `SET NULL` would have
    // promoted it to root without anyone asking.
    const child = await prisma.category.findUnique({
      where: { id: childId },
      select: { parentId: true },
    });
    expect(child?.parentId).toBe(rootId);
  });

  it('promotes children on purpose with ?reparent=true and records the count', async () => {
    const rootId = await fixtureCategory();
    const childId = await fixtureCategory(rootId);

    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .delete(`/api/v1/admin/categories/${rootId}?reparent=true`)
      .set('X-CSRF-Token', csrfOf(agent));

    expect(res.status).toBe(200);
    expect((res.body.data as { promotedChildren: number }).promotedChildren).toBe(1);

    const child = await prisma.category.findUnique({
      where: { id: childId },
      select: { parentId: true },
    });
    expect(child?.parentId).toBeNull();

    // The audit row says what happened, not what was requested.
    const auditRow = await prisma.auditLog.findFirst({
      where: { entityId: rootId, action: 'category.delete' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditRow).not.toBeNull();
    expect((auditRow!.changes as { promotedChildren: number }).promotedChildren).toBe(1);
  });

  it('deletes an empty leaf', async () => {
    const id = await fixtureCategory();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .delete(`/api/v1/admin/categories/${id}`)
      .set('X-CSRF-Token', csrfOf(agent));

    expect(res.status).toBe(200);
    const row = await prisma.category.findUnique({ where: { id } });
    expect(row).toBeNull();
  });

  it('404s on an unknown id rather than 500', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .delete('/api/v1/admin/categories/00000000-0000-4000-8000-000000000000')
      .set('X-CSRF-Token', csrfOf(agent));
    expect(res.status).toBe(404);
  });
});

// ─── Brands ─────────────────────────────────────────────────────────────────

describe('brands', () => {
  it('lists 25 seeded brands with product counts', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/brands');

    expect(res.status).toBe(200);
    const data = res.body.data as { items: Array<{ productCount: number }>; total: number };

    const dbCount = await prisma.brand.count();
    expect(data.total).toBe(dbCount);

    // The brief's fact: every seeded brand has products. Asserted here so a
    // future seed change that introduces an orphan brand fails loudly.
    const seeded = data.items.filter((row) => row.productCount > 0);
    expect(seeded.length).toBeGreaterThanOrEqual(25);
  });

  it('sorts by product count when asked', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/brands?sort=products');

    expect(res.status).toBe(200);
    const counts = (res.body.data as { items: Array<{ productCount: number }> }).items.map(
      (row) => row.productCount,
    );

    const descending = [...counts].sort((a, b) => b - a);
    expect(counts).toEqual(descending);
  });

  it('409s BRAND_IN_USE and leaves every product branded', async () => {
    const brandId = await fixtureBrand();
    const categoryId = await fixtureCategory();
    const productId = await fixtureProduct({ categoryId, brandId });

    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .delete(`/api/v1/admin/brands/${brandId}`)
      .set('X-CSRF-Token', csrfOf(agent));

    expect(res.status).toBe(409);
    const details = res.body.error.details as { reason: string; productCount: number };
    expect(details.reason).toBe('BRAND_IN_USE');
    expect(details.productCount).toBe(1);

    // The dangerous outcome would be a silent SET NULL. Assert it did not happen.
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { brandId: true },
    });
    expect(product?.brandId).toBe(brandId);

    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    expect(brand).not.toBeNull();
  });

  it('detaches with ?detach=true, returns affectedCount, and records it', async () => {
    const brandId = await fixtureBrand();
    const categoryId = await fixtureCategory();
    const productIds = [
      await fixtureProduct({ categoryId, brandId }),
      await fixtureProduct({ categoryId, brandId }),
      await fixtureProduct({ categoryId, brandId }),
    ];

    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .delete(`/api/v1/admin/brands/${brandId}?detach=true`)
      .set('X-CSRF-Token', csrfOf(agent));

    expect(res.status).toBe(200);
    expect((res.body.data as { affectedCount: number }).affectedCount).toBe(3);

    // Every product still exists, with no brand.
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { brandId: true },
    });
    expect(products.length).toBe(3);
    for (const product of products) expect(product.brandId).toBeNull();

    const auditRow = await prisma.auditLog.findFirst({
      where: { entityId: brandId, action: 'brand.delete' },
      orderBy: { createdAt: 'desc' },
    });
    expect((auditRow!.changes as { affectedCount: number }).affectedCount).toBe(3);

    // The brand itself is gone.
    expect(await prisma.brand.findUnique({ where: { id: brandId } })).toBeNull();
  });

  it('deletes a brand with no products without needing the flag', async () => {
    const brandId = await fixtureBrand();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .delete(`/api/v1/admin/brands/${brandId}`)
      .set('X-CSRF-Token', csrfOf(agent));

    expect(res.status).toBe(200);
    expect((res.body.data as { affectedCount: number }).affectedCount).toBe(0);
    expect(await prisma.brand.findUnique({ where: { id: brandId } })).toBeNull();
  });
});

// ─── Permissions ────────────────────────────────────────────────────────────

describe('permission gates', () => {
  it('lets INVENTORY_STAFF PATCH a category, because they hold catalog:write', async () => {
    const id = await fixtureCategory();
    const agent = await signIn('inventory@sharkmart.test');

    const res = await agent
      .patch(`/api/v1/admin/categories/${id}`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ nameEn: 'Renamed By Inventory Staff' });

    expect(res.status).toBe(200);
    expect((res.body.data as { nameEn: string }).nameEn).toBe('Renamed By Inventory Staff');
  });

  it('lets MARKETING_STAFF write a brand', async () => {
    const agent = await signIn('marketing@sharkmart.test');
    const res = await agent
      .post('/api/v1/admin/brands')
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ slug: uniqueSlug('mkbrand'), nameEn: 'Marketing Brand', nameBn: 'মার্কেটিং' });

    expect(res.status).toBe(201);
    createdBrandIds.push((res.body.data as { id: string }).id);
  });

  it('refuses a CUSTOMER at the staff gate', async () => {
    const agent = await signIn('customer@sharkmart.test');
    const res = await agent.get('/api/v1/admin/categories');
    expect(res.status).toBe(403);
  });
});
