/**
 * Phase 10 pass E — warehouses, transfers, and the stock write on receiving.
 *
 * The test that matters most is the last one: a purchase order receipt must move
 * `ProductVariant.stock`, because that is the field checkout decrements. If
 * receiving wrote `WarehouseStock` for a variant product instead, the shop would
 * book in stock and still show "out of stock" — the exact class of drift the
 * inventory module has been carrying since B3.
 *
 * Every stock change made here is reversed in `afterAll`, driven by the
 * StockMovement rows the operations themselves wrote.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

const warehouseIds: string[] = [];
const poIds: string[] = [];
const supplierIds: string[] = [];

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`;
}

/** Reverses every stock movement written by the operations in this suite. */
async function revertMovements(where: { referenceType?: string; referenceId?: { in: string[] } }) {
  const movements = await prisma.stockMovement.findMany({
    where,
    select: { id: true, productId: true, variantId: true, warehouseId: true, quantity: true, type: true },
  });

  for (const movement of movements) {
    const delta = movement.type === 'IN' ? -movement.quantity : movement.quantity;

    if (movement.variantId) {
      await prisma.productVariant.update({
        where: { id: movement.variantId },
        data: { stock: { increment: delta } },
      });
    } else if (movement.warehouseId) {
      const row = await prisma.warehouseStock.findFirst({
        where: { warehouseId: movement.warehouseId, productId: movement.productId, variantId: null },
        select: { id: true },
      });
      if (row) {
        await prisma.warehouseStock.update({
          where: { id: row.id },
          data: { quantity: { increment: delta } },
        });
      }
    }
  }

  await prisma.stockMovement.deleteMany({ where: { id: { in: movements.map((m) => m.id) } } });
}

afterAll(async () => {
  if (poIds.length > 0) {
    await revertMovements({ referenceType: 'PURCHASE_ORDER', referenceId: { in: poIds } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: poIds } } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: poIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
  }

  await revertMovements({ referenceType: 'TRANSFER' });

  if (supplierIds.length > 0) {
    // After the orders: `PurchaseOrder.supplierId` is RESTRICT.
    await prisma.auditLog.deleteMany({ where: { entityId: { in: supplierIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  }

  if (warehouseIds.length > 0) {
    // Transfers first: they are the record of the moves, and a leftover row would
    // show up on the warehouse screen as a move that never happened.
    await prisma.stockTransfer.deleteMany({ where: { fromWarehouseId: { in: warehouseIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: warehouseIds } } });
    await prisma.warehouseStock.deleteMany({ where: { warehouseId: { in: warehouseIds } } });
    await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
  }
});

beforeEach(async () => {
  await resetRateLimits();
});

async function createWarehouse(
  agent: request.SuperAgentTest,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; data: Record<string, unknown> }> {
  const res = await agent.post('/api/v1/admin/warehouses').send({
    name: `WH ${uniq()}`,
    address: 'Dhaka',
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`warehouse create failed: ${res.status} ${JSON.stringify(res.body)}`);
  warehouseIds.push(res.body.data.id);
  return { id: res.body.data.id, data: res.body.data };
}

async function defaultWarehouseId(): Promise<string> {
  const row = await prisma.warehouse.findFirstOrThrow({ where: { isDefault: true }, select: { id: true } });
  return row.id;
}

// ── Directory ──────────────────────────────────────────────────────────────

describe('warehouse directory', () => {
  it('lists warehouses with their totals', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/warehouses');

    expect(res.status).toBe(200);
    const rows = res.body.data.warehouses as Array<{ isDefault: boolean; totalUnits: number }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((row) => row.isDefault)).toHaveLength(1);
  });

  it('moves the default flag rather than duplicating it', async () => {
    const agent = await signIn('super@sharkmart.test');
    const created = await createWarehouse(agent, { isDefault: true });

    expect(created.data.isDefault).toBe(true);

    const all = await prisma.warehouse.findMany({ where: { isDefault: true }, select: { id: true } });
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(created.id);

    // Put the original back so later suites are not surprised.
    const main = await prisma.warehouse.findFirst({ where: { name: { contains: 'Main' } }, select: { id: true } });
    if (main) await agent.post(`/api/v1/admin/warehouses/${main.id}/default`);
  });

  it('refuses an inactive warehouse as default', async () => {
    const agent = await signIn('super@sharkmart.test');
    const created = await createWarehouse(agent);

    await agent.patch(`/api/v1/admin/warehouses/${created.id}`).send({ isActive: false });
    const res = await agent.post(`/api/v1/admin/warehouses/${created.id}/default`);

    expect(res.status).toBe(422);
  });
});

// ── Transfers ──────────────────────────────────────────────────────────────

describe('transfers', () => {
  it('moves stock between two warehouses and writes both movement sides', async () => {
    const agent = await signIn('super@sharkmart.test');

    /**
     * Both ends are test warehouses. Seeding the real default warehouse would
     * mean putting it back afterwards, and getting that wrong pollutes the
     * development database with a number nobody can explain later — which is
     * exactly what happened the first time this test was written.
     */
    const from = (await createWarehouse(agent)).id;
    const to = (await createWarehouse(agent)).id;

    const product = await prisma.product.findFirstOrThrow({ select: { id: true } });
    await prisma.warehouseStock.create({
      data: { warehouseId: from, productId: product.id, variantId: null, quantity: 10 },
    });

    const res = await agent.post('/api/v1/admin/warehouses/transfers').send({
      fromWarehouseId: from,
      toWarehouseId: to,
      productId: product.id,
      quantity: 4,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('COMPLETED');

    const source = await prisma.warehouseStock.findFirstOrThrow({
      where: { warehouseId: from, productId: product.id, variantId: null },
    });
    const destination = await prisma.warehouseStock.findFirstOrThrow({
      where: { warehouseId: to, productId: product.id, variantId: null },
    });

    expect(source.quantity).toBe(6);
    expect(destination.quantity).toBe(4);

    const movements = await prisma.stockMovement.findMany({
      where: { referenceType: 'TRANSFER', productId: product.id },
      select: { type: true, warehouseId: true, quantity: true },
    });
    expect(movements).toHaveLength(2);
    expect(movements.map((m) => m.type).sort()).toEqual(['IN', 'OUT']);

    // afterAll deletes every stock row belonging to these warehouses, so there is
    // nothing to restore by hand.
  });

  it('refuses to move more than the source holds, and moves nothing', async () => {
    const agent = await signIn('super@sharkmart.test');
    const from = await defaultWarehouseId();
    const to = (await createWarehouse(agent)).id;
    const product = await prisma.product.findFirstOrThrow({ select: { id: true } });

    const before = await prisma.warehouseStock.findFirst({
      where: { warehouseId: from, productId: product.id, variantId: null },
      select: { quantity: true },
    });

    const res = await agent.post('/api/v1/admin/warehouses/transfers').send({
      fromWarehouseId: from,
      toWarehouseId: to,
      productId: product.id,
      quantity: (before?.quantity ?? 0) + 1_000,
    });

    expect(res.status).toBe(422);

    const after = await prisma.warehouseStock.findFirst({
      where: { warehouseId: from, productId: product.id, variantId: null },
      select: { quantity: true },
    });
    expect(after?.quantity ?? 0).toBe(before?.quantity ?? 0);

    expect(
      await prisma.warehouseStock.count({ where: { warehouseId: to, productId: product.id } }),
    ).toBe(0);
  });

  it('refuses a transfer to the same warehouse', async () => {
    const agent = await signIn('super@sharkmart.test');
    const from = await defaultWarehouseId();
    const product = await prisma.product.findFirstOrThrow({ select: { id: true } });

    const res = await agent.post('/api/v1/admin/warehouses/transfers').send({
      fromWarehouseId: from,
      toWarehouseId: from,
      productId: product.id,
      quantity: 1,
    });

    expect(res.status).toBe(422);
  });
});

// ── The integration that matters ───────────────────────────────────────────

describe('receiving a purchase order moves the stock of record', () => {
  it('increments the variant stock and writes one movement', async () => {
    const agent = await signIn('super@sharkmart.test');

    // A variant, because that is where a variant product's stock lives.
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true, productId: true, stock: true },
    });

    const supplier = await prisma.supplier.create({
      data: { name: `Stock Test ${uniq()}`, phone: '01911111111' },
      select: { id: true },
    });

    const po = await agent.post('/api/v1/admin/purchase-orders').send({
      supplierId: supplier.id,
      items: [
        { productId: variant.productId, variantId: variant.id, quantity: 5, costPricePoisha: 1_000 },
      ],
    });
    expect(po.status).toBe(201);
    poIds.push(po.body.data.id);

    await agent.post(`/api/v1/admin/purchase-orders/${po.body.data.id}/order`);

    const receive = await agent
      .post(`/api/v1/admin/purchase-orders/${po.body.data.id}/receive`)
      .send({ lines: [{ itemId: po.body.data.items[0].id, receivedQuantity: 5 }], note: 'restock' });

    expect(receive.status).toBe(200);
    expect(receive.body.data.status).toBe('RECEIVED');

    const after = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
      select: { stock: true },
    });
    expect(after.stock).toBe(variant.stock + 5);

    const movement = await prisma.stockMovement.findFirst({
      where: { referenceId: po.body.data.id, referenceType: 'PURCHASE_ORDER' },
      select: { type: true, quantity: true, variantId: true },
    });
    expect(movement).toEqual({ type: 'IN', quantity: 5, variantId: variant.id });

    // Removed in afterAll, after the order that points at it.
    supplierIds.push(supplier.id);
  });
});

// ── Permissions ────────────────────────────────────────────────────────────

describe('permissions', () => {
  it('lets INVENTORY_STAFF read and refuses MARKETING_STAFF', async () => {
    const inventory = await signIn('inventory@sharkmart.test');
    expect((await inventory.get('/api/v1/admin/warehouses')).status).toBe(200);

    const marketing = await signIn('marketing@sharkmart.test');
    expect((await marketing.get('/api/v1/admin/warehouses')).status).toBe(403);
    expect(
      (await marketing.post('/api/v1/admin/warehouses').send({ name: 'x' })).status,
    ).toBe(403);
  });
});
