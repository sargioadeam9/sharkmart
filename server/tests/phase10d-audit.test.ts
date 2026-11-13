/**
 * Phase 10 pass C — the audit log endpoint.
 *
 * The endpoint used to be an inline "newest 50" probe. Now that a screen reads
 * it, the contract that matters is the filter and the honest total: an operator
 * arrives holding an order number or a product id, and the count must describe
 * the filtered set, not the whole table.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status}`);
  }
  return agent;
}

beforeEach(async () => {
  await resetRateLimits();
});

describe('audit list', () => {
  it('returns newest first with an honest total', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/audit?limit=5');

    expect(res.status).toBe(200);
    expect(res.body.data.entries.length).toBeLessThanOrEqual(5);
    expect(res.body.data.total).toBeGreaterThanOrEqual(res.body.data.entries.length);

    const dates = res.body.data.entries.map((e: { createdAt: string }) => Date.parse(e.createdAt));
    const sorted = [...dates].sort((a, b) => b - a);
    expect(dates).toEqual(sorted);
  });

  it('narrows by entity, and the total follows the filter', async () => {
    const agent = await signIn('super@sharkmart.test');

    const all = await agent.get('/api/v1/admin/audit?limit=1');
    const filtered = await agent.get('/api/v1/admin/audit?entity=order&limit=1');

    expect(filtered.status).toBe(200);
    expect(filtered.body.data.total).toBeLessThanOrEqual(all.body.data.total);

    // Every returned row is the entity that was asked for.
    const rows = await agent.get('/api/v1/admin/audit?entity=order&limit=10');
    expect(
      rows.body.data.entries.every((e: { entity: string }) => e.entity === 'order'),
    ).toBe(true);
  });

  it('searches action, entity and record id with one query', async () => {
    const agent = await signIn('super@sharkmart.test');

    // `settings.update` is written by the settings module, so it exists.
    const res = await agent.get('/api/v1/admin/audit?q=settings&limit=5');
    expect(res.status).toBe(200);
    expect(
      res.body.data.entries.every(
        (e: { action: string; entity: string }) =>
          e.action.includes('settings') || e.entity.includes('settings'),
      ),
    ).toBe(true);
  });

  it('caps the page size rather than silently clamping', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/audit?limit=500');
    expect(res.status).toBe(422);
  });

  it('refuses INVENTORY_STAFF, who has no audit permission', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    const res = await agent.get('/api/v1/admin/audit');
    expect(res.status).toBe(403);
  });

  it('has a row for a mutation made through another module', async () => {
    // The trail is only useful if the writers actually reach it. An expense is
    // the newest writer, so its row proves the chain end to end.
    const agent = await signIn('super@sharkmart.test');
    const created = await agent
      .post('/api/v1/admin/expenses')
      .send({ category: 'AuditTest', description: 'audit chain', amountPoisha: 1_000, date: '2026-11-10' });

    expect(created.status).toBe(201);
    const id = created.body.data.id as string;

    const res = await agent.get(`/api/v1/admin/audit?q=${id}&limit=5`);
    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data.entries[0].action).toBe('expense.create');

    await prisma.auditLog.deleteMany({ where: { entityId: id } });
    await prisma.expense.deleteMany({ where: { id } });
  });
});
