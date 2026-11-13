/**
 * Phase 10 pass F — reports.
 *
 * The assertions compare the endpoint against the database directly rather than
 * against a hard-coded number: seeded data changes, and a test that pins 639
 * orders is a test that breaks for the wrong reason.
 *
 * What it pins instead is the *definition*: revenue excludes cancelled and
 * returned orders, the average is revenue divided by that count, and the CSV has
 * one row per order plus a header.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';
const FROM = '2026-01-01';
const TO = '2026-12-31';

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

beforeEach(async () => {
  await resetRateLimits();
});

describe('sales report', () => {
  it('matches the database for the same range', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get(`/api/v1/admin/reports?from=${FROM}&to=${TO}`);

    expect(res.status).toBe(200);

    const agg = await prisma.order.aggregate({
      where: {
        createdAt: { gte: new Date(`${FROM}T00:00:00.000Z`), lt: new Date('2027-01-01T00:00:00.000Z') },
        currentStatus: { notIn: ['CANCELLED', 'RETURNED'] },
      },
      _count: { _all: true },
      _sum: { totalAmountPoisha: true },
    });

    expect(res.body.data.summary.orders).toBe(agg._count._all);
    expect(res.body.data.summary.revenuePoisha).toBe(agg._sum.totalAmountPoisha ?? 0);
  });

  it('excludes cancelled and returned orders from revenue', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get(`/api/v1/admin/reports?from=${FROM}&to=${TO}`);

    const excluded = await prisma.order.aggregate({
      where: {
        createdAt: { gte: new Date(`${FROM}T00:00:00.000Z`), lt: new Date('2027-01-01T00:00:00.000Z') },
        currentStatus: { in: ['CANCELLED', 'RETURNED'] },
      },
      _count: { _all: true },
      _sum: { totalAmountPoisha: true },
    });

    const all = await prisma.order.aggregate({
      where: {
        createdAt: { gte: new Date(`${FROM}T00:00:00.000Z`), lt: new Date('2027-01-01T00:00:00.000Z') },
      },
      _count: { _all: true },
      _sum: { totalAmountPoisha: true },
    });

    expect(res.body.data.summary.orders).toBe(all._count._all - excluded._count._all);
    expect(res.body.data.summary.revenuePoisha).toBe(
      (all._sum.totalAmountPoisha ?? 0) - (excluded._sum.totalAmountPoisha ?? 0),
    );
  });

  it('reports an average that divides revenue by orders', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get(`/api/v1/admin/reports?from=${FROM}&to=${TO}`);

    const { orders, revenuePoisha, averageOrderPoisha } = res.body.data.summary;
    expect(averageOrderPoisha).toBe(orders === 0 ? 0 : Math.round(revenuePoisha / orders));
  });

  it('returns empty series and zeroed totals for a range with no orders', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/reports?from=2020-01-01&to=2020-01-02');

    expect(res.status).toBe(200);
    expect(res.body.data.summary.orders).toBe(0);
    expect(res.body.data.summary.revenuePoisha).toBe(0);
    expect(res.body.data.summary.averageOrderPoisha).toBe(0);
    expect(res.body.data.series).toEqual([]);
  });

  it('refuses INVENTORY_STAFF, who has no reports permission', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    const res = await agent.get(`/api/v1/admin/reports?from=${FROM}&to=${TO}`);
    expect(res.status).toBe(403);
  });
});

describe('csv export', () => {
  it('streams orders with a BOM, a header and one row per order', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get(`/api/v1/admin/reports/export?type=orders&from=${FROM}&to=${TO}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=/);

    const text = res.text;
    // Excel needs the BOM to read UTF-8 (Bangla product names) correctly.
    expect(text.charCodeAt(0)).toBe(0xfeff);

    const lines = text.trim().split('\n');
    expect(lines[0]).toContain('orderNumber,date,status');

    const count = await prisma.order.count({
      where: {
        createdAt: { gte: new Date(`${FROM}T00:00:00.000Z`), lt: new Date('2027-01-01T00:00:00.000Z') },
      },
    });
    expect(lines.length).toBe(count + 1);
  });

  it('exports a product rollup with quantity and revenue', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get(`/api/v1/admin/reports/export?type=products&from=${FROM}&to=${TO}`);

    expect(res.status).toBe(200);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toContain('product,sku,quantity,revenue');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('rejects an unknown export type', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/reports/export?type=everything');
    expect(res.status).toBe(422);
  });
});
