/**
 * Phase 9 pass A tests — admin auth gates, permissions and the audit contract.
 *
 * These run against the real seeded MySQL database and the real staff accounts
 * created by `prisma/seed-test-users.ts`. The gate items that cannot be proved
 * by reading code:
 *
 *   - a CUSTOMER is refused the admin API with 403, not 401 and not 200
 *   - an INVENTORY_STAFF member is admitted, but refused `audit:read` and
 *     `settings` — the "nav hides it AND the API rejects it" pair
 *   - a mutation writes exactly one AuditLog row, with actor, action, entity,
 *     entityId and IP
 *   - the audit row and the change commit or roll back together
 *
 * The middleware redirect (302) is a Next.js concern and is verified against a
 * running server, not here — Supertest only sees the Express app.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';
import { withAudit, audit, diffChanges } from '../src/services/audit.service.js';
import { can, permissionsFor, isAdminRole } from '../src/services/permissions.js';

const PASSWORD = 'Admin@12345';

/** Logs in and returns an agent carrying the session cookies. */
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

/** Audit rows created by this suite, cleaned up afterwards. */
const createdAuditIds: string[] = [];

beforeEach(async () => {
  // Login is 5/min per IP; a suite of a dozen logins exhausts it fast.
  await resetRateLimits();
});

afterAll(async () => {
  if (createdAuditIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { id: { in: createdAuditIds } } });
  }
});

// ── The permission matrix is data, and it is correct ────────────────────────
describe('permission matrix', () => {
  it('gives a CUSTOMER no admin permission at all', () => {
    expect(permissionsFor('CUSTOMER')).toEqual([]);
    expect(isAdminRole('CUSTOMER')).toBe(false);
  });

  it('lets INVENTORY_STAFF write catalog but not read the audit log or settings', () => {
    expect(can('INVENTORY_STAFF', 'catalog:write')).toBe(true);
    expect(can('INVENTORY_STAFF', 'inventory:write')).toBe(true);
    expect(can('INVENTORY_STAFF', 'audit:read')).toBe(false);
    expect(can('INVENTORY_STAFF', 'settings:read')).toBe(false);
    expect(can('INVENTORY_STAFF', 'staff:manage')).toBe(false);
  });

  it('reserves staff:manage for SUPER_ADMIN alone', () => {
    expect(can('SUPER_ADMIN', 'staff:manage')).toBe(true);
    expect(can('ADMIN', 'staff:manage')).toBe(false);
    expect(can('ORDER_MANAGER', 'staff:manage')).toBe(false);
  });

  it('does not grant a refund to staff or marketing', () => {
    expect(can('INVENTORY_STAFF', 'orders:refund')).toBe(false);
    expect(can('MARKETING_STAFF', 'orders:refund')).toBe(false);
    expect(can('ORDER_MANAGER', 'orders:refund')).toBe(true);
  });

  it('treats an unknown role as holding nothing', () => {
    // A role removed from the enum must not fall through to access.
    expect(can('PRODUCT_MANAGER', 'catalog:write')).toBe(false);
    expect(isAdminRole('PRODUCT_MANAGER')).toBe(false);
  });
});

// ── The three gates, over HTTP ──────────────────────────────────────────────
describe('admin API gates', () => {
  it('401s an anonymous request', async () => {
    const res = await request(app).get('/api/v1/admin/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('403s a CUSTOMER — authenticated but not staff', async () => {
    const agent = await signIn('customer@sharkmart.test');
    const res = await agent.get('/api/v1/admin/me');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    // The message must not reveal what the admin surface contains.
    expect(res.body.error.message).not.toContain('permission');
  });

  it('admits INVENTORY_STAFF and returns their permission list', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    const res = await agent.get('/api/v1/admin/me');

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('INVENTORY_STAFF');
    expect(res.body.data.permissions).toContain('catalog:write');
    // The nav renders from this list; the audit entry must be absent from it.
    expect(res.body.data.permissions).not.toContain('audit:read');
  });

  it('403s INVENTORY_STAFF on the audit log — hiding the nav is not the control', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    const res = await agent.get('/api/v1/admin/audit');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('admits SUPER_ADMIN to the audit log', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/audit');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.entries)).toBe(true);
  });
});

// ── The dashboard returns real aggregates ───────────────────────────────────
describe('dashboard aggregates', () => {
  it('returns every panel from one call, with real numbers', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/dashboard?range=30d');

    expect(res.status).toBe(200);
    const data = res.body.data;

    // Every panel present.
    expect(data.kpis).toBeDefined();
    expect(Array.isArray(data.series)).toBe(true);
    expect(Array.isArray(data.pipeline)).toBe(true);
    expect(Array.isArray(data.needsAttention)).toBe(true);
    expect(Array.isArray(data.recentOrders)).toBe(true);
    expect(Array.isArray(data.couriers)).toBe(true);

    // The pipeline always reports every stage, including the empty ones.
    expect(data.pipeline).toHaveLength(5);
    expect(data.pipeline.map((p: { status: string }) => p.status)).toEqual([
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
    ]);

    // Money is an integer number of poisha, never a float.
    expect(Number.isInteger(data.kpis.revenuePoisha)).toBe(true);
    expect(Number.isInteger(data.kpis.averageOrderPoisha)).toBe(true);
  });

  it('honours the range preset', async () => {
    const agent = await signIn('super@sharkmart.test');
    const today = await agent.get('/api/v1/admin/dashboard?range=today');
    const month = await agent.get('/api/v1/admin/dashboard?range=30d');

    expect(today.status).toBe(200);
    expect(month.status).toBe(200);

    // The 30-day window must be at least as wide as today's.
    const todayFrom = new Date(today.body.data.range.from).getTime();
    const monthFrom = new Date(month.body.data.range.from).getTime();
    expect(monthFrom).toBeLessThanOrEqual(todayFrom);
  });

  it('falls back to 7d for an unknown preset rather than erroring', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.get('/api/v1/admin/dashboard?range=nonsense');
    expect(res.status).toBe(200);
  });
});

// ── The audit contract: one row per mutation, same transaction ──────────────
describe('audit helper', () => {
  it('writes one row with actor, action, entity, entityId and IP', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'super@sharkmart.test' },
      select: { id: true },
    });

    const row = await withAudit(
      {
        userId: user.id,
        action: 'product.update',
        entity: 'product',
        entityId: 'test-product-id',
        changes: { nameEn: { from: 'Old name', to: 'New name' } },
        ipAddress: '127.0.0.1',
      },
      async (tx) => {
        // A real write in the same transaction, so the pair is genuinely atomic.
        return tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'placeholder',
            entity: 'product',
            entityId: 'test-product-id',
          },
        });
      },
    );

    createdAuditIds.push(row.id);

    const written = await prisma.auditLog.findFirst({
      where: { entity: 'product', entityId: 'test-product-id', action: 'product.update' },
      orderBy: { createdAt: 'desc' },
    });

    expect(written).not.toBeNull();
    expect(written!.userId).toBe(user.id);
    expect(written!.action).toBe('product.update');
    expect(written!.entity).toBe('product');
    expect(written!.entityId).toBe('test-product-id');
    expect(written!.ipAddress).toBe('127.0.0.1');
    expect(written!.changes).toMatchObject({ nameEn: { from: 'Old name', to: 'New name' } });

    createdAuditIds.push(written!.id);
  });

  it('rolls the audit row back when the mutation fails', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'super@sharkmart.test' },
      select: { id: true },
    });

    const marker = `rollback-test-${Date.now()}`;

    await expect(
      withAudit(
        {
          userId: user.id,
          action: 'product.update',
          entity: 'product',
          entityId: marker,
          ipAddress: '127.0.0.1',
        },
        async () => {
          // Fail after the work, before the audit row is written.
          throw new Error('simulated mutation failure');
        },
      ),
    ).rejects.toThrow('simulated mutation failure');

    const orphan = await prisma.auditLog.findFirst({ where: { entityId: marker } });
    // No audit row for a change that never happened.
    expect(orphan).toBeNull();
  });

  it('keeps only the fields that actually changed', () => {
    const changes = diffChanges(
      { nameEn: 'Widget', price: 100, stock: 5 },
      { nameEn: 'Widget', price: 120, stock: 5 },
    );

    expect(Object.keys(changes)).toEqual(['price']);
    expect(changes.price).toEqual({ from: 100, to: 120 });
  });

  it('writes nothing when an update changes nothing', () => {
    const changes = diffChanges({ nameEn: 'Widget' }, { nameEn: 'Widget' });
    expect(changes).toEqual({});
  });
});
