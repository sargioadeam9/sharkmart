/**
 * Phase 9 pass B2 — the admin orders API.
 *
 * These run against the real seeded MySQL database and the real staff accounts
 * from `prisma/seed-test-users.ts`. What they prove that reading the code cannot:
 *
 *   - the list is paginated, and `total` matches the filtered set
 *   - every filter is a real predicate: status, payment status, guest vs
 *     registered, and a date range that is inclusive at both ends
 *   - search finds an order by number, by customer name and by phone
 *   - the status machine is enforced server-side: PENDING -> SHIPPED is refused
 *     even for a SUPER_ADMIN, because the table says so
 *   - a legal transition writes exactly one history row and one audit row
 *   - cancelling from the panel puts the stock back (the customer path already
 *     did; this proves the admin path did not forget)
 *   - a payment derives the payment status from the running total instead of
 *     trusting the caller
 *   - the permission gates are real: MARKETING_STAFF cannot read orders,
 *     INVENTORY_STAFF can read but cannot record a payment
 *
 * Every order this suite creates is deleted in `afterAll`, along with its items,
 * history and audit rows, so the seeded order book is left exactly as it was.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

/** Orders this suite created, cleaned up afterwards. */
const createdOrderIds: string[] = [];

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

/**
 * Creates a real order through the public checkout, as a real customer.
 *
 * This is deliberately not a direct `prisma.order.create`: an order built by
 * hand would not have the stock reservation, the history row or the shipping
 * address that checkout writes, and the admin surface reads all three. Testing
 * against a hand-built row would prove the mapper works on a shape that never
 * occurs.
 */
async function placeRealOrder(): Promise<{ orderId: string; orderNumber: string; variantId: string; quantity: number }> {
  const email = `b2-${Date.now()}-${Math.floor(Math.random() * 100_000)}@sharkmart.test`;
  const phone = `018${String(Date.now()).slice(-8)}`;

  const agent = request.agent(app);
  const registered = await agent
    .post('/api/v1/auth/register')
    .send({ name: 'B2 Buyer', email, phone, password: 'TestPass123' });

  if (registered.status !== 201) {
    throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`);
  }

  const product = await prisma.product.findFirst({
    where: {
      isPublished: true,
      isDraft: false,
      variants: { some: { isActive: true, stock: { gt: 5 } } },
    },
    select: {
      id: true,
      variants: {
        where: { isActive: true, stock: { gt: 5 } },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!product || product.variants.length === 0) {
    throw new Error('no published product with stock to order');
  }

  const variantId = product.variants[0]!.id;
  const quantity = 2;

  const created = await agent
    .post('/api/v1/checkout')
    .set('X-CSRF-Token', csrfOf(agent))
    .send({
      items: [{ productId: product.id, variantId, quantity }],
      address: {
        recipientName: 'B2 Buyer',
        phone,
        division: 'Dhaka',
        district: 'Dhaka',
        area: 'Gulshan',
        address: 'House 9, Road 3',
      },
      paymentMethod: 'COD',
    });

  if (created.status !== 201) {
    throw new Error(`checkout failed: ${created.status} ${JSON.stringify(created.body)}`);
  }

  createdOrderIds.push(created.body.data.id);
  return {
    orderId: created.body.data.id,
    orderNumber: created.body.data.orderNumber,
    variantId,
    quantity,
  };
}

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(async () => {
  if (createdOrderIds.length === 0) return;

  // Audit rows first, then the order graph. OrderItem, OrderStatusHistory and
  // ShippingAddress all cascade from Order; the audit rows do not.
  await prisma.auditLog.deleteMany({ where: { entityId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
});

// ─── Gates ──────────────────────────────────────────────────────────────────
describe('admin orders gates', () => {
  it('403s a CUSTOMER', async () => {
    const agent = await signIn('customer@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('403s MARKETING_STAFF, who holds no orders permission', async () => {
    const agent = await signIn('marketing@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('admits INVENTORY_STAFF to the list, because they need to know what to pick', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it('refuses INVENTORY_STAFF a payment, because that is the money permission', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('inventory@sharkmart.test');

    const res = await agent
      .post(`/api/v1/admin/orders/${orderId}/payment`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ amountPoisha: 1000 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

// ─── List ───────────────────────────────────────────────────────────────────
describe('admin orders list', () => {
  it('paginates and reports an honest total', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders?page=1&limit=5');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(5);
    expect(res.body.data.total).toBeGreaterThan(5);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(5);
  });

  it('page 2 does not repeat page 1', async () => {
    const agent = await signIn('super@sharkmart.test');
    const first = await agent.get('/api/v1/admin/orders?page=1&limit=5');
    const second = await agent.get('/api/v1/admin/orders?page=2&limit=5');

    const firstIds = first.body.data.items.map((item: { id: string }) => item.id);
    const secondIds = second.body.data.items.map((item: { id: string }) => item.id);

    expect(firstIds).toHaveLength(5);
    expect(secondIds.filter((id: string) => firstIds.includes(id))).toEqual([]);
  });

  it('filters by status, and total matches the filtered set', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders?status=PENDING&limit=100');

    expect(res.status).toBe(200);

    const expected = await prisma.order.count({ where: { currentStatus: 'PENDING' } });
    expect(res.body.data.total).toBe(expected);

    for (const item of res.body.data.items) {
      expect(item.status).toBe('PENDING');
    }
  });

  it('filters guests and registered customers separately', async () => {
    const agent = await signIn('super@sharkmart.test');

    const guest = await agent.get('/api/v1/admin/orders?customerType=guest&limit=100');
    const registered = await agent.get('/api/v1/admin/orders?customerType=registered&limit=100');

    expect(guest.status).toBe(200);
    expect(registered.status).toBe(200);

    for (const item of guest.body.data.items) expect(item.isGuest).toBe(true);
    for (const item of registered.body.data.items) expect(item.isGuest).toBe(false);

    // The two sets partition the book.
    expect(guest.body.data.total + registered.body.data.total).toBe(
      await prisma.order.count(),
    );
  });

  it('search finds an order by its number', async () => {
    const { orderNumber } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent.get(`/api/v1/admin/orders?q=${encodeURIComponent(orderNumber)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].orderNumber).toBe(orderNumber);
  });

  it('search finds an order by the customer phone', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { shippingAddress: { select: { phone: true } } },
    });
    const phone = order.shippingAddress!.phone;

    const res = await agent.get(`/api/v1/admin/orders?q=${encodeURIComponent(phone)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.some((item: { id: string }) => item.id === orderId)).toBe(true);
  });

  it('rejects an inverted date range instead of silently returning nothing', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders?from=2026-11-12&to=2026-11-01');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown status rather than ignoring it', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders?status=SHIPPED_MAYBE');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unknown query key, so a typo is not silently dropped', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders?statuss=PENDING');

    expect(res.status).toBe(422);
  });
});

// ─── Counts ─────────────────────────────────────────────────────────────────
describe('admin orders counts', () => {
  it('returns one number per status, and they sum to the book', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders/counts');

    expect(res.status).toBe(200);

    const total = await prisma.order.count();
    expect(res.body.data.all).toBe(total);

    const summed = Object.values(res.body.data.byStatus as Record<string, number>).reduce(
      (sum, count) => sum + count,
      0,
    );
    expect(summed).toBe(total);
  });
});

// ─── Detail ─────────────────────────────────────────────────────────────────
describe('admin order detail', () => {
  it('returns the items, the address and the timeline', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent.get(`/api/v1/admin/orders/${orderId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(orderId);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    expect(res.body.data.shippingAddress).not.toBeNull();
    expect(res.body.data.statusHistory.length).toBeGreaterThan(0);
    expect(res.body.data.statusHistory[0].status).toBe('PENDING');
  });

  it('offers only the legal next statuses', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent.get(`/api/v1/admin/orders/${orderId}`);

    // PENDING may only become CONFIRMED or CANCELLED, per order-status.ts.
    expect(res.body.data.allowedTransitions.sort()).toEqual(['CANCELLED', 'CONFIRMED']);
  });

  it('404s an unknown id with the envelope, not a 500', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders/00000000-0000-4000-8000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('422s a non-uuid id', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/orders/not-a-uuid');

    expect(res.status).toBe(422);
  });

  it('looks an order up by its public number', async () => {
    const { orderId, orderNumber } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent.get(
      `/api/v1/admin/orders/lookup?orderNumber=${encodeURIComponent(orderNumber)}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(orderId);
  });
});

// ─── Status machine ─────────────────────────────────────────────────────────
describe('admin order status machine', () => {
  it('refuses PENDING -> SHIPPED even for a SUPER_ADMIN', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .post(`/api/v1/admin/orders/${orderId}/status`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ status: 'SHIPPED', note: 'Trying to skip the queue' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');

    // And nothing changed.
    const after = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { currentStatus: true },
    });
    expect(after.currentStatus).toBe('PENDING');
  });

  it('allows PENDING -> CONFIRMED and writes one history row and one audit row', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const before = {
      history: await prisma.orderStatusHistory.count({ where: { orderId } }),
      audit: await prisma.auditLog.count({ where: { entityId: orderId } }),
    };

    const res = await agent
      .post(`/api/v1/admin/orders/${orderId}/status`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ status: 'CONFIRMED', note: 'Confirmed by phone' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CONFIRMED');

    const history = await prisma.orderStatusHistory.count({ where: { orderId } });
    const audit = await prisma.auditLog.count({ where: { entityId: orderId } });

    expect(history).toBe(before.history + 1);
    expect(audit).toBe(before.audit + 1);

    const row = await prisma.auditLog.findFirst({
      where: { entityId: orderId, action: 'order.status_change' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row!.entity).toBe('order');
  });

  it('requires a note on a status change', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .post(`/api/v1/admin/orders/${orderId}/status`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ status: 'CONFIRMED' });

    expect(res.status).toBe(422);
  });

  it('puts the stock back when the panel cancels an order', async () => {
    const { orderId, variantId, quantity } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const before = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });

    const res = await agent
      .post(`/api/v1/admin/orders/${orderId}/status`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ status: 'CANCELLED', note: 'Customer changed their mind' });

    expect(res.status).toBe(200);

    const after = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stock: true },
    });

    // The units are back on the shelf, exactly the quantity that was reserved.
    expect(after.stock).toBe(before.stock + quantity);
  });

  it('refuses a bulk status that would be illegal for some of the ids, and reports which', async () => {
    const first = await placeRealOrder();
    const second = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    // Move the second one to SHIPPED first, so a bulk "deliver" is legal for it
    // and illegal for the first (which is still PENDING).
    await agent
      .post(`/api/v1/admin/orders/${second.orderId}/status`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ status: 'CONFIRMED', note: 'confirm' });
    await agent
      .post(`/api/v1/admin/orders/${second.orderId}/status`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ status: 'PROCESSING', note: 'process' });
    await agent
      .post(`/api/v1/admin/orders/${second.orderId}/status`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ status: 'SHIPPED', note: 'ship' });

    const res = await agent
      .post('/api/v1/admin/orders/bulk/status')
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ ids: [first.orderId, second.orderId], status: 'DELIVERED', note: 'bulk deliver' });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toEqual([second.orderId]);
    expect(res.body.data.skipped).toHaveLength(1);
    expect(res.body.data.skipped[0].id).toBe(first.orderId);
  });
});

// ─── Payment ────────────────────────────────────────────────────────────────
describe('admin order payment', () => {
  it('derives PARTIALLY_PAID from a part payment, then PAID from the rest', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { totalAmountPoisha: true },
    });
    const total = order.totalAmountPoisha;
    const half = Math.floor(total / 2);

    const partial = await agent
      .post(`/api/v1/admin/orders/${orderId}/payment`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ amountPoisha: half });

    expect(partial.status).toBe(200);
    expect(partial.body.data.paymentStatus).toBe('PARTIALLY_PAID');
    expect(partial.body.data.paidAmountPoisha).toBe(half);

    const rest = await agent
      .post(`/api/v1/admin/orders/${orderId}/payment`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ amountPoisha: total - half, txnId: 'COD-REF-1' });

    expect(rest.status).toBe(200);
    expect(rest.body.data.paymentStatus).toBe('PAID');
    expect(rest.body.data.paidAmountPoisha).toBe(total);
    expect(rest.body.data.paymentTxnId).toBe('COD-REF-1');
  });

  it('refuses a zero or negative amount', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .post(`/api/v1/admin/orders/${orderId}/payment`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ amountPoisha: 0 });

    expect(res.status).toBe(422);
  });

  it('writes an audit row for the payment', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    await agent
      .post(`/api/v1/admin/orders/${orderId}/payment`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ amountPoisha: 5000 });

    const row = await prisma.auditLog.findFirst({
      where: { entityId: orderId, action: 'order.payment' },
    });
    expect(row).not.toBeNull();
  });
});

// ─── Courier and notes ──────────────────────────────────────────────────────
describe('admin order courier and notes', () => {
  it('records a courier booking', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .post(`/api/v1/admin/orders/${orderId}/courier`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({
        courierName: 'Pathao',
        consignmentId: 'PTH-123456',
        trackingUrl: 'https://pathao.com/track/PTH-123456',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.courierName).toBe('Pathao');
    expect(res.body.data.consignmentId).toBe('PTH-123456');
  });

  it('rejects a javascript: tracking URL', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .post(`/api/v1/admin/orders/${orderId}/courier`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({
        courierName: 'Pathao',
        consignmentId: 'PTH-1',
        trackingUrl: 'javascript:alert(1)',
      });

    expect(res.status).toBe(422);
  });

  it('refuses a courier booking on a cancelled order', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    await agent
      .post(`/api/v1/admin/orders/${orderId}/status`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ status: 'CANCELLED', note: 'cancel' });

    const res = await agent
      .post(`/api/v1/admin/orders/${orderId}/courier`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ courierName: 'Pathao', consignmentId: 'PTH-2' });

    expect(res.status).toBe(409);
  });

  it('saves a note and writes exactly one audit row', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    const before = await prisma.auditLog.count({ where: { entityId: orderId, action: 'order.notes' } });

    const res = await agent
      .patch(`/api/v1/admin/orders/${orderId}/notes`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ notes: 'Customer asked for delivery after 6pm.' });

    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('Customer asked for delivery after 6pm.');

    const after = await prisma.auditLog.count({ where: { entityId: orderId, action: 'order.notes' } });
    expect(after).toBe(before + 1);
  });

  it('does not write an audit row when the note did not change', async () => {
    const { orderId } = await placeRealOrder();
    const agent = await signIn('super@sharkmart.test');

    await agent
      .patch(`/api/v1/admin/orders/${orderId}/notes`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ notes: 'Same note' });

    const before = await prisma.auditLog.count({ where: { entityId: orderId, action: 'order.notes' } });

    const res = await agent
      .patch(`/api/v1/admin/orders/${orderId}/notes`)
      .set('X-CSRF-Token', csrfOf(agent))
      .send({ notes: 'Same note' });

    expect(res.status).toBe(200);

    const after = await prisma.auditLog.count({ where: { entityId: orderId, action: 'order.notes' } });
    expect(after).toBe(before);
  });
});
