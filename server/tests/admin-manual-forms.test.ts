/**
 * The two endpoints behind the admin's new forms: a phone order and a staff
 * account.
 *
 * Both are mutations that reach further than they look — one moves stock and
 * writes an order every report will count, the other creates an account that can
 * sign in immediately — so both are tested against the real API and the real
 * database rather than against a mapper.
 *
 * The refusals matter as much as the successes: a delete that removes the last
 * super admin, or an order created without touching stock, would be a bug nobody
 * notices until it is expensive.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';

import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

const createdOrderIds: string[] = [];
const createdStaffIds: string[] = [];
let variantId: string | null = null;
let productId: string | null = null;
let stockBefore = 0;

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

beforeAll(async () => {
  const variant = await prisma.productVariant.findFirst({
    where: { stock: { gte: 5 }, isActive: true, product: { isPublished: true, isDraft: false } },
    select: { id: true, productId: true, stock: true },
  });

  if (!variant) throw new Error('no orderable variant in the seed');

  variantId = variant.id;
  productId = variant.productId;
  stockBefore = variant.stock;
});

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(async () => {
  /**
   * A deleted order does not give its stock back, so the units this suite sold
   * are restored explicitly. Same discipline as the POS suite: restore the
   * recorded value, do not reverse a delta.
   */
  if (variantId) {
    await prisma.productVariant.update({
      where: { id: variantId },
      data: { stock: stockBefore },
    });
  }

  if (createdOrderIds.length > 0) {
    await prisma.stockMovement.deleteMany({ where: { referenceId: { in: createdOrderIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }

  if (createdStaffIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdStaffIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdStaffIds } } });
  }
});

// ─── Manual order ──────────────────────────────────────────────────────────

describe('POST /admin/orders', () => {
  it('creates a real order that reserves stock and reaches the order list', async () => {
    const agent = await signIn('super@sharkmart.test');

    const res = await agent.post('/api/v1/admin/orders').send({
      customerName: 'Phone Buyer',
      customerPhone: '01711999888',
      address: { division: 'dhaka', district: 'dhaka', area: 'Gulshan', address: 'House 7, Road 11' },
      items: [{ productId, variantId, quantity: 2 }],
      paymentMethod: 'COD',
      deliveryMethod: 'STANDARD',
    });

    expect(res.status).toBe(201);
    createdOrderIds.push(res.body.data.id);

    // It is a guest order with the phone the staff typed.
    expect(res.body.data.orderNumber).toMatch(/^SM-/);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: res.body.data.id },
      select: {
        userId: true,
        guestPhone: true,
        currentStatus: true,
        totalAmountPoisha: true,
        items: { select: { quantity: true } },
        shippingAddress: { select: { recipientName: true } },
      },
    });

    expect(row.userId).toBeNull();
    expect(row.guestPhone).toBe('01711999888');
    expect(row.currentStatus).toBe('PENDING');
    expect(row.shippingAddress?.recipientName).toBe('Phone Buyer');
    expect(row.items[0]?.quantity).toBe(2);

    // The price is the database's, not the caller's — there is no price field
    // in the body at all.
    expect(row.totalAmountPoisha).toBeGreaterThan(0);

    // Stock moved.
    const after = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId! },
      select: { stock: true },
    });
    expect(after.stock).toBe(stockBefore - 2);

    // And the audit row says a person did it.
    const auditRow = await prisma.auditLog.findFirst({
      where: { entityId: res.body.data.id, action: 'order.manual_create' },
      select: { id: true },
    });
    expect(auditRow).not.toBeNull();
  });

  it('refuses an order with no items', async () => {
    const agent = await signIn('super@sharkmart.test');

    const res = await agent.post('/api/v1/admin/orders').send({
      customerName: 'Phone Buyer',
      customerPhone: '01711999888',
      address: { division: 'dhaka', district: 'dhaka', area: 'Gulshan', address: 'House 7' },
      items: [],
    });

    expect(res.status).toBe(422);
  });

  it('refuses an invalid phone number', async () => {
    const agent = await signIn('super@sharkmart.test');

    const res = await agent.post('/api/v1/admin/orders').send({
      customerName: 'Phone Buyer',
      customerPhone: '12345',
      address: { division: 'dhaka', district: 'dhaka', area: 'Gulshan', address: 'House 7' },
      items: [{ productId, variantId, quantity: 1 }],
    });

    expect(res.status).toBe(422);
  });
});

// ─── Staff ─────────────────────────────────────────────────────────────────

describe('POST /admin/staff', () => {
  it('creates a staff account that can sign in', async () => {
    const agent = await signIn('super@sharkmart.test');
    const email = `newstaff-${Date.now()}@sharkmart.test`;

    const res = await agent.post('/api/v1/admin/staff').send({
      name: 'New Cashier',
      email,
      role: 'ORDER_MANAGER',
      password: 'Cashier123',
    });

    expect(res.status).toBe(201);
    createdStaffIds.push(res.body.data.user.id);
    expect(res.body.data.user.role).toBe('ORDER_MANAGER');

    // The password set here works — that is the whole point of the endpoint.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: 'Cashier123' });
    expect(login.status).toBe(200);
  });

  it('refuses a duplicate email', async () => {
    const agent = await signIn('super@sharkmart.test');

    const res = await agent.post('/api/v1/admin/staff').send({
      name: 'Duplicate',
      email: 'super@sharkmart.test',
      role: 'ADMIN',
      password: 'Cashier123',
    });

    expect(res.status).toBe(409);
  });

  it('refuses a short password', async () => {
    const agent = await signIn('super@sharkmart.test');

    const res = await agent.post('/api/v1/admin/staff').send({
      name: 'Short Pass',
      email: `short-${Date.now()}@sharkmart.test`,
      role: 'ADMIN',
      password: 'abc',
    });

    expect(res.status).toBe(422);
  });

  it('refuses a role that cannot manage staff', async () => {
    // INVENTORY_STAFF has no staff:manage permission.
    const agent = await signIn('inventory@sharkmart.test');

    const res = await agent.post('/api/v1/admin/staff').send({
      name: 'Nope',
      email: `nope-${Date.now()}@sharkmart.test`,
      role: 'ADMIN',
      password: 'Cashier123',
    });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /admin/staff/:id', () => {
  it('deletes a staff account it just created', async () => {
    const agent = await signIn('super@sharkmart.test');
    const email = `deleteme-${Date.now()}@sharkmart.test`;

    const created = await agent.post('/api/v1/admin/staff').send({
      name: 'Delete Me',
      email,
      role: 'MARKETING_STAFF',
      password: 'Cashier123',
    });

    expect(created.status).toBe(201);
    const id = created.body.data.user.id;

    const res = await agent.delete(`/api/v1/admin/staff/${id}`);
    expect(res.status).toBe(200);

    const gone = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    expect(gone).toBeNull();
  });

  it('refuses to delete yourself', async () => {
    const agent = await signIn('super@sharkmart.test');

    const me = await prisma.user.findFirstOrThrow({
      where: { email: 'super@sharkmart.test' },
      select: { id: true },
    });

    const res = await agent.delete(`/api/v1/admin/staff/${me.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.details?.reason ?? res.body.error.message).toBeTruthy();
  });

  it('refuses an account that has orders, and says why', async () => {
    const agent = await signIn('super@sharkmart.test');

    // A customer with orders, not staff — the guard is about the foreign key,
    // not the role.
    const buyer = await prisma.order.findFirst({
      where: { userId: { not: null } },
      select: { userId: true },
    });

    if (!buyer?.userId) {
      // No such order in this database; nothing to prove.
      return;
    }

    const res = await agent.delete(`/api/v1/admin/staff/${buyer.userId}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/order/i);
  });
});
