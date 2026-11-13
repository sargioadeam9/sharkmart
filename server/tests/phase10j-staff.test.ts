/**
 * Phase 10 pass I — staff and roles.
 *
 * The guards are the module: you cannot change your own role, you cannot
 * deactivate yourself, and every change is audited. Those are the assertions.
 *
 * One guard is deliberately not tested: "the last active SUPER_ADMIN cannot be
 * demoted". It is unreachable while `staff:manage` belongs to SUPER_ADMIN alone —
 * the actor is always a super admin, so there is always another one. It is kept
 * because widening the permission would make it live, and a guard that only exists
 * after the incident is not a guard.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

/** Roles this suite changed, restored afterwards. */
const restore: Array<{ id: string; role: string; isActive: boolean }> = [];

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

async function staffByEmail(email: string): Promise<{ id: string; role: string; isActive: boolean }> {
  const row = await prisma.user.findFirstOrThrow({
    where: { email },
    select: { id: true, role: true, isActive: true },
  });
  restore.push({ id: row.id, role: row.role, isActive: row.isActive });
  return row;
}

afterAll(async () => {
  for (const entry of restore) {
    await prisma.user.update({
      where: { id: entry.id },
      data: { role: entry.role as never, isActive: entry.isActive },
    });
  }
  await prisma.auditLog.deleteMany({
    where: { action: { in: ['staff.role.update', 'staff.deactivate', 'staff.activate', 'staff.sessions.revoke'] } },
  });
});

beforeEach(async () => {
  await resetRateLimits();
});

describe('list', () => {
  it('returns staff with their role, permission count and live sessions', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/staff');

    expect(res.status).toBe(200);

    const items = res.body.data.items as Array<{
      role: string;
      permissions: string[];
      sessions: number;
    }>;

    // Customers are not staff.
    expect(items.every((row) => row.role !== 'CUSTOMER')).toBe(true);

    const superAdmin = items.find((row) => row.role === 'SUPER_ADMIN');
    expect(superAdmin?.permissions.length).toBeGreaterThan(0);
    expect(superAdmin?.sessions).toBeGreaterThanOrEqual(0);
  });

  it('refuses a non-super-admin', async () => {
    // ORDER_MANAGER holds audit:read and orders:*, but not staff:manage.
    const agent = await signIn('manager@sharkmart.test');
    expect((await agent.get('/api/v1/admin/staff')).status).toBe(403);
  });
});

describe('role change', () => {
  it('refuses to let a super admin change their own role', async () => {
    const agent = await signIn('super@sharkmart.test');
    const me = await prisma.user.findFirstOrThrow({
      where: { email: 'super@sharkmart.test' },
      select: { id: true },
    });

    const res = await agent.patch(`/api/v1/admin/staff/${me.id}/role`).send({ role: 'ADMIN' });

    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('SELF_ROLE_CHANGE');
  });

  it('changes another staff member role and writes one audit row', async () => {
    const agent = await signIn('super@sharkmart.test');
    const target = await staffByEmail('marketing@sharkmart.test');

    // Pick a role that is *not* the current one, whatever that is. A crashed run
    // can leave the seeded role changed, and a test that hardcodes the starting
    // value then fails for a reason that has nothing to do with the code.
    const nextRole = target.role === 'ORDER_MANAGER' ? 'ADMIN' : 'ORDER_MANAGER';

    try {
      const res = await agent
        .patch(`/api/v1/admin/staff/${target.id}/role`)
        .send({ role: nextRole });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe(nextRole);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { role: true },
      });
      expect(after.role).toBe(nextRole);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: target.id, action: 'staff.role.update' },
        orderBy: { createdAt: 'desc' },
      });
      const changes = audit!.changes as { role: { from: string; to: string } };
      expect(changes.role).toEqual({ from: target.role, to: nextRole });
    } finally {
      // Restored here, not only in afterAll: a segfault mid-suite would otherwise
      // leave this account promoted and break every later file's permission tests.
      await prisma.user.update({ where: { id: target.id }, data: { role: target.role as never } });
    }
  });

  it('rejects a role that is not a staff role', async () => {
    const agent = await signIn('super@sharkmart.test');
    const target = await staffByEmail('inventory@sharkmart.test');

    // CUSTOMER is intentionally not assignable here: this screen manages staff.
    const res = await agent
      .patch(`/api/v1/admin/staff/${target.id}/role`)
      .send({ role: 'CUSTOMER' });

    expect(res.status).toBe(422);
  });
});

describe('activation and sessions', () => {
  it('refuses to let a super admin deactivate themselves', async () => {
    const agent = await signIn('super@sharkmart.test');
    const me = await prisma.user.findFirstOrThrow({
      where: { email: 'super@sharkmart.test' },
      select: { id: true },
    });

    const res = await agent
      .post(`/api/v1/admin/staff/${me.id}/active`)
      .send({ isActive: false });

    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('SELF_DEACTIVATE');
  });

  it('deactivates another staff member and records it', async () => {
    const agent = await signIn('super@sharkmart.test');
    const target = await staffByEmail('inventory@sharkmart.test');

    try {
      const res = await agent
        .post(`/api/v1/admin/staff/${target.id}/active`)
        .send({ isActive: false });

      expect(res.status).toBe(200);

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: target.id },
        select: { isActive: true },
      });
      expect(after.isActive).toBe(false);

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: target.id, action: 'staff.deactivate' },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).not.toBeNull();
    } finally {
      await prisma.user.update({ where: { id: target.id }, data: { isActive: true } });
    }
  });

  it('revokes live sessions and reports how many', async () => {
    const agent = await signIn('super@sharkmart.test');
    const target = await staffByEmail('marketing@sharkmart.test');

    const before = await prisma.refreshToken.count({
      where: { userId: target.id, revokedAt: null },
    });

    const res = await agent.post(`/api/v1/admin/staff/${target.id}/revoke-sessions`);
    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBe(before);

    const after = await prisma.refreshToken.count({
      where: { userId: target.id, revokedAt: null },
    });
    expect(after).toBe(0);
  });
});
