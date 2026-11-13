/**
 * Phase 10 pass G — CRM.
 *
 * The list is a grouped query with a `HAVING` segment filter, so the assertions
 * compare it against the database rather than against fixed numbers: the seeded
 * customer base is test residue that changes between runs.
 *
 * The one thing pinned exactly is the note: create it, see it on the profile, see
 * one audit row, delete it, see it gone.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

const noteIds: string[] = [];
const customerIds: string[] = [];

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

afterAll(async () => {
  if (noteIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: customerIds } } });
    await prisma.customerNote.deleteMany({ where: { id: { in: noteIds } } });
  }
});

beforeEach(async () => {
  await resetRateLimits();
});

/** A customer with at least two live orders, so the profile has something to show. */
async function aReturningCustomer(): Promise<string> {
  const row = await prisma.$queryRaw<Array<{ userId: string }>>`
    SELECT o.userId
    FROM \`Order\` o
    WHERE o.userId IS NOT NULL
      AND o.currentStatus NOT IN ('CANCELLED', 'RETURNED')
    GROUP BY o.userId
    HAVING COUNT(*) >= 2
    LIMIT 1
  `;
  if (!row[0]) throw new Error('no returning customer in the seeded data');
  return row[0].userId;
}

describe('customer list', () => {
  it('returns customers with their order count and spend', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/customers?limit=5');

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeLessThanOrEqual(5);
    expect(res.body.data.total).toBeGreaterThan(0);

    for (const row of res.body.data.items as Array<{ orders: number; spendPoisha: number }>) {
      expect(row.orders).toBeGreaterThanOrEqual(0);
      expect(row.spendPoisha).toBeGreaterThanOrEqual(0);
    }
  });

  it('filters to customers with two or more live orders for the returning segment', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/customers?segment=returning&limit=100');

    expect(res.status).toBe(200);
    for (const row of res.body.data.items as Array<{ orders: number }>) {
      expect(row.orders).toBeGreaterThanOrEqual(2);
    }
  });

  it('filters to the high-value threshold', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/customers?segment=high_value&limit=100');

    expect(res.status).toBe(200);
    for (const row of res.body.data.items as Array<{ spendPoisha: number }>) {
      expect(row.spendPoisha).toBeGreaterThanOrEqual(1_000_000);
    }
  });

  it('searches by phone or name without breaking the aggregate', async () => {
    const agent = await signIn('super@sharkmart.test');
    const sample = await prisma.user.findFirstOrThrow({
      where: { role: 'CUSTOMER', phone: { not: null } },
      select: { phone: true },
    });

    const res = await agent.get(
      `/api/v1/admin/customers?q=${encodeURIComponent(sample.phone!)}&limit=5`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.items[0].phone).toBe(sample.phone);
  });

  it('refuses INVENTORY_STAFF, who has no customers permission', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    expect((await agent.get('/api/v1/admin/customers')).status).toBe(403);
  });
});

describe('customer profile', () => {
  it('reports spend and order count that match the database', async () => {
    const agent = await signIn('super@sharkmart.test');
    const id = await aReturningCustomer();

    const res = await agent.get(`/api/v1/admin/customers/${id}`);
    expect(res.status).toBe(200);

    const agg = await prisma.order.aggregate({
      where: { userId: id, currentStatus: { notIn: ['CANCELLED', 'RETURNED'] } },
      _count: { _all: true },
      _sum: { totalAmountPoisha: true },
    });

    expect(res.body.data.stats.orders).toBe(agg._count._all);
    expect(res.body.data.stats.spendPoisha).toBe(agg._sum.totalAmountPoisha ?? 0);
    expect(res.body.data.stats.averageOrderPoisha).toBe(
      agg._count._all === 0 ? 0 : Math.round((agg._sum.totalAmountPoisha ?? 0) / agg._count._all),
    );
  });

  it('404s an unknown id with the envelope', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/customers/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });
});

describe('notes', () => {
  it('creates a note, shows it on the profile, and writes one audit row', async () => {
    const agent = await signIn('super@sharkmart.test');
    const id = await aReturningCustomer();
    customerIds.push(id);

    const created = await agent
      .post(`/api/v1/admin/customers/${id}/notes`)
      .send({ body: 'Called about a late delivery.' });

    expect(created.status).toBe(201);
    noteIds.push(created.body.data.id);

    const profile = await agent.get(`/api/v1/admin/customers/${id}`);
    const note = (profile.body.data.notes as Array<{ id: string; body: string }>).find(
      (row) => row.id === created.body.data.id,
    );
    expect(note?.body).toBe('Called about a late delivery.');

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'customer.note.create' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects an empty note', async () => {
    const agent = await signIn('super@sharkmart.test');
    const id = await aReturningCustomer();

    const res = await agent.post(`/api/v1/admin/customers/${id}/notes`).send({ body: '   ' });
    expect(res.status).toBe(422);
  });

  it('deletes a note and writes an audit row', async () => {
    const agent = await signIn('super@sharkmart.test');
    const id = await aReturningCustomer();
    customerIds.push(id);

    const created = await agent
      .post(`/api/v1/admin/customers/${id}/notes`)
      .send({ body: 'Temporary note' });

    const removed = await agent.delete(
      `/api/v1/admin/customers/${id}/notes/${created.body.data.id}`,
    );
    expect(removed.status).toBe(200);

    expect(
      await prisma.customerNote.findUnique({ where: { id: created.body.data.id } }),
    ).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'customer.note.delete' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses INVENTORY_STAFF a note', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    const id = await aReturningCustomer();

    const res = await agent.post(`/api/v1/admin/customers/${id}/notes`).send({ body: 'nope' });
    expect(res.status).toBe(403);
  });
});
