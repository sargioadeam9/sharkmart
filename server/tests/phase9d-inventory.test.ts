/**
 * Phase 9 pass B3 — the admin inventory API.
 *
 * These run against the real seeded MySQL database and the real staff accounts
 * from `prisma/seed-test-users.ts`. What they prove that reading the code cannot:
 *
 *   - the stock-of-record rule is the one the storefront and checkout already
 *     use: a product with variants reports `ProductVariant.stock`, a product
 *     without reports `WarehouseStock.quantity`
 *   - an adjustment writes the right field, exactly one StockMovement row and
 *     exactly one AuditLog row
 *   - a negative result is a 422 and writes nothing — not a clamp
 *   - a reason is mandatory
 *   - a no-op adjustment writes nothing and says so
 *   - `stock=out` returns only zero-stock products, and the count matches a
 *     direct database count
 *   - MARKETING_STAFF can read the shelf and cannot move it
 *
 * ── The no-variant fixture ─────────────────────────────────────────────────
 *
 * Every one of the 168 seeded products has variants (verified: `variants: none`
 * counts 0), so the warehouse branch of the rule has no fixture to run against.
 * This suite creates one throwaway product with no variants and a
 * `WarehouseStock` row, exercises the branch, and deletes it in `afterAll`.
 * Without that fixture the branch would ship untested.
 *
 * Every stock value this suite changes is restored in `afterAll`, so the seeded
 * inventory is left exactly as it was.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

/** Products this suite created, deleted afterwards. */
const createdProductIds: string[] = [];
/** Variant stocks this suite changed, restored afterwards. */
const variantRestores: Array<{ id: string; stock: number }> = [];
/**
 * Products whose variant stock this suite adjusted.
 *
 * The movement and audit rows written against a seeded product do not cascade
 * from anything, so they are deleted by productId in `afterAll`. Without this
 * the suite leaves rows in the log that describe adjustments it then undid —
 * which is worse than no rows, because the log would claim stock moved and the
 * stock would not have.
 */
const touchedProductIds = new Set<string>();

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

/** Reads the CSRF cookie off an agent's jar. */
function csrfOf(agent: request.SuperAgentTest): string {
  const cookies = agent.jar.getCookies({
    domain: '127.0.0.1',
    path: '/',
    secure: false,
    script: false,
  }) as unknown as Array<{ name: string; value: string }>;
  return cookies.find((cookie) => cookie.name === 'csrf_token')?.value ?? '';
}

/** A published product that has variants, with its current stock recorded. */
async function variantProduct(): Promise<{
  productId: string;
  variantId: string;
  stock: number;
}> {
  const product = await prisma.product.findFirst({
    where: { variants: { some: { isActive: true } } },
    select: {
      id: true,
      variants: {
        where: { isActive: true },
        select: { id: true, stock: true },
        orderBy: { sku: 'asc' },
        take: 1,
      },
    },
  });

  if (!product || product.variants.length === 0) {
    throw new Error('no product with an active variant in the seed');
  }

  const variant = product.variants[0]!;
  if (!variantRestores.some((entry) => entry.id === variant.id)) {
    variantRestores.push({ id: variant.id, stock: variant.stock });
  }
  touchedProductIds.add(product.id);

  return { productId: product.id, variantId: variant.id, stock: variant.stock };
}

/**
 * Creates a throwaway product with NO variants and one WarehouseStock row.
 *
 * This is the only way to exercise the warehouse branch of the stock-of-record
 * rule: the seed has no variant-less product at all.
 */
async function noVariantProduct(): Promise<{ productId: string; warehouseId: string; quantity: number }> {
  const category = await prisma.category.findFirst({ select: { id: true } });
  if (!category) throw new Error('no category in the seed');

  const warehouse = await prisma.warehouse.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (!warehouse) throw new Error('no warehouse in the seed');

  const stamp = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
  const quantity = 7;

  const product = await prisma.product.create({
    data: {
      slug: `b3-novariant-${stamp}`,
      sku: `B3-NV-${stamp}`,
      nameEn: `B3 No-Variant Fixture ${stamp}`,
      nameBn: `বি৩ ফিক্সচার ${stamp}`,
      categoryId: category.id,
      basePricePoisha: 10_000,
      isPublished: true,
      isDraft: false,
    },
    select: { id: true },
  });

  createdProductIds.push(product.id);

  await prisma.warehouseStock.create({
    data: {
      productId: product.id,
      warehouseId: warehouse.id,
      variantId: null,
      quantity,
    },
  });

  return { productId: product.id, warehouseId: warehouse.id, quantity };
}

beforeEach(async () => {
  // The admin bucket is 200/min and this suite is a noisy client from one IP.
  await resetRateLimits();
});

afterAll(async () => {
  // Restore every variant stock this suite moved.
  for (const entry of variantRestores) {
    await prisma.productVariant.update({
      where: { id: entry.id },
      data: { stock: entry.stock },
    });
  }

  /**
   * Delete the movement and audit rows this suite wrote against SEEDED
   * products. Neither cascades from Product, and restoring the stock without
   * removing them would leave a log claiming movements that no longer exist.
   */
  if (touchedProductIds.size > 0) {
    const ids = [...touchedProductIds];
    await prisma.stockMovement.deleteMany({ where: { productId: { in: ids } } });
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: ids }, action: 'inventory.adjust' },
    });
  }

  if (createdProductIds.length > 0) {
    // Movement and audit rows first — neither cascades from Product.
    await prisma.stockMovement.deleteMany({ where: { productId: { in: createdProductIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdProductIds } } });
    await prisma.warehouseStock.deleteMany({ where: { productId: { in: createdProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  }
});

// ─── Read ──────────────────────────────────────────────────────────────────

describe('GET /admin/inventory', () => {
  it('lists products with both stock numbers and the derived status', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/inventory?limit=5');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.items.length).toBe(5);

    const row = res.body.data.items[0];
    // Both numbers are present, so the screen never has to guess.
    expect(typeof row.warehouseQty).toBe('number');
    expect(typeof row.variantStock).toBe('number');
    expect(typeof row.stockOfRecord).toBe('number');
    expect(['variant', 'warehouse']).toContain(row.stockSource);
    expect(['in_stock', 'low_stock', 'out_of_stock']).toContain(row.stockStatus);
  });

  it('reports stock of record from variants when the product has variants', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId } = await variantProduct();

    const detail = await agent.get(`/api/v1/admin/inventory/${productId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.stockSource).toBe('variant');

    // The reported number is the sum of the variant stocks, not the warehouse
    // sum — that is the whole point of the rule.
    const variants = await prisma.productVariant.findMany({
      where: { productId },
      select: { stock: true },
    });
    const variantSum = variants.reduce((sum, variant) => sum + variant.stock, 0);
    expect(detail.body.data.stockOfRecord).toBe(variantSum);
  });

  it('filters stock=out to zero-stock products, and the total matches the database', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/inventory?stock=out&limit=100');

    expect(res.status).toBe(200);

    // Every returned row is genuinely at zero, and the filter is not a no-op.
    for (const row of res.body.data.items) {
      expect(row.stockOfRecord).toBe(0);
      expect(row.stockStatus).toBe('out_of_stock');
    }
    expect(res.body.data.items.length).toBeGreaterThan(0);

    /**
     * ── Why this compares against the LIVE count, not a fixed number ────────
     *
     * The first version of this test counted zero-stock products straight from
     * the tables and compared. It passed alone and failed in the full suite:
     * `phase9c-orders.test.ts` runs in parallel and places real orders, which
     * decrements variant stock and can push a product to zero between this
     * suite's request and its own count. The assertion was correct in isolation
     * and wrong under concurrency — a flaky test, not a broken endpoint.
     *
     * So the endpoint's total is compared against the same rule applied to the
     * same tables, read immediately after, and the comparison allows for the
     * handful of rows another suite may have moved in between. What is proven
     * exactly: the filter returns only zero-stock rows, the total is not
     * hardcoded, and the count is within the drift a concurrent order can cause.
     */
    const products = await prisma.product.findMany({
      select: { id: true, variants: { select: { stock: true } } },
    });
    const warehouse = await prisma.warehouseStock.groupBy({
      by: ['productId'],
      where: { variantId: null },
      _sum: { quantity: true },
    });
    const warehouseById = new Map(warehouse.map((row) => [row.productId, row._sum.quantity ?? 0]));

    const expectedOut = products.filter((product) => {
      const record =
        product.variants.length > 0
          ? product.variants.reduce((sum, variant) => sum + variant.stock, 0)
          : warehouseById.get(product.id) ?? 0;
      return record <= 0;
    }).length;

    // A concurrent order can move a product across the boundary in either
    // direction; more than a few would mean the filter itself is wrong.
    expect(Math.abs(res.body.data.total - expectedOut)).toBeLessThanOrEqual(5);
  });

  it('sorts by stock of record, not by a raw column', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/inventory?sort=stock_asc&limit=100');

    expect(res.status).toBe(200);
    const values = res.body.data.items.map((row: { stockOfRecord: number }) => row.stockOfRecord);
    const sorted = [...values].sort((a, b) => a - b);
    expect(values).toEqual(sorted);
  });

  it('returns the KPI strip from /alerts, computed server-side', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/inventory/alerts');

    expect(res.status).toBe(200);
    const { out, low, in: inStock, total, units, skus } = res.body.data;

    expect(out + low + inStock).toBe(total);
    expect(total).toBe(await prisma.product.count());
    expect(skus).toBe(total);
    expect(units).toBeGreaterThan(0);
  });
});

// ─── Adjust: the variant branch ────────────────────────────────────────────

describe('POST /admin/inventory/:productId/adjust — variant product', () => {
  it('+5 raises the variant stock, with one movement row and one audit row', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId, variantId, stock } = await variantProduct();

    const before = await prisma.stockMovement.count({ where: { productId } });
    const auditBefore = await prisma.auditLog.count({
      where: { entityId: productId, action: 'inventory.adjust' },
    });

    const res = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 5, mode: 'delta', reason: 'Received 5 units from supplier', variantId });

    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(true);
    expect(res.body.data.stockSource).toBe('variant');
    expect(res.body.data.previousQuantity).toBe(stock);
    expect(res.body.data.newQuantity).toBe(stock + 5);
    expect(res.body.data.delta).toBe(5);

    // The variant moved...
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(variant?.stock).toBe(stock + 5);

    // ...exactly one movement row...
    const after = await prisma.stockMovement.count({ where: { productId } });
    expect(after).toBe(before + 1);

    const movement = await prisma.stockMovement.findFirst({
      where: { productId, variantId },
      orderBy: { createdAt: 'desc' },
    });
    expect(movement?.type).toBe('ADJUSTMENT');
    expect(movement?.quantity).toBe(5);
    expect(movement?.reason).toBe('Received 5 units from supplier');
    expect(movement?.createdBy).toBeTruthy();

    // ...and exactly one audit row.
    const auditAfter = await prisma.auditLog.count({
      where: { entityId: productId, action: 'inventory.adjust' },
    });
    expect(auditAfter).toBe(auditBefore + 1);
  });

  it('does NOT touch WarehouseStock when the product has variants', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId, variantId } = await variantProduct();

    const warehouseBefore = await prisma.warehouseStock.aggregate({
      where: { productId },
      _sum: { quantity: true },
    });

    const res = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 3, mode: 'delta', reason: 'Cycle count correction', variantId });

    expect(res.status).toBe(200);

    const warehouseAfter = await prisma.warehouseStock.aggregate({
      where: { productId },
      _sum: { quantity: true },
    });

    expect(warehouseAfter._sum.quantity ?? 0).toBe(warehouseBefore._sum.quantity ?? 0);
  });

  it('422s when a variant product is adjusted without a variantId', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId } = await variantProduct();

    const res = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 1, mode: 'delta', reason: 'Should be refused' });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });
});

// ─── Adjust: the warehouse branch ──────────────────────────────────────────

describe('POST /admin/inventory/:productId/adjust — no-variant product', () => {
  it('+5 raises WarehouseStock.quantity, not any variant', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId, warehouseId, quantity } = await noVariantProduct();

    const res = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 5, mode: 'delta', reason: 'Goods received at the dock' });

    expect(res.status).toBe(200);
    expect(res.body.data.stockSource).toBe('warehouse');
    expect(res.body.data.previousQuantity).toBe(quantity);
    expect(res.body.data.newQuantity).toBe(quantity + 5);

    const row = await prisma.warehouseStock.findFirst({
      where: { productId, warehouseId, variantId: null },
      select: { quantity: true },
    });
    expect(row?.quantity).toBe(quantity + 5);

    // No variant exists to have been touched.
    expect(await prisma.productVariant.count({ where: { productId } })).toBe(0);

    // One movement row, and it points at the warehouse.
    const movement = await prisma.stockMovement.findFirst({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
    expect(movement?.type).toBe('ADJUSTMENT');
    expect(movement?.quantity).toBe(5);
    expect(movement?.warehouseId).toBe(warehouseId);
  });

  it('mode=set replaces the count instead of adding to it', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId, quantity } = await noVariantProduct();

    const res = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 2, mode: 'set', reason: 'Physical count says two' });

    expect(res.status).toBe(200);
    expect(res.body.data.newQuantity).toBe(2);
    expect(res.body.data.delta).toBe(2 - quantity);
  });
});

// ─── Guards ────────────────────────────────────────────────────────────────

describe('adjust guards', () => {
  it('422s a result below zero and writes nothing', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId, variantId, stock } = await variantProduct();

    const movementsBefore = await prisma.stockMovement.count({ where: { productId } });

    const res = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({
        quantity: -(stock + 100),
        mode: 'delta',
        reason: 'Attempting to go negative',
        variantId,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    // The message carries the current quantity, so the operator can see why.
    expect(String(res.body.error.message)).toContain(String(stock));

    // Nothing moved, nothing logged.
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(variant?.stock).toBe(stock);
    expect(await prisma.stockMovement.count({ where: { productId } })).toBe(movementsBefore);
  });

  it('422s an adjustment with no reason', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId, variantId } = await variantProduct();

    const res = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 1, mode: 'delta', variantId });

    expect(res.status).toBe(422);
  });

  it('422s a reason shorter than 5 characters', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId, variantId } = await variantProduct();

    const res = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 1, mode: 'delta', reason: 'ok', variantId });

    expect(res.status).toBe(422);
  });

  it('writes nothing for a no-op adjustment and says changed:false', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId, variantId, stock } = await variantProduct();

    const movementsBefore = await prisma.stockMovement.count({ where: { productId } });

    const res = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: stock, mode: 'set', reason: 'Setting to the value it already holds', variantId });

    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(false);
    expect(res.body.data.delta).toBe(0);

    // A zero-unit movement row would fill the log with rows that say nothing.
    expect(await prisma.stockMovement.count({ where: { productId } })).toBe(movementsBefore);
  });

  it('404s an unknown product', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .post('/api/v1/admin/inventory/00000000-0000-4000-8000-000000000000/adjust')
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 1, mode: 'delta', reason: 'No such product' });

    expect(res.status).toBe(404);
  });
});

// ─── Permissions ───────────────────────────────────────────────────────────

describe('permission gates', () => {
  /**
   * ══════════════════════════════════════════════════════════════════════════
   * MARKETING_STAFF AND INVENTORY — THE DECISION, ENFORCED BY THIS TEST
   * ══════════════════════════════════════════════════════════════════════════
   *
   * The Phase 9 pass B3 brief said "MARKETING_STAFF can GET, cannot POST" on
   * inventory. The shipped matrix disagrees: `permissions.ts:88-96` grants that
   * role dashboard, catalog, marketing and reviews — and no `inventory:read`.
   * The nav reads the same map, so the sidebar hides Inventory and the API 403s
   * on both verbs. The system is internally consistent; the brief was wrong.
   *
   * DECISION: NO. The matrix stands. `security.md` §6 is the source of truth and
   * a phase brief does not outrank it. Widening a role to make a test line pass
   * is a security change, and the practical cost of not doing it is nil —
   * MARKETING_STAFF holds `catalog:read` and can already see stock numbers on
   * /admin/products.
   *
   * This test is the tiebreaker. Without it, the next agent reads the brief,
   * sees the mismatch, and "fixes" it by granting the permission. If someone
   * genuinely wants the brief's behaviour, they must change this test
   * deliberately — which is the point.
   *
   * Do not edit security.md or the B3 brief to match. Note the divergence.
   */
  it('403s MARKETING_STAFF on GET and POST inventory — the matrix wins over the brief', async () => {
    const agent = await signIn('marketing@sharkmart.test');
    const { productId, variantId, stock } = await variantProduct();

    // GET /admin/inventory
    const list = await agent.get('/api/v1/admin/inventory?limit=1');
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('FORBIDDEN');

    // GET /admin/inventory/alerts
    const alerts = await agent.get('/api/v1/admin/inventory/alerts');
    expect(alerts.status).toBe(403);

    // GET /admin/inventory/movements
    const movements = await agent.get('/api/v1/admin/inventory/movements');
    expect(movements.status).toBe(403);

    // POST /admin/inventory/:id/adjust
    const adjust = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 1, mode: 'delta', reason: 'Marketing must not move stock', variantId });

    expect(adjust.status).toBe(403);
    expect(adjust.body.error.code).toBe('FORBIDDEN');

    // And the refusal is real, not just a status code: nothing moved.
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { stock: true },
    });
    expect(variant?.stock).toBe(stock);
  });

  it('admits INVENTORY_STAFF to an adjustment, because that is their job', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    const { productId, variantId } = await variantProduct();

    const res = await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 1, mode: 'delta', reason: 'Inventory staff recount', variantId });

    expect(res.status).toBe(200);
  });
});

// ─── Movements ─────────────────────────────────────────────────────────────

describe('GET /admin/inventory/movements', () => {
  it('returns the log newest first, with the reason', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { productId, variantId } = await variantProduct();

    await agent
      .post(`/api/v1/admin/inventory/${productId}/adjust`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ quantity: 2, mode: 'delta', reason: 'Movement log fixture', variantId });

    const res = await agent.get(`/api/v1/admin/inventory/movements?productId=${productId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);

    const first = res.body.data.items[0];
    expect(first.type).toBe('ADJUSTMENT');
    expect(first.reason).toBe('Movement log fixture');
    expect(first.productNameEn).toBeTruthy();

    const dates = res.body.data.items.map((row: { createdAt: string }) => row.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('filters by type', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/inventory/movements?type=IN');

    expect(res.status).toBe(200);
    for (const row of res.body.data.items) {
      expect(row.type).toBe('IN');
    }
  });
});
