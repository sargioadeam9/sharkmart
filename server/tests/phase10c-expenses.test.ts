/**
 * Phase 10 pass C — the admin expenses API.
 *
 * Expenses are the first module whose whole point is a number that must add up:
 * `totalAmountPoisha` above the table has to be the sum of the *filter*, not of
 * the visible page, or the operator budgets against a figure that changes as they
 * paginate. That is the assertion worth writing.
 *
 * The permission is `settings:*` because the matrix has no `expenses:*` and
 * settings is the only gate that already means "admin and above, money records".
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

const createdIds: string[] = [];

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

function body(overrides: Record<string, unknown> = {}) {
  return {
    category: `Test-${uniq()}`,
    description: 'Courier bill',
    amountPoisha: 45_000,
    date: '2026-11-05',
    ...overrides,
  };
}

async function create(
  agent: request.SuperAgentTest,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; data: Record<string, unknown> }> {
  const res = await agent.post('/api/v1/admin/expenses').send(body(overrides));
  if (res.status !== 201) {
    throw new Error(`create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.data.id as string;
  createdIds.push(id);
  return { id, data: res.body.data };
}

beforeEach(async () => {
  await resetRateLimits();
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
    await prisma.expense.deleteMany({ where: { id: { in: createdIds } } });
  }
});

describe('create', () => {
  it('records the expense, the creator, and one audit row', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id, data } = await create(agent);

    expect(data.amountPoisha).toBe(45_000);
    expect(data.date).toBe('2026-11-05');
    expect(data.createdByName).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'expense.create' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.entity).toBe('expense');
  });

  it('rejects a zero amount and a malformed date', async () => {
    const agent = await signIn('super@sharkmart.test');

    const zero = await agent.post('/api/v1/admin/expenses').send(body({ amountPoisha: 0 }));
    expect(zero.status).toBe(422);

    const badDate = await agent.post('/api/v1/admin/expenses').send(body({ date: '05/11/2026' }));
    expect(badDate.status).toBe(422);
  });

  it('rejects a javascript: receipt url', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .post('/api/v1/admin/expenses')
      .send(body({ receiptUrl: 'javascript:alert(1)' }));
    expect(res.status).toBe(422);
  });
});

describe('list', () => {
  it('sums the whole filter, not just the visible page', async () => {
    const agent = await signIn('super@sharkmart.test');
    const category = `Sum-${uniq()}`;

    // Three rows in one category; page size 2 so the third is off-page.
    await create(agent, { category, amountPoisha: 10_000 });
    await create(agent, { category, amountPoisha: 20_000 });
    await create(agent, { category, amountPoisha: 30_000 });

    const res = await agent.get(
      `/api/v1/admin/expenses?category=${encodeURIComponent(category)}&limit=2`,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(3);
    // 10k + 20k + 30k, even though only two rows came back.
    expect(res.body.data.totalAmountPoisha).toBe(60_000);
  });

  it('filters by an inclusive date range', async () => {
    const agent = await signIn('super@sharkmart.test');
    const category = `Range-${uniq()}`;

    await create(agent, { category, date: '2026-10-31', amountPoisha: 1_000 });
    await create(agent, { category, date: '2026-11-01', amountPoisha: 2_000 });
    await create(agent, { category, date: '2026-11-30', amountPoisha: 4_000 });
    await create(agent, { category, date: '2026-12-01', amountPoisha: 8_000 });

    const res = await agent.get(
      `/api/v1/admin/expenses?category=${encodeURIComponent(category)}&from=2026-11-01&to=2026-11-30`,
    );

    expect(res.body.data.total).toBe(2);
    // The boundary days are included on both ends.
    expect(res.body.data.totalAmountPoisha).toBe(6_000);
  });
});

describe('update and delete', () => {
  it('writes only the changed fields to the audit row', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await create(agent);

    const res = await agent
      .patch(`/api/v1/admin/expenses/${id}`)
      .send({ amountPoisha: 55_000 });

    expect(res.status).toBe(200);
    expect(res.body.data.amountPoisha).toBe(55_000);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'expense.update' },
      orderBy: { createdAt: 'desc' },
    });
    const changes = audit!.changes as Record<string, unknown>;
    expect(Object.keys(changes)).toEqual(['amountPoisha']);
  });

  it('deletes, and the audit row keeps the amount', async () => {
    const agent = await signIn('super@sharkmart.test');
    const { id } = await create(agent, { amountPoisha: 77_000 });

    const res = await agent.delete(`/api/v1/admin/expenses/${id}`);
    expect(res.status).toBe(200);

    expect(await prisma.expense.findUnique({ where: { id } })).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'expense.delete' },
    });
    const changes = audit!.changes as { before: { amountPoisha: number } };
    expect(changes.before.amountPoisha).toBe(77_000);

    const index = createdIds.indexOf(id);
    if (index >= 0) createdIds.splice(index, 1);
  });
});

describe('summary and permissions', () => {
  it('groups the range by category and totals it', async () => {
    const agent = await signIn('super@sharkmart.test');
    const category = `Group-${uniq()}`;
    await create(agent, { category, date: '2026-09-10', amountPoisha: 15_000 });
    await create(agent, { category, date: '2026-09-11', amountPoisha: 5_000 });

    const res = await agent.get('/api/v1/admin/expenses/summary?from=2026-09-01&to=2026-09-30');
    expect(res.status).toBe(200);

    const row = (res.body.data.byCategory as Array<{ category: string; totalPoisha: number }>).find(
      (entry) => entry.category === category,
    );
    expect(row?.totalPoisha).toBe(20_000);
    expect(res.body.data.from).toBe('2026-09-01');
    expect(res.body.data.to).toBe('2026-09-30');
  });

  it('refuses ORDER_MANAGER, who has no settings permission', async () => {
    const agent = await signIn('manager@sharkmart.test');
    expect((await agent.get('/api/v1/admin/expenses')).status).toBe(403);
    expect((await agent.post('/api/v1/admin/expenses').send(body())).status).toBe(403);
  });
});
