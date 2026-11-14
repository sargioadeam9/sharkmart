/**
 * Phase 10 pass M — the till.
 *
 * Four things here are the reason this suite exists, in order of how expensive
 * they would be to get wrong in a real shop:
 *
 *  1. A counter sale must be a real `Order`. If it is not, the dashboard and the
 *     reports under-report every taka taken at the counter, and the number is
 *     quietly wrong rather than visibly broken.
 *  2. Stock must move, and move on the same field checkout decrements. A till
 *     that sells without decrementing means the website keeps selling goods that
 *     left the shop last Tuesday.
 *  3. A double-tapped "Complete sale" must ring the goods up once. This is
 *     tested by replaying the same `clientRef` and asserting the stock did not
 *     move the second time.
 *  4. The shift must balance: opening float + cash sales must equal what the
 *     drawer is expected to hold, and the variance must be the difference from
 *     what was counted.
 *
 * Every stock change is restored in `afterAll` from the value recorded before,
 * not by reversing a delta — a delta assumes the intermediate steps were all
 * correct, which is exactly the thing under test.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';
const ADMIN_EMAIL = 'super@sharkmart.test';

let agent: request.SuperAgentTest;

interface Fixture {
  productId: string;
  variantId: string | null;
  pricePoisha: number;
  stockBefore: number;
  warehouseId: string | null;
}

let variantFixture: Fixture;
let plainFixture: Fixture;

/** The throwaway variant-less product, deleted in `afterAll`. */
let tempProductId: string | null = null;

const createdOrderIds: string[] = [];
const createdSessionIds: string[] = [];

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const instance = request.agent(app);
  const res = await instance
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return instance;
}

beforeAll(async () => {
  agent = await signIn(ADMIN_EMAIL);

  // ── A product that has variants ──────────────────────────────────────────
  const variant = await prisma.productVariant.findFirst({
    where: { stock: { gte: 20 }, isActive: true, product: { isPublished: true } },
    orderBy: { sku: 'asc' },
    select: { id: true, productId: true, pricePoisha: true, stock: true },
  });
  if (!variant) throw new Error('seed has no variant with stock >= 20');
  variantFixture = {
    productId: variant.productId,
    variantId: variant.id,
    pricePoisha: variant.pricePoisha,
    stockBefore: variant.stock,
    warehouseId: null,
  };

  // ── A product without variants, held in a warehouse ──────────────────────
  //
  // Every one of the 168 seeded products has variants, so this fixture is
  // created rather than found. It has to exist: the variant-less path decrements
  // `WarehouseStock` instead of `ProductVariant.stock`, and that is the branch
  // that silently drifts from checkout if it is wrong. It is deleted in
  // `afterAll`.
  const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { isActive: true },
    select: { id: true },
  });

  const stamp = Date.now().toString(36);
  const tempProduct = await prisma.product.create({
    data: {
      slug: `pos-test-${stamp}`,
      sku: `POS-TEST-${stamp}`,
      nameEn: 'POS test product',
      nameBn: 'পিওএস টেস্ট পণ্য',
      categoryId: category.id,
      basePricePoisha: 12000,
      isPublished: false,
      isDraft: false,
    },
    select: { id: true },
  });

  tempProductId = tempProduct.id;

  await prisma.warehouseStock.create({
    data: { warehouseId: warehouse.id, productId: tempProduct.id, variantId: null, quantity: 30 },
  });

  plainFixture = {
    productId: tempProduct.id,
    variantId: null,
    pricePoisha: 12000,
    stockBefore: 30,
    warehouseId: warehouse.id,
  };
});

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { referenceId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }

  await prisma.auditLog.deleteMany({
    where: { OR: [{ action: 'pos.sale' }, { action: 'pos.session_open' }, { action: 'pos.session_close' }] },
  });

  if (createdSessionIds.length > 0) {
    await prisma.posSession.deleteMany({ where: { id: { in: createdSessionIds } } });
  }

  // Restore the recorded values, not a delta.
  if (variantFixture.variantId) {
    await prisma.productVariant.update({
      where: { id: variantFixture.variantId },
      data: { stock: variantFixture.stockBefore },
    });
  }

  if (plainFixture.warehouseId) {
    const row = await prisma.warehouseStock.findFirst({
      where: {
        warehouseId: plainFixture.warehouseId,
        productId: plainFixture.productId,
        variantId: null,
      },
      select: { id: true },
    });
    if (row) {
      await prisma.warehouseStock.update({
        where: { id: row.id },
        data: { quantity: plainFixture.stockBefore },
      });
    }
  }

  /**
   * The throwaway product goes last: its orders and movements were deleted
   * above, and `OrderItem.productId` is RESTRICT, so the order matters.
   */
  if (tempProductId) {
    await prisma.warehouseStock.deleteMany({ where: { productId: tempProductId } });
    await prisma.stockMovement.deleteMany({ where: { productId: tempProductId } });
    await prisma.product.delete({ where: { id: tempProductId } }).catch(() => undefined);
  }
});

async function variantStockNow(): Promise<number> {
  const row = await prisma.productVariant.findUniqueOrThrow({
    where: { id: variantFixture.variantId! },
    select: { stock: true },
  });
  return row.stock;
}

async function plainStockNow(): Promise<number> {
  const row = await prisma.warehouseStock.findFirstOrThrow({
    where: {
      warehouseId: plainFixture.warehouseId!,
      productId: plainFixture.productId,
      variantId: null,
    },
    select: { quantity: true },
  });
  return row.quantity;
}

function saleBody(overrides: Record<string, unknown> = {}) {
  const quantity = 2;
  const total = variantFixture.pricePoisha * quantity;

  return {
    clientRef: randomUUID(),
    items: [{ productId: variantFixture.productId, variantId: variantFixture.variantId, quantity }],
    paymentMethod: 'CASH',
    cashReceivedPoisha: total + 5000,
    discountPoisha: 0,
    ...overrides,
  };
}

describe('POS — shift', () => {
  it('reports no open shift before one is opened', async () => {
    const res = await agent.get('/api/v1/admin/pos/session/current');
    expect(res.status).toBe(200);
    expect(res.body.data.session).toBeNull();
  });

  it('refuses a sale with no open shift', async () => {
    const res = await agent.post('/api/v1/admin/pos/sales').send(saleBody());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    // The message must say what to do, not just that something is wrong.
    expect(res.body.error.message).toMatch(/shift/i);
  });

  it('opens a shift and refuses a second one', async () => {
    const res = await agent
      .post('/api/v1/admin/pos/session/open')
      .send({ openingCashPoisha: 500000, note: 'Morning float' });

    expect(res.status).toBe(201);
    expect(res.body.data.session.status).toBe('OPEN');
    expect(res.body.data.session.openingCashPoisha).toBe(500000);
    expect(res.body.data.session.saleCount).toBe(0);
    createdSessionIds.push(res.body.data.session.id);

    const second = await agent.post('/api/v1/admin/pos/session/open').send({ openingCashPoisha: 0 });
    expect(second.status).toBe(409);
  });
});

describe('POS — catalog search', () => {
  it('finds a product by its SKU, which is what a scanner types', async () => {
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantFixture.variantId! },
      select: { sku: true },
    });

    const res = await agent.get('/api/v1/admin/pos/catalog').query({ q: variant.sku });

    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{ productId: string }>;
    expect(items.some((item) => item.productId === variantFixture.productId)).toBe(true);
  });
});

describe('POS — selling', () => {
  let firstSale: { orderId: string; orderNumber: string; changePoisha: number; clientRef: string };

  it('rings up a cash sale, takes the money and moves the stock', async () => {
    const stockBefore = await variantStockNow();
    const body = saleBody();
    const total = variantFixture.pricePoisha * 2;

    const res = await agent.post('/api/v1/admin/pos/sales').send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.totalPoisha).toBe(total);
    expect(res.body.data.cashReceivedPoisha).toBe(total + 5000);
    expect(res.body.data.changePoisha).toBe(5000);
    expect(res.body.data.replayed).toBe(false);
    expect(res.body.data.items).toHaveLength(1);

    createdOrderIds.push(res.body.data.orderId);
    firstSale = {
      orderId: res.body.data.orderId,
      orderNumber: res.body.data.orderNumber,
      changePoisha: res.body.data.changePoisha,
      clientRef: body.clientRef,
    };

    // Stock moved by exactly the quantity sold.
    expect(await variantStockNow()).toBe(stockBefore - 2);

    // The order is a real order, in the state a counter sale is actually in.
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: res.body.data.orderId },
      select: {
        channel: true,
        currentStatus: true,
        paymentStatus: true,
        paidAmountPoisha: true,
        totalAmountPoisha: true,
        deliveryChargePoisha: true,
        posSessionId: true,
        items: { select: { quantity: true, lineTotalPoisha: true } },
      },
    });

    expect(order.channel).toBe('POS');
    expect(order.currentStatus).toBe('DELIVERED');
    expect(order.paymentStatus).toBe('PAID');
    expect(order.paidAmountPoisha).toBe(total);
    expect(order.deliveryChargePoisha).toBe(0);
    expect(order.posSessionId).toBe(createdSessionIds[0]);
    expect(order.items[0]!.lineTotalPoisha).toBe(total);

    // And a movement row, pointing at the order.
    const movement = await prisma.stockMovement.findFirst({
      where: { referenceId: res.body.data.orderId },
      select: { type: true, quantity: true, reason: true },
    });
    expect(movement).not.toBeNull();
    expect(movement!.type).toBe('OUT');
    expect(movement!.quantity).toBe(2);
    expect(movement!.reason).toBe('Counter sale');
  });

  it('replays a retried request instead of selling the goods twice', async () => {
    const stockBefore = await variantStockNow();

    const replay = await agent.post('/api/v1/admin/pos/sales').send({
      clientRef: firstSale.clientRef,
      items: [
        { productId: variantFixture.productId, variantId: variantFixture.variantId, quantity: 2 },
      ],
      paymentMethod: 'CASH',
      cashReceivedPoisha: variantFixture.pricePoisha * 2 + 5000,
      discountPoisha: 0,
    });

    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.orderNumber).toBe(firstSale.orderNumber);

    // The point of the whole test: nothing moved.
    expect(await variantStockNow()).toBe(stockBefore);
  });

  it('refuses cash that is less than the total', async () => {
    const total = variantFixture.pricePoisha * 2;
    const res = await agent.post('/api/v1/admin/pos/sales').send(
      saleBody({ cashReceivedPoisha: total - 100 }),
    );

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/less than the total/i);
  });

  it('refuses a manual discount above half the bill', async () => {
    const subtotal = variantFixture.pricePoisha * 2;
    const res = await agent.post('/api/v1/admin/pos/sales').send(
      saleBody({ discountPoisha: subtotal }),
    );

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/50%/);
  });

  it('refuses a variant product with no variant chosen', async () => {
    const res = await agent.post('/api/v1/admin/pos/sales').send(
      saleBody({ items: [{ productId: variantFixture.productId, quantity: 1 }] }),
    );

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/variants/i);
  });

  it('decrements warehouse stock for a product that has no variants', async () => {
    const before = await plainStockNow();

    const res = await agent.post('/api/v1/admin/pos/sales').send({
      clientRef: randomUUID(),
      items: [{ productId: plainFixture.productId, quantity: 3 }],
      paymentMethod: 'CARD',
      discountPoisha: 0,
    });

    expect(res.status).toBe(201);
    createdOrderIds.push(res.body.data.orderId);

    // Card settles the exact amount: no change, and no cash to reconcile.
    expect(res.body.data.changePoisha).toBe(0);
    expect(res.body.data.cashReceivedPoisha).toBe(res.body.data.totalPoisha);

    expect(await plainStockNow()).toBe(before - 3);
  });

  it('makes the counter sale visible to the orders module', async () => {
    const res = await agent
      .get('/api/v1/admin/orders/lookup')
      .query({ orderNumber: firstSale.orderNumber });

    expect(res.status).toBe(200);
    expect(res.body.data.orderNumber).toBe(firstSale.orderNumber);
  });
});

describe('POS — closing the shift', () => {
  it('computes the expected drawer and the variance', async () => {
    const sessionId = createdSessionIds[0]!;

    const session = await prisma.posSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { openingCashPoisha: true },
    });

    const live = await agent.get(`/api/v1/admin/pos/session/${sessionId}`);
    expect(live.status).toBe(200);

    const cashSales = live.body.data.session.cashSalesPoisha as number;
    const expected = session.openingCashPoisha + cashSales;

    // Count ৳25 short, which is the number a real shop wants to see.
    const res = await agent
      .post(`/api/v1/admin/pos/session/${sessionId}/close`)
      .send({ countedCashPoisha: expected - 2500, note: 'Counted at close' });

    expect(res.status).toBe(200);
    expect(res.body.data.session.status).toBe('CLOSED');
    expect(res.body.data.session.expectedCashPoisha).toBe(expected);
    expect(res.body.data.session.variancePoisha).toBe(-2500);
    expect(res.body.data.session.snapshot).toBe(true);
    expect(res.body.data.session.saleCount).toBeGreaterThan(0);

    // Closing twice is a conflict, not a silent overwrite of the count.
    const again = await agent
      .post(`/api/v1/admin/pos/session/${sessionId}/close`)
      .send({ countedCashPoisha: expected });
    expect(again.status).toBe(409);
  });

  it('refuses a sale after the shift is closed', async () => {
    const res = await agent.post('/api/v1/admin/pos/sales').send(saleBody());
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/shift/i);
  });
});
