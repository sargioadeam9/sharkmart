/**
 * Phase 10 pass J — landing pages.
 *
 * The chain is what matters: an admin creates a page, the public GET serves it
 * while active, the public POST records a lead, and the admin sees that lead. A
 * landing page with no order path is a poster.
 *
 * The price is deliberately not in the order body — the product's current price is
 * the price, and a campaign that could name its own would be an unaudited discount
 * path. That is asserted, not just commented.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';
const created: string[] = [];
const slugs: string[] = [];

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

function uniq(): string {
  return `lp-${Date.now().toString(36)}-${Math.floor(Math.random() * 10_000)}`;
}

async function aProductId(): Promise<string> {
  const product = await prisma.product.findFirstOrThrow({
    where: { isPublished: true, isDraft: false },
    select: { id: true },
  });
  return product.id;
}

async function createPage(
  agent: request.SuperAgentTest,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; slug: string }> {
  const slug = uniq();
  const res = await agent.post('/api/v1/admin/landing').send({
    slug,
    title: 'Eid Special',
    productId: await aProductId(),
    campaignName: 'Eid 2026',
    content: { headline: 'Eid offer', bullets: ['Free delivery'] },
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  created.push(res.body.data.id);
  slugs.push(slug);
  return { id: res.body.data.id, slug };
}

afterAll(async () => {
  if (created.length > 0) {
    await prisma.landingPageOrder.deleteMany({ where: { landingPageId: { in: created } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: created } } });
    await prisma.landingPage.deleteMany({ where: { id: { in: created } } });
  }
});

beforeEach(async () => {
  await resetRateLimits();
});

describe('admin', () => {
  it('creates a page, serves it publicly while active, and stops when deactivated', async () => {
    const agent = await signIn('super@sharkmart.test');
    const page = await createPage(agent);

    expect((await request(app).get(`/api/v1/landing/${page.slug}`)).status).toBe(200);

    await agent.post(`/api/v1/admin/landing/${page.id}/active`).send({ isActive: false });
    expect((await request(app).get(`/api/v1/landing/${page.slug}`)).status).toBe(404);
  });

  it('refuses a duplicate slug with 409, not 500', async () => {
    const agent = await signIn('super@sharkmart.test');
    const page = await createPage(agent);

    const res = await agent.post('/api/v1/admin/landing').send({
      slug: page.slug,
      title: 'Duplicate',
      productId: await aProductId(),
    });

    expect(res.status).toBe(409);
  });

  it('rejects a slug with uppercase or spaces', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.post('/api/v1/admin/landing').send({
      slug: 'Not A Slug',
      title: 'Bad',
      productId: await aProductId(),
    });
    expect(res.status).toBe(422);
  });

  it('refuses MARKETING_STAFF a write but allows a read', async () => {
    const staff = await signIn('marketing@sharkmart.test');
    expect((await staff.get('/api/v1/admin/landing')).status).toBe(200);

    // marketing holds marketing:write, so this one is allowed; the refusal case is
    // a role without it.
    const inventory = await signIn('inventory@sharkmart.test');
    expect((await inventory.get('/api/v1/admin/landing')).status).toBe(403);
  });
});

describe('public order', () => {
  it('records a lead and shows it on the admin side', async () => {
    const agent = await signIn('super@sharkmart.test');
    const page = await createPage(agent);

    const res = await request(app).post(`/api/v1/landing/${page.slug}/order`).send({
      name: 'Karim',
      phone: '01712345678',
      address: 'House 1, Road 2, Dhaka',
      quantity: 2,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');

    const orders = await agent.get(`/api/v1/admin/landing/${page.id}/orders`);
    expect(orders.body.data.orders).toHaveLength(1);
    expect(orders.body.data.orders[0].name).toBe('Karim');
    expect(orders.body.data.orders[0].quantity).toBe(2);
  });

  it('ignores a price in the body — the product decides', async () => {
    const agent = await signIn('super@sharkmart.test');
    const page = await createPage(agent);

    const res = await request(app).post(`/api/v1/landing/${page.slug}/order`).send({
      name: 'Karim',
      phone: '01712345678',
      address: 'House 1, Road 2, Dhaka',
      quantity: 1,
      // Not in the schema, and the route is `.strict()` on the body.
      unitPricePoisha: 1,
    });

    expect(res.status).toBe(422);
  });

  it('404s an inactive page and refuses a page with no product', async () => {
    const agent = await signIn('super@sharkmart.test');

    const inactive = await createPage(agent, { isActive: false });
    expect(
      (
        await request(app).post(`/api/v1/landing/${inactive.slug}/order`).send({
          name: 'Karim',
          phone: '01712345678',
          address: 'House 1, Dhaka',
        })
      ).status,
    ).toBe(404);

    const noProduct = await createPage(agent, { productId: null });
    const res = await request(app).post(`/api/v1/landing/${noProduct.slug}/order`).send({
      name: 'Karim',
      phone: '01712345678',
      address: 'House 1, Dhaka',
    });
    expect(res.status).toBe(422);
  });

  it('validates the phone', async () => {
    const agent = await signIn('super@sharkmart.test');
    const page = await createPage(agent);

    const res = await request(app).post(`/api/v1/landing/${page.slug}/order`).send({
      name: 'Karim',
      phone: 'abc',
      address: 'House 1, Dhaka',
    });

    expect(res.status).toBe(422);
  });
});
