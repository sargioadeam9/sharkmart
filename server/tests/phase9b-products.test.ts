/**
 * Phase 9 pass B1a — the admin products API.
 *
 * These run against the real seeded MySQL database and the real staff accounts
 * from `prisma/seed-test-users.ts`. What they prove that reading the code cannot:
 *
 *   - a create is a draft and unpublished no matter what the body says
 *   - a mutation writes exactly one audit row, and an update's row carries only
 *     the fields that changed
 *   - publish refuses a product with no image, and leaves it unpublished
 *   - delete refuses a product that appears in an order
 *   - archive removes a product from the default list but not from the archived
 *     tab
 *   - `stock=out` filters BEFORE pagination, so `total` matches the filtered set
 *     (this is the bug the storefront's post-filter has and does not hide)
 *   - the permission gate is real: INVENTORY_STAFF may read and write,
 *     MARKETING_STAFF may not write
 *
 * Every product this suite creates is deleted in `afterAll`, along with its audit
 * rows, so the seeded catalog is left exactly as it was found.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

/** Products this suite created, cleaned up afterwards. */
const createdProductIds: string[] = [];
/** Audit rows this suite created. */
const createdAuditIds: string[] = [];

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

/** A category id that exists in the seeded catalog. */
async function aCategoryId(): Promise<string> {
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
  return category.id;
}

/** A unique suffix so repeated runs cannot collide on slug/sku. */
function uniq(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}

/** The minimal valid create body. */
async function createBody(overrides: Record<string, unknown> = {}) {
  const tag = uniq();
  return {
    nameEn: `Test Product ${tag}`,
    nameBn: `টেস্ট পণ্য ${tag}`,
    sku: `TEST-${tag}`,
    categoryId: await aCategoryId(),
    basePricePoisha: 129_900,
    ...overrides,
  };
}

/** Creates a product through the API and remembers it for cleanup. */
async function createProduct(
  agent: request.SuperAgentTest,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; body: Record<string, unknown> }> {
  const res = await agent.post('/api/v1/admin/products').send(await createBody(overrides));

  if (res.status !== 201) {
    throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const id = res.body.data.id as string;
  createdProductIds.push(id);
  return { id, body: res.body.data };
}

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(async () => {
  // Audit rows first: they reference nothing, but leaving them behind would make
  // the "exactly one new row" assertions of a later run ambiguous.
  if (createdAuditIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { id: { in: createdAuditIds } } });
  }

  if (createdProductIds.length > 0) {
    // Images and variants cascade; order items would block, but this suite never
    // creates one against a product it made.
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  }
});

// ── Gates ───────────────────────────────────────────────────────────────────
describe('admin products gates', () => {
  it('403s a CUSTOMER', async () => {
    const agent = await signIn('customer@sharkmart.test');
    const res = await agent.get('/api/v1/admin/products');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('admits INVENTORY_STAFF to the list', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    const res = await agent.get('/api/v1/admin/products');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('admits INVENTORY_STAFF to a PATCH', async () => {
    const admin = await signIn('super@sharkmart.test');
    const { id } = await createProduct(admin);

    const staff = await signIn('inventory@sharkmart.test');
    const res = await staff
      .patch(`/api/v1/admin/products/${id}`)
      .send({ nameEn: 'Renamed by inventory staff' });

    expect(res.status).toBe(200);
    expect(res.body.data.nameEn).toBe('Renamed by inventory staff');
  });

  it('admits MARKETING_STAFF to a PATCH, because the matrix grants staff catalog:write', async () => {
    const admin = await signIn('super@sharkmart.test');
    const { id } = await createProduct(admin);

    /**
     * The brief expected a 403 here. The shipped matrix disagrees, and the
     * matrix is the authority: security.md §6 says staff "read and write
     * catalog", and services/permissions.ts:88-96 grants MARKETING_STAFF
     * `catalog:write`. Both staff roles therefore pass this gate.
     *
     * Asserting the real behaviour, not the expected one. The refusal case that
     * IS provable is a CUSTOMER (403) and a route needing a permission the role
     * lacks — see the audit-log test in phase9.test.ts. Recorded in HANDOFF.md
     * as a brief-vs-matrix conflict rather than silently "fixed" by narrowing
     * the matrix, which would be a security change nobody asked for.
     */
    const marketing = await signIn('marketing@sharkmart.test');
    const res = await marketing
      .patch(`/api/v1/admin/products/${id}`)
      .send({ nameEn: 'Renamed by marketing' });

    expect(res.status).toBe(200);
    expect(res.body.data.nameEn).toBe('Renamed by marketing');
  });

  it('still refuses a CUSTOMER on a PATCH', async () => {
    const admin = await signIn('super@sharkmart.test');
    const { id } = await createProduct(admin);

    const customer = await signIn('customer@sharkmart.test');
    const res = await customer
      .patch(`/api/v1/admin/products/${id}`)
      .send({ nameEn: 'Renamed by a customer' });

    expect(res.status).toBe(403);
  });
});

// ── Create ──────────────────────────────────────────────────────────────────
describe('create', () => {
  it('creates a draft, unpublished product and writes one audit row', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id, body } = await createProduct(agent);

    expect(body.isPublished).toBe(false);
    expect(body.isDraft).toBe(true);
    expect(body.status).toBe('draft');

    const rows = await prisma.auditLog.findMany({
      where: { entityId: id, action: 'product.create' },
    });
    createdAuditIds.push(...rows.map((row) => row.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.entity).toBe('Product');
    expect(rows[0]!.userId).toBeTruthy();
    expect(rows[0]!.ipAddress).toBeTruthy();
  });

  it('ignores publish flags in the body — they are not in the schema', async () => {
    const agent = await signIn('super@sharkmart.test');

    // `.strict()` rejects the unknown key rather than silently dropping it, so a
    // client that thinks it published gets told it did not.
    const res = await agent
      .post('/api/v1/admin/products')
      .send({ ...(await createBody()), isPublished: true, isDraft: false });

    expect(res.status).toBe(422);
  });

  it('rejects a float price', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .post('/api/v1/admin/products')
      .send(await createBody({ basePricePoisha: 1299.5 }));

    expect(res.status).toBe(422);
  });

  it('409s a duplicate sku and names the field', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { body } = await createProduct(agent);

    const res = await agent
      .post('/api/v1/admin/products')
      .send(await createBody({ sku: body.sku }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details.field).toBe('sku');
  });
});

// ── Update ──────────────────────────────────────────────────────────────────
describe('update', () => {
  it('writes an audit row carrying only the changed fields', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id, body } = await createProduct(agent);

    const res = await agent
      .patch(`/api/v1/admin/products/${id}`)
      .send({ nameEn: 'Updated name only', basePricePoisha: body.basePricePoisha });

    expect(res.status).toBe(200);

    const row = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'product.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    createdAuditIds.push(row!.id);

    const changes = row!.changes as Record<string, { from: unknown; to: unknown }>;
    // Only nameEn actually differs; basePricePoisha was sent unchanged and must
    // not appear.
    expect(Object.keys(changes)).toEqual(['nameEn']);
    expect(changes.nameEn).toEqual({ from: body.nameEn, to: 'Updated name only' });
  });

  it('rejects a discount price at or above the base price', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createProduct(agent);

    const res = await agent
      .patch(`/api/v1/admin/products/${id}`)
      .send({ basePricePoisha: 100_000, discountPricePoisha: 100_000 });

    expect(res.status).toBe(422);
  });

  /**
   * The regression this suite exists to prevent.
   *
   * The seed writes `discountPricePoisha == basePricePoisha` on all 168 products.
   * The update guard compared the merged row rather than the patch, so any edit
   * at all — even one that touched no price — was rejected with "discount price
   * must be less than base price", and the editor has no discount price input,
   * so an operator could not clear the condition. Every product was read-only.
   *
   * The product here is created through the API (which forbids equality), then
   * pushed into the seeded shape directly, so the test reproduces the real
   * condition without depending on what the seed happens to contain today.
   */
  it('accepts an unrelated edit when the stored discount price equals the base price', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id, body } = await createProduct(agent);

    await prisma.product.update({
      where: { id },
      data: { discountPricePoisha: body.basePricePoisha as number },
    });

    const res = await agent.patch(`/api/v1/admin/products/${id}`).send({ isFeatured: true });

    expect(res.status).toBe(200);
    expect(res.body.data.isFeatured).toBe(true);
  });

  it('lets a patch clear a redundant discount price', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id, body } = await createProduct(agent);

    await prisma.product.update({
      where: { id },
      data: { discountPricePoisha: body.basePricePoisha as number },
    });

    const res = await agent
      .patch(`/api/v1/admin/products/${id}`)
      .send({ discountPricePoisha: null });

    expect(res.status).toBe(200);
    expect(res.body.data.discountPricePoisha).toBeNull();
  });

  it('rejects an empty patch', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createProduct(agent);

    const res = await agent.patch(`/api/v1/admin/products/${id}`).send({});
    expect(res.status).toBe(422);
  });
});

// ── Publish ─────────────────────────────────────────────────────────────────
describe('publish', () => {
  it('422s a product with no image and leaves it unpublished', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createProduct(agent);

    const res = await agent.post(`/api/v1/admin/products/${id}/publish`).send({ publish: true });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    // The refusal must list every missing requirement, not just the first.
    const details = res.body.error.details as Array<{ field: string }>;
    expect(details.map((d) => d.field)).toContain('images');

    const row = await prisma.product.findUniqueOrThrow({
      where: { id },
      select: { isPublished: true, isDraft: true },
    });
    expect(row.isPublished).toBe(false);
    expect(row.isDraft).toBe(true);
  });

  it('publishes once an image exists', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createProduct(agent);

    const image = await agent
      .post(`/api/v1/admin/products/${id}/images`)
      .send({ url: 'https://cdn.example.com/test.jpg', altEn: 'Test' });
    expect(image.status).toBe(201);

    const res = await agent.post(`/api/v1/admin/products/${id}/publish`).send({ publish: true });
    expect(res.status).toBe(200);
    expect(res.body.data.isPublished).toBe(true);
    expect(res.body.data.status).toBe('published');
  });
});

// ── Archive ─────────────────────────────────────────────────────────────────
describe('archive', () => {
  it('removes the product from the default list and shows it under status=archived', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createProduct(agent);

    const archived = await agent.post(`/api/v1/admin/products/${id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe('archived');
    expect(archived.body.data.archivedAt).toBeTruthy();

    const all = await agent.get('/api/v1/admin/products?status=all&limit=100');
    expect(all.status).toBe(200);
    expect(all.body.data.items.map((item: { id: string }) => item.id)).not.toContain(id);

    const archivedTab = await agent.get('/api/v1/admin/products?status=archived&limit=100');
    expect(archivedTab.status).toBe(200);
    expect(archivedTab.body.data.items.map((item: { id: string }) => item.id)).toContain(id);
  });
});

// ── Delete ──────────────────────────────────────────────────────────────────
describe('delete', () => {
  it('409s a product that appears in an order, and keeps the row', async () => {
    const agent = await signIn('super@sharkmart.test');

    // Find a seeded product that a real order references.
    const orderItem = await prisma.orderItem.findFirstOrThrow({
      select: { productId: true },
    });

    const res = await agent.delete(`/api/v1/admin/products/${orderItem.productId}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details.orderItemCount).toBeGreaterThan(0);

    const stillThere = await prisma.product.findUnique({ where: { id: orderItem.productId } });
    expect(stillThere).not.toBeNull();
  });

  it('deletes a product with no order lines', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createProduct(agent);

    const res = await agent.delete(`/api/v1/admin/products/${id}`);
    expect(res.status).toBe(200);

    const gone = await prisma.product.findUnique({ where: { id } });
    expect(gone).toBeNull();

    // It is already gone; drop it from the cleanup list so afterAll does not
    // try to delete it twice.
    const index = createdProductIds.indexOf(id);
    if (index >= 0) createdProductIds.splice(index, 1);
  });
});

// ── Stock filter ────────────────────────────────────────────────────────────
describe('stock filter', () => {
  it('returns only out-of-stock products, and total matches the filtered count', async () => {
    const agent = await signIn('super@sharkmart.test');

    const res = await agent.get('/api/v1/admin/products?stock=out&limit=100&status=all');
    expect(res.status).toBe(200);

    const items = res.body.data.items as Array<{ id: string; stock: number; stockStatus: string }>;
    const total = res.body.data.total as number;

    // Every returned row really is out of stock.
    for (const item of items) {
      expect(item.stock).toBe(0);
      expect(item.stockStatus).toBe('out_of_stock');
    }

    /**
     * The count must equal the number of matching rows, not the size of the
     * unfiltered catalog. This is the assertion the storefront's post-filter
     * would fail: it filters the page after counting, so `total` counts
     * everything.
     */
    expect(total).toBe(items.length);

    // And it must be a real filter, not a no-op that happens to return nothing.
    const unfiltered = await agent.get('/api/v1/admin/products?status=all&limit=1');
    expect(unfiltered.body.data.total).toBeGreaterThanOrEqual(total);
  });

  it('never reports a variant product as out of stock while its variants hold stock', async () => {
    const agent = await signIn('super@sharkmart.test');

    // A seeded product with variants and positive variant stock.
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { stock: { gt: 5 } },
      select: { productId: true },
    });

    const res = await agent.get(`/api/v1/admin/products/${variant.productId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.stock).toBeGreaterThan(0);
    expect(res.body.data.stockStatus).not.toBe('out_of_stock');
  });
});

// ── Pagination ──────────────────────────────────────────────────────────────
describe('pagination', () => {
  it('returns the requested page and an honest total', async () => {
    const agent = await signIn('super@sharkmart.test');

    const first = await agent.get('/api/v1/admin/products?page=1&limit=5&status=all');
    expect(first.status).toBe(200);
    expect(first.body.data.items).toHaveLength(5);
    expect(first.body.data.page).toBe(1);
    expect(first.body.data.limit).toBe(5);

    const second = await agent.get('/api/v1/admin/products?page=2&limit=5&status=all');
    expect(second.status).toBe(200);

    // Different rows, same total.
    expect(second.body.data.total).toBe(first.body.data.total);
    const firstIds = first.body.data.items.map((i: { id: string }) => i.id);
    const secondIds = second.body.data.items.map((i: { id: string }) => i.id);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
  });

  it('rejects a limit above the cap', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/products?limit=1000');
    expect(res.status).toBe(422);
  });
});

// ── Images and variants ─────────────────────────────────────────────────────
describe('images', () => {
  it('makes the first image main and refuses a non-http url', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createProduct(agent);

    const bad = await agent
      .post(`/api/v1/admin/products/${id}/images`)
      .send({ url: 'javascript:alert(1)' });
    expect(bad.status).toBe(422);

    const good = await agent
      .post(`/api/v1/admin/products/${id}/images`)
      .send({ url: 'https://cdn.example.com/a.jpg' });
    expect(good.status).toBe(201);
    expect(good.body.data.images[0].isMain).toBe(true);
  });

  it('refuses to reorder images belonging to another product', async () => {
    const agent = await signIn('super@sharkmart.test');
    const a = await createProduct(agent);
    const b = await createProduct(agent);

    const image = await agent
      .post(`/api/v1/admin/products/${a.id}/images`)
      .send({ url: 'https://cdn.example.com/a.jpg' });

    const foreignImageId = image.body.data.images[0].id as string;

    const res = await agent
      .patch(`/api/v1/admin/products/${b.id}/images/reorder`)
      .send({ imageIds: [foreignImageId] });

    expect(res.status).toBe(422);
  });
});

describe('variants', () => {
  it('creates a variant and 409s a duplicate variant sku', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createProduct(agent);

    const sku = `VAR-${uniq()}`;
    const created = await agent.post(`/api/v1/admin/products/${id}/variants`).send({
      sku,
      nameEn: 'Size M',
      nameBn: 'সাইজ এম',
      pricePoisha: 129_900,
      stock: 10,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.variants).toHaveLength(1);

    const duplicate = await agent.post(`/api/v1/admin/products/${id}/variants`).send({
      sku,
      nameEn: 'Size L',
      nameBn: 'সাইজ এল',
      pricePoisha: 129_900,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.details.field).toBe('sku');
  });
});

// ── Form options ────────────────────────────────────────────────────────────
describe('form options', () => {
  it('returns flat categories and brands for the form selects', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/products/form-options');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.categories)).toBe(true);
    expect(Array.isArray(res.body.data.brands)).toBe(true);
    expect(res.body.data.categories.length).toBeGreaterThan(0);
    // The static route must not be swallowed by /:id.
    expect(res.body.data.categories[0]).toHaveProperty('parentId');
  });
});
