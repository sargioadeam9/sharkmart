/**
 * Phase 10 pass A — the admin coupon API.
 *
 * Runs against the real seeded MySQL database, like every suite since Phase 6.
 * What these prove that reading the code cannot:
 *
 *   - a coupon saves with the rules checkout will later enforce
 *   - the five derived states are mutually exclusive, so the tab counts add up
 *   - a partial update is never rejected by a stored value the client did not
 *     send (the product-edit P0, checked again here because the same shape exists)
 *   - a redeemed coupon cannot be deleted, because `order.couponId` is SET NULL
 *     and the delete would silently erase the redemption history
 *   - category scoping actually rejects a cart it does not cover. Before this
 *     pass `applicableCategories` was selected and never read, so a coupon
 *     scoped to one category applied to everything.
 *
 * Every coupon this suite creates is deleted in `afterAll`, and every audit row
 * with it, so the seeded catalog is left as it was found.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';
const CUSTOMER_PASSWORD = 'TestPass123';

const createdCouponIds: string[] = [];
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

function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 10_000)}`.toUpperCase();
}

/** A valid create body: live now, one taka off, no scoping. */
function couponBody(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    code: `T${uniq()}`,
    type: 'FIXED',
    value: 5_000,
    minOrderValuePoisha: 20_000,
    usageLimit: 100,
    perUserLimit: 1,
    startDate: new Date(now - 60_000).toISOString(),
    endDate: new Date(now + 86_400_000).toISOString(),
    isActive: true,
    ...overrides,
  };
}

async function createCoupon(
  agent: request.SuperAgentTest,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; body: Record<string, unknown> }> {
  const res = await agent.post('/api/v1/admin/coupons').send(couponBody(overrides));
  if (res.status !== 201) {
    throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.data.id as string;
  createdCouponIds.push(id);
  return { id, body: res.body.data };
}

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
  if (createdCouponIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdCouponIds } } });
    await prisma.couponRedemption.deleteMany({ where: { couponId: { in: createdCouponIds } } });
    await prisma.coupon.deleteMany({ where: { id: { in: createdCouponIds } } });
  }
});

// ── Create ─────────────────────────────────────────────────────────────────

describe('create', () => {
  it('creates a live coupon and writes exactly one audit row', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id, body } = await createCoupon(agent);

    expect(body.state).toBe('live');
    expect(body.usedCount).toBe(0);

    const row = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'coupon.create' },
    });
    expect(row).not.toBeNull();
    expect(row!.entity).toBe('coupon');
  });

  it('refuses a duplicate code with 409, not 500', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { body } = await createCoupon(agent);

    const res = await agent.post('/api/v1/admin/coupons').send(couponBody({ code: body.code }));
    expect(res.status).toBe(409);
  });

  it('refuses a percentage outside 1-100', async () => {
    const agent = await signIn('super@sharkmart.test');

    const tooBig = await agent
      .post('/api/v1/admin/coupons')
      .send(couponBody({ type: 'PERCENTAGE', value: 150 }));
    expect(tooBig.status).toBe(422);

    const zero = await agent
      .post('/api/v1/admin/coupons')
      .send(couponBody({ type: 'PERCENTAGE', value: 0 }));
    expect(zero.status).toBe(422);
  });

  it('refuses an end date before the start date', async () => {
    const agent = await signIn('super@sharkmart.test');
    const now = Date.now();

    const res = await agent.post('/api/v1/admin/coupons').send(
      couponBody({
        startDate: new Date(now + 86_400_000).toISOString(),
        endDate: new Date(now).toISOString(),
      }),
    );
    expect(res.status).toBe(422);
  });
});

// ── Derived state ──────────────────────────────────────────────────────────

describe('derived state', () => {
  it('classifies live, scheduled, expired and inactive, and the counts add up', async () => {
    const agent = await signIn('super@sharkmart.test');
    const now = Date.now();

    const live = await createCoupon(agent);
    const scheduled = await createCoupon(agent, {
      startDate: new Date(now + 86_400_000).toISOString(),
      endDate: new Date(now + 172_800_000).toISOString(),
    });
    const expired = await createCoupon(agent, {
      startDate: new Date(now - 172_800_000).toISOString(),
      endDate: new Date(now - 86_400_000).toISOString(),
    });
    const inactive = await createCoupon(agent, { isActive: false });

    expect(live.body.state).toBe('live');
    expect(scheduled.body.state).toBe('scheduled');
    expect(expired.body.state).toBe('expired');
    expect(inactive.body.state).toBe('inactive');

    const counts = await agent.get('/api/v1/admin/coupons/counts');
    expect(counts.status).toBe(200);

    const data = counts.body.data as Record<string, number>;
    // Mutually exclusive: the five states partition the table.
    expect(data.live! + data.scheduled! + data.expired! + data.exhausted! + data.inactive!).toBe(
      data.all,
    );

    const liveOnly = await agent.get('/api/v1/admin/coupons?state=live&limit=100');
    expect(liveOnly.status).toBe(200);
    expect(liveOnly.body.data.items.every((row: { state: string }) => row.state === 'live')).toBe(
      true,
    );
  });
});

// ── Partial update ─────────────────────────────────────────────────────────

describe('update', () => {
  it('accepts a single-field patch on an expired coupon', async () => {
    const agent = await signIn('super@sharkmart.test');
    const now = Date.now();

    const { id } = await createCoupon(agent, {
      startDate: new Date(now - 172_800_000).toISOString(),
      endDate: new Date(now - 86_400_000).toISOString(),
    });

    // Touches no window field, so the stored dates must not be able to refuse it.
    const res = await agent.patch(`/api/v1/admin/coupons/${id}`).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
  });

  it('still refuses a window that ends before it starts', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createCoupon(agent);
    const now = Date.now();

    const res = await agent
      .patch(`/api/v1/admin/coupons/${id}`)
      .send({ endDate: new Date(now - 86_400_000).toISOString() });

    expect(res.status).toBe(422);
  });
});

// ── Delete guard ───────────────────────────────────────────────────────────

describe('delete', () => {
  it('deletes a coupon that was never redeemed', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createCoupon(agent);

    const res = await agent.delete(`/api/v1/admin/coupons/${id}`);
    expect(res.status).toBe(200);

    const gone = await prisma.coupon.findUnique({ where: { id } });
    expect(gone).toBeNull();

    // Already removed, so the afterAll cleanup must not try again.
    const index = createdCouponIds.indexOf(id);
    if (index >= 0) createdCouponIds.splice(index, 1);
  });

  it('refuses to delete a redeemed coupon and says to deactivate instead', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await createCoupon(agent);

    const user = await prisma.user.findFirstOrThrow({ where: { role: 'CUSTOMER' }, select: { id: true } });
    await prisma.couponRedemption.create({
      data: { couponId: id, userId: user.id, amountPoisha: 5_000 },
    });

    const res = await agent.delete(`/api/v1/admin/coupons/${id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('COUPON_IN_USE');

    const still = await prisma.coupon.findUnique({ where: { id } });
    expect(still).not.toBeNull();
  });
});

// ── Permissions ────────────────────────────────────────────────────────────

describe('permissions', () => {
  it('admits MARKETING_STAFF to read and write', async () => {
    const agent = await signIn('marketing@sharkmart.test');
    const list = await agent.get('/api/v1/admin/coupons');
    expect(list.status).toBe(200);

    const created = await agent.post('/api/v1/admin/coupons').send(couponBody());
    expect(created.status).toBe(201);
    createdCouponIds.push(created.body.data.id as string);
  });

  it('refuses INVENTORY_STAFF, who has no marketing permission', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    const res = await agent.get('/api/v1/admin/coupons');
    expect(res.status).toBe(403);
  });
});

// ── Scoping, end to end at checkout ────────────────────────────────────────

describe('category scoping at checkout', () => {
  it('rejects a cart whose products are outside the coupon category', async () => {
    const admin = await signIn('super@sharkmart.test');

    /**
     * Start from a variant that actually has stock, then take its product.
     *
     * The first version picked the first published product and then looked for a
     * variant with stock, which fails once repeated checkout tests have drained
     * that product — a test that degrades as the suite runs is a test that fails
     * for a reason unrelated to the code.
     */
    const seedVariant = await prisma.productVariant.findFirstOrThrow({
      where: { stock: { gt: 0 }, product: { isPublished: true, isDraft: false } },
      select: { id: true, productId: true },
    });

    const product = await prisma.product.findFirstOrThrow({
      where: { id: seedVariant.productId },
      select: { id: true, categoryId: true, basePricePoisha: true },
    });
    const otherCategory = await prisma.category.findFirstOrThrow({
      where: { id: { not: product.categoryId } },
      select: { id: true },
    });

    const coupon = await createCoupon(admin, {
      minOrderValuePoisha: 0,
      applicableCategories: [otherCategory.id],
    });

    // A customer session, because a per-user-limited coupon needs one.
    const agent = request.agent(app);
    const email = `scope${Date.now()}@sharkmart.test`;
    const registered = await agent.post('/api/v1/auth/register').send({
      name: 'Scope Test',
      email,
      phone: `018${String(Date.now()).slice(-8)}`,
      password: CUSTOMER_PASSWORD,
    });
    expect(registered.status).toBe(201);

    const variant = { id: seedVariant.id };

    const cookies = agent.jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false }) as unknown as Array<{
      name: string;
      value: string;
    }>;
    const csrf = cookies.find((cookie) => cookie.name === 'csrf_token')?.value ?? '';

    const res = await agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrf)
      .send({
        items: [{ productId: product.id, variantId: variant.id, quantity: 1 }],
        address: {
          recipientName: 'Scope Test',
          phone: `018${String(Date.now()).slice(-8)}`,
          division: 'Dhaka',
          district: 'Dhaka',
          area: 'Gulshan',
          address: 'House 1, Road 2',
        },
        paymentMethod: 'COD',
        couponCode: coupon.body.code as string,
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/does not apply/i);

    const order = await prisma.order.findFirst({ where: { couponId: coupon.id } });
    expect(order).toBeNull();
  });
});
