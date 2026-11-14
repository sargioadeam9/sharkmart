/**
 * Phase 10 pass B — store settings.
 *
 * The gate item is not "the endpoint returns 200". It is: **does changing a
 * setting change the shop?** Before this pass the `Setting` table had nine rows
 * and no reader, so a settings screen would have been a screen that lies. The
 * last test here is the one that matters — it changes the delivery fee, places a
 * real order, and asserts the order was charged the new amount.
 *
 * Every test restores what it changed in `afterAll`, because these rows are
 * global: a suite that left `site.name` set to "Test" would quietly rename the
 * shop for every later run.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';
const CUSTOMER_PASSWORD = 'TestPass123';

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

/** Values this suite touched, restored afterwards. */
const original = new Map<string, string | null>();

async function remember(key: string): Promise<void> {
  if (original.has(key)) return;
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  original.set(key, row?.value ?? null);
}

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(async () => {
  for (const [key, value] of original) {
    if (value === null) {
      await prisma.setting.deleteMany({ where: { key } });
    } else {
      await prisma.setting.upsert({
        where: { key },
        create: { key, value, group: 'general' },
        update: { value },
      });
    }
  }
});

// ── Read ───────────────────────────────────────────────────────────────────

describe('read', () => {
  it('returns every registered key, grouped, with its default flagged', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/settings');

    expect(res.status).toBe(200);

    const groups = res.body.data.groups as Array<{
      group: string;
      items: Array<{ key: string; value: string; default: string; isDefault: boolean }>;
    }>;

    expect(groups.map((g) => g.group)).toEqual([
      'general',
      'contact',
      'commerce',
      'branding',
      'notifications',
    ]);

    const keys = groups.flatMap((g) => g.items.map((i) => i.key));
    expect(keys).toContain('site.name');
    expect(keys).toContain('delivery.standardFeePoisha');
    expect(keys).toContain('brand.nameFirst');

    /**
     * Every item carries a value, even the ones with no row.
     *
     * `typeof` rather than a length check: two notification settings default to
     * an empty string on purpose — "no admin alert address" and "no Telegram
     * chat id" are valid states, not missing ones.
     */
    expect(groups.flatMap((g) => g.items).every((i) => typeof i.value === 'string')).toBe(true);
  });

  it('refuses ORDER_MANAGER, who has no settings permission', async () => {
    const agent = await signIn('manager@sharkmart.test');
    const res = await agent.get('/api/v1/admin/settings');
    expect(res.status).toBe(403);
  });
});

// ── Write ──────────────────────────────────────────────────────────────────

describe('write', () => {
  it('saves a value, reflects it on read, and writes one audit row', async () => {
    await remember('site.tagline');
    const agent = await signIn('super@sharkmart.test');

    const res = await agent
      .patch('/api/v1/admin/settings')
      .send({ values: { 'site.tagline': 'Test Tagline' } });

    expect(res.status).toBe(200);

    const after = await agent.get('/api/v1/admin/settings');
    const tagline = (after.body.data.groups as Array<{ items: Array<{ key: string; value: string }> }>)
      .flatMap((g) => g.items)
      .find((i) => i.key === 'site.tagline');
    expect(tagline?.value).toBe('Test Tagline');

    const row = await prisma.auditLog.findFirst({
      where: { action: 'settings.update', entity: 'setting' },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    const changes = row!.changes as Record<string, { from: string; to: string }>;
    expect(changes['site.tagline']).toEqual({ from: expect.any(String), to: 'Test Tagline' });
  });

  it('rejects an unknown key instead of storing a row nobody reads', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .patch('/api/v1/admin/settings')
      .send({ values: { 'site.madeUpKey': 'x' } });

    expect(res.status).toBe(422);
    expect(await prisma.setting.count({ where: { key: 'site.madeUpKey' } })).toBe(0);
  });

  it('rejects a non-integer fee and names the field', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .patch('/api/v1/admin/settings')
      .send({ values: { 'delivery.standardFeePoisha': 'sixty' } });

    expect(res.status).toBe(422);
    expect(res.body.error.details.field).toBe('delivery.standardFeePoisha');
  });

  it('does not write an audit row when nothing changed', async () => {
    await remember('site.tagline');
    const agent = await signIn('super@sharkmart.test');

    await agent.patch('/api/v1/admin/settings').send({ values: { 'site.tagline': 'Same' } });
    const before = await prisma.auditLog.count({ where: { action: 'settings.update' } });

    await agent.patch('/api/v1/admin/settings').send({ values: { 'site.tagline': 'Same' } });
    const after = await prisma.auditLog.count({ where: { action: 'settings.update' } });

    expect(after).toBe(before);
  });

  it('refuses ORDER_MANAGER a write', async () => {
    const agent = await signIn('manager@sharkmart.test');
    const res = await agent
      .patch('/api/v1/admin/settings')
      .send({ values: { 'site.tagline': 'Nope' } });
    expect(res.status).toBe(403);
  });
});

// ── The gate: a setting must change the shop ───────────────────────────────

describe('the delivery fee reaches checkout', () => {
  it('charges the fee stored in settings, not the constant', async () => {
    await remember('delivery.standardFeePoisha');
    await remember('delivery.freeThresholdPoisha');

    const admin = await signIn('super@sharkmart.test');

    // A fee low enough to be under the free threshold, and a threshold high
    // enough that the order never qualifies for free delivery.
    const res = await admin.patch('/api/v1/admin/settings').send({
      values: {
        'delivery.standardFeePoisha': '7700',
        'delivery.freeThresholdPoisha': '99999999',
      },
    });
    expect(res.status).toBe(200);

    // A customer, a product with stock, one unit.
    const agent = request.agent(app);
    const email = `fee${Date.now()}@sharkmart.test`;
    const phone = `019${String(Date.now()).slice(-8)}`;
    const registered = await agent
      .post('/api/v1/auth/register')
      .send({ name: 'Fee Test', email, phone, password: CUSTOMER_PASSWORD });
    expect(registered.status).toBe(201);

    // Start from a variant with stock, then its product — see the note in
    // phase10a: picking the first product first degrades as the suite drains it.
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { stock: { gt: 0 }, product: { isPublished: true, isDraft: false } },
      select: { id: true, productId: true },
    });
    const product = { id: variant.productId };

    const cookies = agent.jar.getCookies({
      domain: '127.0.0.1',
      path: '/',
      secure: false,
      script: false,
    }) as unknown as Array<{ name: string; value: string }>;
    const csrf = cookies.find((c) => c.name === 'csrf_token')?.value ?? '';

    const order = await agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrf)
      .send({
        items: [{ productId: product.id, variantId: variant.id, quantity: 1 }],
        address: {
          recipientName: 'Fee Test',
          phone,
          division: 'Dhaka',
          district: 'Dhaka',
          area: 'Gulshan',
          address: 'House 1, Road 2',
        },
        paymentMethod: 'COD',
        deliveryMethod: 'STANDARD',
      });

    expect(order.status).toBe(201);
    expect(order.body.data.deliveryChargePoisha).toBe(7_700);

    // Clean up the order this test created; it is real data otherwise.
    await prisma.orderItem.deleteMany({ where: { orderId: order.body.data.id } });
    await prisma.order.deleteMany({ where: { id: order.body.data.id } });
  });
});

// ── The storefront's read ──────────────────────────────────────────────────

describe('the public endpoint', () => {
  it('serves the profile and delivery rules without a session', async () => {
    // No agent, no cookie: a guest's header has to render.
    const res = await request(app).get('/api/v1/settings');

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBeTruthy();
    expect(res.body.data.phone).toBeTruthy();
    expect(res.body.data.delivery.feePoisha).toBeGreaterThanOrEqual(0);
    expect(res.body.data.delivery.freeThresholdPoisha).toBeGreaterThanOrEqual(0);
    expect(res.headers['cache-control']).toMatch(/max-age=\d+/);
  });

  it('reflects a fee change immediately, so the cart cannot quote a stale price', async () => {
    await remember('delivery.standardFeePoisha');
    const admin = await signIn('super@sharkmart.test');

    await admin
      .patch('/api/v1/admin/settings')
      .send({ values: { 'delivery.standardFeePoisha': '4321' } });

    const res = await request(app).get('/api/v1/settings');
    expect(res.body.data.delivery.feePoisha).toBe(4_321);
  });
});
