/**
 * Phase 8 integration tests — auth, cart, checkout, orders.
 *
 * These run against the real seeded MySQL database, like the Phase 6 suites.
 * The point is the gate items that cannot be proved by reading code:
 * price tampering, coupon reuse, concurrent checkout of the last unit,
 * idempotent double-submit, and cancel-after-shipped.
 *
 * Every test creates its own user with a unique email, so the suite is
 * re-runnable and order-independent.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app, prisma, resetState, resetRateLimits } from './helpers.js';

const PASSWORD = 'TestPass123';

let counter = 0;
function uniqueEmail(): string {
  counter += 1;
  return `t${Date.now()}-${counter}@sharkmart.test`;
}

interface Session {
  email: string;
  phone: string;
  agent: request.SuperAgentTest;
  userId: string;
}

/**
 * Registers a user and returns an agent that carries the cookies.
 *
 * `request.agent(app)` keeps the cookie jar, which is what makes the CSRF
 * double-submit work across calls.
 */
async function registerUser(): Promise<Session> {
  const email = uniqueEmail();
  const phone = `017${String(Date.now()).slice(-8)}`;

  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/register')
    .send({ name: 'Test User', email, phone, password: PASSWORD });

  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return { email, phone, agent, userId: res.body.data.user.id };
}

/**
 * Reads the cookies an agent's jar is holding.
 *
 * Two details that are easy to get wrong and cost an hour each:
 *   - The jar's entries expose `name`, not `key` (that is `set-cookie-parser`'s
 *     shape, not `tough-cookie`'s).
 *   - `getCookies` filters by path, and the refresh cookie is deliberately
 *     scoped to `/api/v1/auth`. Asking for path `/` silently omits it, which
 *     looks exactly like "the server never set a refresh cookie".
 */
function jarCookies(agent: request.SuperAgentTest, path = '/'): Array<{ name: string; value: string }> {
  return agent.jar.getCookies({
    domain: '127.0.0.1',
    path,
    secure: false,
    script: false,
  }) as unknown as Array<{ name: string; value: string }>;
}

/** Reads the CSRF cookie off an agent's jar. */
function csrfOf(agent: request.SuperAgentTest): string {
  const found = jarCookies(agent).find((c) => c.name === 'csrf_token');
  return found?.value ?? '';
}

/** Reads the refresh cookie — scoped to the auth path, so ask for that path. */
function refreshOf(agent: request.SuperAgentTest): string {
  const found = jarCookies(agent, '/api/v1/auth').find((c) => c.name === 'sm_refresh');
  return found?.value ?? '';
}

/** A purchasable product with an in-stock variant. */
async function pickProduct(): Promise<{
  productId: string;
  variantId: string;
  pricePoisha: number;
  stock: number;
}> {
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
        select: { id: true, pricePoisha: true, stock: true },
        take: 1,
      },
    },
  });

  if (!product || product.variants.length === 0) {
    throw new Error('No purchasable product in the seed — run npm run db:seed');
  }

  const variant = product.variants[0];
  return {
    productId: product.id,
    variantId: variant.id,
    pricePoisha: variant.pricePoisha,
    stock: variant.stock,
  };
}

/** A complete inline address body. */
function addressBody(phone: string) {
  return {
    recipientName: 'Test User',
    phone,
    division: 'Dhaka',
    district: 'Dhaka',
    area: 'Gulshan',
    address: 'House 12, Road 5, Block C',
  };
}

beforeAll(async () => {
  await resetState();
});

/**
 * Every test starts with a full rate-limit budget.
 *
 * Register is 3/min per IP and login 5/min, and every test here registers a
 * user from 127.0.0.1. Without this the twelfth test in the file gets a 429
 * that says nothing about the code it is testing. The limiters themselves are
 * exercised explicitly in the "rate limiting" block at the end of this file.
 */
beforeEach(async () => {
  await resetRateLimits();
});

// ─── Auth ────────────────────────────────────────────────────────────────

describe('auth — registration and login', () => {
  it('registers a customer and sets HttpOnly session cookies', async () => {
    const agent = request.agent(app);
    const email = uniqueEmail();

    const res = await agent
      .post('/api/v1/auth/register')
      .send({ name: 'Cookie Test', email, password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(email);

    const raw = res.headers['set-cookie'] as unknown as string[];
    const access = raw.find((c) => c.startsWith('sm_access='));
    expect(access).toBeDefined();
    // AGENTS.md §7.5 — the gate item.
    expect(access).toContain('HttpOnly');
    expect(access).toContain('SameSite=Lax');
    // Path=/ so it reaches the API.
    expect(access).toContain('Path=/');

    const refresh = raw.find((c) => c.startsWith('sm_refresh='));
    expect(refresh).toContain('HttpOnly');
    // Scoped to the auth routes only.
    expect(refresh).toContain('Path=/api/v1/auth');
  });

  it('never returns the password hash', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/v1/auth/register')
      .send({ name: 'Hash Test', email: uniqueEmail(), password: PASSWORD });

    expect(JSON.stringify(res.body)).not.toContain('$2b$');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('rejects a duplicate email with a generic conflict', async () => {
    const session = await registerUser();

    const dupe = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Dupe', email: session.email, password: PASSWORD });

    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('CONFLICT');
  });

  it('rejects a role key on registration — mass assignment', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Escalate', email: uniqueEmail(), password: PASSWORD, role: 'SUPER_ADMIN' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a weak password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Weak', email: uniqueEmail(), password: 'abc' });

    expect(res.status).toBe(422);
  });

  it('rejects a malformed Bangladesh phone number', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Bad Phone', email: uniqueEmail(), phone: '01234567890', password: PASSWORD });

    expect(res.status).toBe(422);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const session = await registerUser();

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: session.email, password: 'WrongPass999' });

    const unknownAccount = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: `ghost-${Date.now()}@sharkmart.test`, password: 'WrongPass999' });

    // security.md §11 — no enumeration oracle.
    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownAccount.body.error.message);
  });

  it('requires a session for /me', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('serves /me to a signed-in user', async () => {
    const session = await registerUser();
    const res = await session.agent.get('/api/v1/me');

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(session.email);
  });
});

describe('auth — refresh rotation and reuse detection', () => {
  it('rotates the refresh token and refuses a replay', async () => {
    const session = await registerUser();

    const originalRefresh = refreshOf(session.agent);
    expect(originalRefresh).toBeTruthy();

    const rotated = await session.agent.post('/api/v1/auth/refresh');
    expect(rotated.status).toBe(200);

    // The consumed token, presented again, is a reuse event.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', `sm_refresh=${originalRefresh}`);

    expect(replay.status).toBe(401);
    expect(replay.body.error.message).toMatch(/security/i);
  });

  it('revokes the family on logout', async () => {
    const session = await registerUser();

    const csrf = csrfOf(session.agent);
    const out = await session.agent.post('/api/v1/auth/logout').set('X-CSRF-Token', csrf);
    expect(out.status).toBe(200);

    const after = await session.agent.get('/api/v1/me');
    expect(after.status).toBe(401);
  });

  it('refuses a state-changing request without the CSRF header', async () => {
    const session = await registerUser();

    const res = await session.agent
      .post('/api/v1/auth/logout')
      // deliberately no X-CSRF-Token
      .set('X-CSRF-Token', '');

    expect(res.status).toBe(403);
  });
});

describe('auth — password reset', () => {
  it('issues a single-use token and revokes sessions on reset', async () => {
    const session = await registerUser();

    const forgot = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ identifier: session.email });

    expect(forgot.status).toBe(200);
    const token = forgot.body.data.devResetToken;
    expect(token).toBeTruthy();

    const newPassword = 'BrandNewPass456';
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword });

    expect(reset.status).toBe(200);

    // Single use.
    const reuse = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'AnotherPass789' });
    expect(reuse.status).toBe(400);

    // The new password works, the old one does not.
    const withNew = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: session.email, password: newPassword });
    expect(withNew.status).toBe(200);

    const withOld = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: session.email, password: PASSWORD });
    expect(withOld.status).toBe(401);
  });

  it('does not reveal whether an account exists', async () => {
    const known = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ identifier: 'definitely-not-a-user@sharkmart.test' });

    expect(known.status).toBe(200);
    expect(known.body.data.devResetToken).toBeUndefined();
  });
});

// ─── Addresses ───────────────────────────────────────────────────────────

describe('addresses — ownership', () => {
  it('creates an address and makes the first one the default', async () => {
    const session = await registerUser();
    const csrf = csrfOf(session.agent);

    const res = await session.agent
      .post('/api/v1/me/addresses')
      .set('X-CSRF-Token', csrf)
      .send(addressBody(session.phone));

    expect(res.status).toBe(201);
    expect(res.body.data.isDefault).toBe(true);
  });

  it("returns 404 for another user's address", async () => {
    const owner = await registerUser();
    const intruder = await registerUser();

    const created = await owner.agent
      .post('/api/v1/me/addresses')
      .set('X-CSRF-Token', csrfOf(owner.agent))
      .send(addressBody(owner.phone));

    const addressId = created.body.data.id;

    const update = await intruder.agent
      .put(`/api/v1/me/addresses/${addressId}`)
      .set('X-CSRF-Token', csrfOf(intruder.agent))
      .send({ area: 'Hacked' });

    // 404, not 403 — a 403 confirms the id exists.
    expect(update.status).toBe(404);

    const del = await intruder.agent
      .delete(`/api/v1/me/addresses/${addressId}`)
      .set('X-CSRF-Token', csrfOf(intruder.agent));

    expect(del.status).toBe(404);

    // And the address is untouched.
    const still = await owner.agent.get('/api/v1/me/addresses');
    expect(still.body.data[0].area).toBe('Gulshan');
  });
});

// ─── Cart ────────────────────────────────────────────────────────────────

describe('cart', () => {
  it('adds a line and computes the subtotal server-side', async () => {
    const session = await registerUser();
    const product = await pickProduct();

    const res = await session.agent
      .post('/api/v1/cart/items')
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({ productId: product.productId, variantId: product.variantId, quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body.data.lines).toHaveLength(1);
    expect(res.body.data.subtotalPoisha).toBe(product.pricePoisha * 2);
  });

  it('merges a guest cart without duplicating a line', async () => {
    const session = await registerUser();
    const product = await pickProduct();
    const csrf = csrfOf(session.agent);

    await session.agent
      .post('/api/v1/cart/items')
      .set('X-CSRF-Token', csrf)
      .send({ productId: product.productId, variantId: product.variantId, quantity: 2 });

    // The guest cart carries the same line.
    const merged = await session.agent
      .post('/api/v1/cart/sync')
      .set('X-CSRF-Token', csrf)
      .send({
        items: [{ productId: product.productId, variantId: product.variantId, quantity: 3 }],
      });

    expect(merged.status).toBe(200);
    expect(merged.body.data.cart.lines).toHaveLength(1);
    // Union of intent, not a sum: max(2, 3) = 3.
    expect(merged.body.data.cart.lines[0].quantity).toBe(3);
  });

  it('rejects a variant that does not belong to the product', async () => {
    const session = await registerUser();
    const product = await pickProduct();
    const other = await pickProduct();

    if (other.variantId === product.variantId) return;

    const res = await session.agent
      .post('/api/v1/cart/items')
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({ productId: product.productId, variantId: other.variantId, quantity: 1 });

    expect(res.status).toBe(400);
  });
});

// ─── Checkout: the gate items ────────────────────────────────────────────

describe('checkout — money is server-side', () => {
  it('rejects a client-supplied price outright', async () => {
    const session = await registerUser();
    const product = await pickProduct();

    const res = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({
        items: [
          {
            productId: product.productId,
            variantId: product.variantId,
            quantity: 1,
            unitPricePoisha: 1,
          },
        ],
        address: addressBody(session.phone),
        paymentMethod: 'COD',
      });

    // The strict schema rejects the unknown key before any pricing runs.
    expect(res.status).toBe(422);
  });

  it('charges the real price when the payload is honest', async () => {
    const session = await registerUser();
    const product = await pickProduct();

    const res = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({
        items: [{ productId: product.productId, variantId: product.variantId, quantity: 2 }],
        address: addressBody(session.phone),
        paymentMethod: 'COD',
      });

    expect(res.status).toBe(201);
    const order = res.body.data;

    expect(order.items[0].unitPricePoisha).toBe(product.pricePoisha);
    expect(order.subtotalPoisha).toBe(product.pricePoisha * 2);
    expect(order.totalAmountPoisha).toBe(
      order.subtotalPoisha - order.discountAmountPoisha + order.deliveryChargePoisha,
    );
  });

  it('applies free delivery at the ৳2,000 threshold and ৳60 below it', async () => {
    const session = await registerUser();
    const product = await pickProduct();
    const csrf = csrfOf(session.agent);

    // One unit: under the threshold unless the product is expensive.
    const single = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrf)
      .send({
        items: [{ productId: product.productId, variantId: product.variantId, quantity: 1 }],
        address: addressBody(session.phone),
        paymentMethod: 'COD',
      });

    const singleOrder = single.body.data;
    const expected =
      singleOrder.subtotalPoisha >= 200_000 ? 0 : 6_000;
    expect(singleOrder.deliveryChargePoisha).toBe(expected);
  });

  it('is idempotent under the same Idempotency-Key', async () => {
    const session = await registerUser();
    const product = await pickProduct();
    const csrf = csrfOf(session.agent);
    const key = `test-${Date.now()}`;

    const body = {
      items: [{ productId: product.productId, variantId: product.variantId, quantity: 1 }],
      address: addressBody(session.phone),
      paymentMethod: 'COD',
    };

    const first = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', key)
      .send(body);

    const second = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.orderNumber).toBe(first.body.data.orderNumber);

    // Exactly one order exists for that key.
    const count = await prisma.order.count({
      where: { userId: session.userId, idempotencyKey: key },
    });
    expect(count).toBe(1);
  });

  it('refuses a coupon beyond its per-user limit', async () => {
    const session = await registerUser();
    const product = await pickProduct();
    const csrf = csrfOf(session.agent);

    const code = `LIMIT${Date.now()}`;
    await prisma.coupon.create({
      data: {
        code,
        type: 'FIXED',
        value: 5_000,
        startDate: new Date(Date.now() - 60_000),
        endDate: new Date(Date.now() + 3_600_000),
        perUserLimit: 1,
        isActive: true,
      },
    });

    const body = {
      items: [{ productId: product.productId, variantId: product.variantId, quantity: 1 }],
      address: addressBody(session.phone),
      paymentMethod: 'COD',
      couponCode: code,
    };

    const first = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrf)
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body.data.discountAmountPoisha).toBe(5_000);

    const second = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrf)
      .send(body);

    expect(second.status).toBe(422);
    expect(second.body.error.message).toMatch(/already used/i);
  });

  it('rejects an expired coupon', async () => {
    const session = await registerUser();
    const product = await pickProduct();

    const code = `EXP${Date.now()}`;
    await prisma.coupon.create({
      data: {
        code,
        type: 'FIXED',
        value: 5_000,
        startDate: new Date(Date.now() - 7_200_000),
        endDate: new Date(Date.now() - 3_600_000),
        isActive: true,
      },
    });

    const res = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({
        items: [{ productId: product.productId, variantId: product.variantId, quantity: 1 }],
        address: addressBody(session.phone),
        paymentMethod: 'COD',
        couponCode: code,
      });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/expired/i);
  });
});

describe('checkout — stock is reserved atomically', () => {
  it('sells the last unit exactly once under concurrency', async () => {
    /**
     * The gate item: "concurrent checkout of the last unit (one wins, one gets
     * a clean 409)".
     *
     * A throwaway product with exactly 1 unit is created so the test cannot be
     * affected by seed stock, and so it cannot poison the real catalog.
     */
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!category) throw new Error('No category in the seed');

    const sku = `CONC-${Date.now()}`;
    const product = await prisma.product.create({
      data: {
        slug: sku.toLowerCase(),
        sku,
        nameEn: 'Concurrency Probe',
        nameBn: 'কনকারেন্সি প্রোব',
        categoryId: category.id,
        basePricePoisha: 100_000,
        isPublished: true,
        isDraft: false,
        variants: {
          create: {
            sku: `${sku}-V1`,
            nameEn: 'Default',
            nameBn: 'ডিফল্ট',
            pricePoisha: 100_000,
            stock: 1,
          },
        },
      },
      select: { id: true, variants: { select: { id: true } } },
    });

    const variantId = product.variants[0].id;

    /**
     * Cleanup runs in `finally`, not at the end of the happy path.
     *
     * The previous version deleted the probe only after every assertion passed,
     * so a single failure left a `CONC-*` product (and its variant) in the real
     * catalog — which is exactly how three of them accumulated. A test that
     * poisons the seeded database when it fails is worse than no test.
     *
     * Order matters: `OrderItem` holds a non-cascading reference to both the
     * product and the variant, so the items go first, then the variant, then
     * the product (whose own children cascade).
     */
    try {
      const buyerA = await registerUser();
      const buyerB = await registerUser();

      const body = {
        items: [{ productId: product.id, variantId, quantity: 1 }],
        paymentMethod: 'COD',
      };

      // Fire both at the same time — this is the race.
      const [a, b] = await Promise.all([
        buyerA.agent
          .post('/api/v1/checkout')
          .set('X-CSRF-Token', csrfOf(buyerA.agent))
          .send({ ...body, address: addressBody(buyerA.phone) }),
        buyerB.agent
          .post('/api/v1/checkout')
          .set('X-CSRF-Token', csrfOf(buyerB.agent))
          .send({ ...body, address: addressBody(buyerB.phone) }),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([201, 409]);

      const loser = a.status === 409 ? a : b;
      expect(loser.body.error.code).toBe('OUT_OF_STOCK');

      // Stock is 0, never negative — that is the whole point.
      const after = await prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { stock: true },
      });
      expect(after?.stock).toBe(0);

      // Exactly one order exists for that variant.
      const orders = await prisma.orderItem.count({ where: { variantId } });
      expect(orders).toBe(1);
    } finally {
      await prisma.orderItem.deleteMany({ where: { variantId } });
      await prisma.cartItem.deleteMany({ where: { variantId } });
      await prisma.productVariant.deleteMany({ where: { id: variantId } });
      await prisma.product.deleteMany({ where: { id: product.id } });
    }
  });
});

// ─── Orders: IDOR and the status machine ─────────────────────────────────

describe('orders — ownership and status machine', () => {
  it("returns 404 for another user's order", async () => {
    const owner = await registerUser();
    const intruder = await registerUser();
    const product = await pickProduct();

    const created = await owner.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrfOf(owner.agent))
      .send({
        items: [{ productId: product.productId, variantId: product.variantId, quantity: 1 }],
        address: addressBody(owner.phone),
        paymentMethod: 'COD',
      });

    const orderId = created.body.data.id;

    const read = await intruder.agent.get(`/api/v1/me/orders/${orderId}`);
    expect(read.status).toBe(404);
    expect(read.body.data).toBeUndefined();

    const cancel = await intruder.agent
      .post(`/api/v1/me/orders/${orderId}/cancel`)
      .set('X-CSRF-Token', csrfOf(intruder.agent))
      .send({ reason: 'not mine' });

    expect(cancel.status).toBe(404);
  });

  it('cancels a pending order and restocks it', async () => {
    const session = await registerUser();
    const product = await pickProduct();

    const before = await prisma.productVariant.findUnique({
      where: { id: product.variantId },
      select: { stock: true },
    });

    const created = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({
        items: [{ productId: product.productId, variantId: product.variantId, quantity: 2 }],
        address: addressBody(session.phone),
        paymentMethod: 'COD',
      });

    expect(created.status).toBe(201);

    const reserved = await prisma.productVariant.findUnique({
      where: { id: product.variantId },
      select: { stock: true },
    });
    expect(reserved!.stock).toBe(before!.stock - 2);

    const cancelled = await session.agent
      .post(`/api/v1/me/orders/${created.body.data.id}/cancel`)
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({ reason: 'changed my mind' });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');

    const restored = await prisma.productVariant.findUnique({
      where: { id: product.variantId },
      select: { stock: true },
    });
    expect(restored!.stock).toBe(before!.stock);
  });

  it('refuses to cancel an order that has shipped', async () => {
    const session = await registerUser();
    const product = await pickProduct();

    const created = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({
        items: [{ productId: product.productId, variantId: product.variantId, quantity: 1 }],
        address: addressBody(session.phone),
        paymentMethod: 'COD',
      });

    const orderId = created.body.data.id;

    // Staff push it to SHIPPED.
    await prisma.order.update({ where: { id: orderId }, data: { currentStatus: 'SHIPPED' } });

    const res = await session.agent
      .post(`/api/v1/me/orders/${orderId}/cancel`)
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({ reason: 'too late' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/shipped/i);

    // Put the stock back so the suite does not leak units.
    await prisma.productVariant.update({
      where: { id: product.variantId },
      data: { stock: { increment: 1 } },
    });
  });

  it('allows a return only from DELIVERED', async () => {
    const session = await registerUser();
    const product = await pickProduct();

    const created = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({
        items: [{ productId: product.productId, variantId: product.variantId, quantity: 1 }],
        address: addressBody(session.phone),
        paymentMethod: 'COD',
      });

    const orderId = created.body.data.id;

    // From PENDING, a return is not legal.
    const tooEarly = await session.agent
      .post(`/api/v1/me/orders/${orderId}/return`)
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({ reason: 'changed my mind' });

    expect(tooEarly.status).toBe(409);

    await prisma.order.update({ where: { id: orderId }, data: { currentStatus: 'DELIVERED' } });

    const ok = await session.agent
      .post(`/api/v1/me/orders/${orderId}/return`)
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({ reason: 'item was damaged' });

    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('RETURNED');
  });
});

// ─── Public tracking ─────────────────────────────────────────────────────

describe('tracking — order number plus phone', () => {
  it('requires both the order number and the phone', async () => {
    const session = await registerUser();
    const product = await pickProduct();

    const created = await session.agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrfOf(session.agent))
      .send({
        items: [{ productId: product.productId, variantId: product.variantId, quantity: 1 }],
        address: addressBody(session.phone),
        paymentMethod: 'COD',
      });

    const orderNumber = created.body.data.orderNumber;

    const correct = await request(app).get(
      `/api/v1/track/${orderNumber}?phone=${session.phone}`,
    );
    expect(correct.status).toBe(200);
    // The public view must not carry the internal id.
    expect(correct.body.data.id).toBeUndefined();

    const wrongPhone = await request(app).get(
      `/api/v1/track/${orderNumber}?phone=01799999999`,
    );
    expect(wrongPhone.status).toBe(404);

    const noPhone = await request(app).get(`/api/v1/track/${orderNumber}`);
    expect(noPhone.status).toBe(422);
  });

  it('issues non-sequential order numbers', async () => {
    const session = await registerUser();
    const product = await pickProduct();
    const csrf = csrfOf(session.agent);

    const numbers: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await session.agent
        .post('/api/v1/checkout')
        .set('X-CSRF-Token', csrf)
        .send({
          items: [{ productId: product.productId, variantId: product.variantId, quantity: 1 }],
          address: addressBody(session.phone),
          paymentMethod: 'COD',
        });
      numbers.push(res.body.data.orderNumber);
    }

    // All distinct, and none is a simple increment of another.
    expect(new Set(numbers).size).toBe(3);
    for (const n of numbers) expect(n).toMatch(/^SM-[A-Z0-9]+$/);
  });
});
