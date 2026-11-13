/**
 * Phase 10 pass D — suppliers and purchase orders.
 *
 * The assertions that matter are the state machine and the receipt arithmetic:
 *
 *   - a DRAFT cannot be received (the shop cannot take delivery of something
 *     nobody sent for)
 *   - receiving is a delta, so two partial receipts add up
 *   - an over-receipt is refused as a whole, not partially applied
 *   - a fully received order is closed, and cancelling it is refused
 *
 * Receiving deliberately does not touch stock — that belongs to the warehouse
 * module, and there is a note in the service explaining why.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

const supplierIds: string[] = [];
const poIds: string[] = [];

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

function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`;
}

async function createSupplier(
  agent: request.SuperAgentTest,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; data: Record<string, unknown> }> {
  const res = await agent.post('/api/v1/admin/suppliers').send({
    name: `Supplier ${uniq()}`,
    contactPerson: 'Karim',
    phone: '01712345678',
    email: 'supplier@example.com',
    ...overrides,
  });
  if (res.status !== 201) {
    throw new Error(`supplier create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.data.id as string;
  supplierIds.push(id);
  return { id, data: res.body.data };
}

async function aProductId(): Promise<string> {
  const product = await prisma.product.findFirstOrThrow({ select: { id: true } });
  return product.id;
}

async function createPo(
  agent: request.SuperAgentTest,
  supplierId: string,
  quantity = 10,
  costPricePoisha = 5_000,
): Promise<{ id: string; data: Record<string, unknown> }> {
  const res = await agent.post('/api/v1/admin/purchase-orders').send({
    supplierId,
    notes: 'weekly restock',
    items: [{ productId: await aProductId(), quantity, costPricePoisha }],
  });
  if (res.status !== 201) {
    throw new Error(`po create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.data.id as string;
  poIds.push(id);
  return { id, data: res.body.data };
}

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(async () => {
  if (poIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: poIds } } });
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: { in: poIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
  }
  if (supplierIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: supplierIds } } });
    await prisma.supplierProduct.deleteMany({ where: { supplierId: { in: supplierIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
  }
});

// ── Directory ──────────────────────────────────────────────────────────────

describe('supplier directory', () => {
  it('creates a supplier and writes one audit row', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id, data } = await createSupplier(agent);

    expect(data.isActive).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'supplier.create' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects a phone that is not a phone', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .post('/api/v1/admin/suppliers')
      .send({ name: 'Bad Phone', phone: 'abc' });
    expect(res.status).toBe(422);
  });

  it('filters by active state', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createSupplier(agent);

    await agent.post(`/api/v1/admin/suppliers/${id}/active`).send({ isActive: false });

    const inactive = await agent.get('/api/v1/admin/suppliers?active=false&limit=100');
    expect(inactive.body.data.items.some((row: { id: string }) => row.id === id)).toBe(true);

    const active = await agent.get('/api/v1/admin/suppliers?active=true&limit=100');
    expect(active.body.data.items.some((row: { id: string }) => row.id === id)).toBe(false);
  });

  it('links a product, and re-linking updates the cost instead of failing', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createSupplier(agent);
    const productId = await aProductId();

    const first = await agent
      .post(`/api/v1/admin/suppliers/${id}/products`)
      .send({ productId, costPricePoisha: 4_000, leadDays: 3 });
    expect(first.status).toBe(201);

    const second = await agent
      .post(`/api/v1/admin/suppliers/${id}/products`)
      .send({ productId, costPricePoisha: 4_500 });
    expect(second.status).toBe(201);

    const detail = await agent.get(`/api/v1/admin/suppliers/${id}`);
    const link = detail.body.data.products.find((row: { productId: string }) => row.productId === productId);
    expect(link.costPricePoisha).toBe(4_500);
  });

  it('refuses to delete a supplier that has orders, and allows it otherwise', async () => {
    const agent = await signIn('super@sharkmart.test');
    const withOrders = await createSupplier(agent);
    await createPo(agent, withOrders.id);

    const refused = await agent.delete(`/api/v1/admin/suppliers/${withOrders.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.details.reason).toBe('SUPPLIER_HAS_ORDERS');

    const empty = await createSupplier(agent);
    const allowed = await agent.delete(`/api/v1/admin/suppliers/${empty.id}`);
    expect(allowed.status).toBe(200);

    const index = supplierIds.indexOf(empty.id);
    if (index >= 0) supplierIds.splice(index, 1);
  });
});

// ── Purchase orders ────────────────────────────────────────────────────────

describe('purchase orders', () => {
  it('creates a DRAFT and computes the total from its lines', async () => {
    const agent = await signIn('super@sharkmart.test');
    const supplier = await createSupplier(agent);

    const res = await agent.post('/api/v1/admin/purchase-orders').send({
      supplierId: supplier.id,
      items: [
        { productId: await aProductId(), quantity: 3, costPricePoisha: 10_000 },
        { productId: await aProductId(), quantity: 2, costPricePoisha: 5_000 },
      ],
    });

    expect(res.status).toBe(201);
    poIds.push(res.body.data.id);
    expect(res.body.data.status).toBe('DRAFT');
    // 3 * 10,000 + 2 * 5,000 — computed server-side, not trusted from the body.
    expect(res.body.data.totalAmountPoisha).toBe(40_000);
  });

  it('refuses to receive a DRAFT', async () => {
    const agent = await signIn('super@sharkmart.test');
    const supplier = await createSupplier(agent);
    const po = await createPo(agent, supplier.id);
    const detail = await agent.get(`/api/v1/admin/purchase-orders/${po.id}`);
    const itemId = detail.body.data.items[0].id as string;

    const res = await agent
      .post(`/api/v1/admin/purchase-orders/${po.id}/receive`)
      .send({ lines: [{ itemId, receivedQuantity: 1 }] });

    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('PO_NOT_ORDERED');
  });

  it('receives in two deltas and closes the order when the last arrives', async () => {
    const agent = await signIn('super@sharkmart.test');
    const supplier = await createSupplier(agent);
    const po = await createPo(agent, supplier.id, 10);

    await agent.post(`/api/v1/admin/purchase-orders/${po.id}/order`);

    const detail = await agent.get(`/api/v1/admin/purchase-orders/${po.id}`);
    const itemId = detail.body.data.items[0].id as string;

    const partial = await agent
      .post(`/api/v1/admin/purchase-orders/${po.id}/receive`)
      .send({ lines: [{ itemId, receivedQuantity: 4 }], note: 'first half' });

    expect(partial.status).toBe(200);
    expect(partial.body.data.status).toBe('PARTIAL');
    expect(partial.body.data.items[0].receivedQuantity).toBe(4);

    const rest = await agent
      .post(`/api/v1/admin/purchase-orders/${po.id}/receive`)
      .send({ lines: [{ itemId, receivedQuantity: 6 }] });

    expect(rest.body.data.status).toBe('RECEIVED');
    expect(rest.body.data.items[0].receivedQuantity).toBe(10);
    expect(rest.body.data.receivedAt).toBeTruthy();
  });

  it('refuses an over-receipt and applies nothing', async () => {
    const agent = await signIn('super@sharkmart.test');
    const supplier = await createSupplier(agent);
    const po = await createPo(agent, supplier.id, 5);
    await agent.post(`/api/v1/admin/purchase-orders/${po.id}/order`);

    const detail = await agent.get(`/api/v1/admin/purchase-orders/${po.id}`);
    const itemId = detail.body.data.items[0].id as string;

    const res = await agent
      .post(`/api/v1/admin/purchase-orders/${po.id}/receive`)
      .send({ lines: [{ itemId, receivedQuantity: 6 }] });

    expect(res.status).toBe(422);
    expect(res.body.error.details.reason).toBe('PO_OVER_RECEIVE');

    // Nothing was written.
    const after = await agent.get(`/api/v1/admin/purchase-orders/${po.id}`);
    expect(after.body.data.items[0].receivedQuantity).toBe(0);
    expect(after.body.data.status).toBe('ORDERED');
  });

  it('cancels a draft but refuses to cancel a received order', async () => {
    const agent = await signIn('super@sharkmart.test');
    const supplier = await createSupplier(agent);

    const draft = await createPo(agent, supplier.id);
    const cancelled = await agent
      .post(`/api/v1/admin/purchase-orders/${draft.id}/cancel`)
      .send({ reason: 'supplier out of stock' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const received = await createPo(agent, supplier.id, 2);
    await agent.post(`/api/v1/admin/purchase-orders/${received.id}/order`);
    const detail = await agent.get(`/api/v1/admin/purchase-orders/${received.id}`);
    await agent
      .post(`/api/v1/admin/purchase-orders/${received.id}/receive`)
      .send({ lines: [{ itemId: detail.body.data.items[0].id, receivedQuantity: 2 }] });

    const refused = await agent
      .post(`/api/v1/admin/purchase-orders/${received.id}/cancel`)
      .send({ reason: 'changed my mind' });
    expect(refused.status).toBe(409);
  });

  it('requires a reason to cancel', async () => {
    const agent = await signIn('super@sharkmart.test');
    const supplier = await createSupplier(agent);
    const po = await createPo(agent, supplier.id);

    const res = await agent.post(`/api/v1/admin/purchase-orders/${po.id}/cancel`).send({});
    expect(res.status).toBe(422);
  });
});

// ── Permissions ────────────────────────────────────────────────────────────

describe('permissions', () => {
  it('lets INVENTORY_STAFF write and refuses MARKETING_STAFF', async () => {
    const inventory = await signIn('inventory@sharkmart.test');
    const created = await inventory.post('/api/v1/admin/suppliers').send({
      name: `Staff Supplier ${uniq()}`,
      phone: '01812345678',
    });
    expect(created.status).toBe(201);
    supplierIds.push(created.body.data.id);

    const marketing = await signIn('marketing@sharkmart.test');
    expect((await marketing.get('/api/v1/admin/suppliers')).status).toBe(403);
    expect(
      (await marketing.post('/api/v1/admin/suppliers').send({ name: 'x', phone: '01812345678' }))
        .status,
    ).toBe(403);
  });
});
