/**
 * Phase 10 pass K — HRM.
 *
 * Three things worth pinning: an employee row cannot exist for a user that does
 * not, marking the same day twice corrects rather than duplicates, and a leave
 * request can only be decided once.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';
const employeeIds: string[] = [];
const userIds: string[] = [];

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

/**
 * A fresh staff user for each employee row.
 *
 * The first version reused the seeded staff accounts, and ran out of them: there
 * are four, and `Employee.userId` is unique. Creating the user is the only way the
 * suite stays runnable any number of times.
 */
async function aUserId(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: `HR Test ${Date.now()}`,
      email: `hr-${Date.now()}-${Math.floor(Math.random() * 10_000)}@sharkmart.test`,
      // Never used to sign in; the column is required.
      passwordHash: 'x'.repeat(60),
      role: 'INVENTORY_STAFF',
    },
    select: { id: true },
  });
  userIds.push(user.id);
  return user.id;
}

async function createEmployee(
  agent: request.SuperAgentTest,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await agent.post('/api/v1/admin/hrm/employees').send({
    userId: await aUserId(),
    department: 'Operations',
    designation: 'Officer',
    salaryPoisha: 3_000_000,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`employee create failed: ${res.status} ${JSON.stringify(res.body)}`);
  employeeIds.push(res.body.data.id);
  return res.body.data.id;
}

afterAll(async () => {
  if (employeeIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: employeeIds } } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.attendance.deleteMany({ where: { employeeId: { in: employeeIds } } });
    await prisma.employee.deleteMany({ where: { id: { in: employeeIds } } });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});

beforeEach(async () => {
  await resetRateLimits();
});

describe('employees', () => {
  it('creates an employee and refuses a second row for the same user', async () => {
    const agent = await signIn('super@sharkmart.test');
    const userId = await aUserId();

    const first = await agent
      .post('/api/v1/admin/hrm/employees')
      .send({ userId, department: 'Ops' });
    expect(first.status).toBe(201);
    employeeIds.push(first.body.data.id);

    const second = await agent.post('/api/v1/admin/hrm/employees').send({ userId });
    expect(second.status).toBe(409);
  });

  it('404s an unknown user', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent
      .post('/api/v1/admin/hrm/employees')
      .send({ userId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('updates salary and records only the changed field', async () => {
    const agent = await signIn('super@sharkmart.test');
    const id = await createEmployee(agent);

    const res = await agent.patch(`/api/v1/admin/hrm/employees/${id}`).send({ salaryPoisha: 4_500_000 });
    expect(res.status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'employee.update' },
      orderBy: { createdAt: 'desc' },
    });
    const changes = audit!.changes as Record<string, unknown>;
    expect(Object.keys(changes)).toEqual(['salaryPoisha']);
  });

  it('refuses a role without staff:manage', async () => {
    const agent = await signIn('manager@sharkmart.test');
    expect((await agent.get('/api/v1/admin/hrm/employees')).status).toBe(403);
  });
});

describe('attendance', () => {
  it('marks a day, and marking again corrects it rather than duplicating', async () => {
    const agent = await signIn('super@sharkmart.test');
    const employeeId = await createEmployee(agent);

    const first = await agent
      .post('/api/v1/admin/hrm/attendance')
      .send({ employeeId, date: '2026-11-10', status: 'PRESENT' });
    expect(first.status).toBe(200);

    const second = await agent
      .post('/api/v1/admin/hrm/attendance')
      .send({ employeeId, date: '2026-11-10', status: 'LATE' });
    expect(second.status).toBe(200);

    const rows = await prisma.attendance.findMany({ where: { employeeId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('LATE');
  });

  it('lists the active employees for a day with their mark, if any', async () => {
    const agent = await signIn('super@sharkmart.test');
    const employeeId = await createEmployee(agent);

    await agent
      .post('/api/v1/admin/hrm/attendance')
      .send({ employeeId, date: '2026-11-11', status: 'ABSENT' });

    const res = await agent.get('/api/v1/admin/hrm/attendance?date=2026-11-11');
    expect(res.status).toBe(200);

    const row = (res.body.data.items as Array<{ employeeId: string; status: string | null }>).find(
      (entry) => entry.employeeId === employeeId,
    );
    expect(row?.status).toBe('ABSENT');
  });
});

describe('leave', () => {
  it('creates a pending request and approves it once', async () => {
    const agent = await signIn('super@sharkmart.test');
    const employeeId = await createEmployee(agent);

    const created = await agent.post('/api/v1/admin/hrm/leaves').send({
      employeeId,
      type: 'SICK',
      startDate: '2026-11-12',
      endDate: '2026-11-13',
      reason: 'Fever',
    });
    expect(created.status).toBe(201);

    const approved = await agent
      .post(`/api/v1/admin/hrm/leaves/${created.body.data.id}/decide`)
      .send({ approve: true });
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe('APPROVED');

    const again = await agent
      .post(`/api/v1/admin/hrm/leaves/${created.body.data.id}/decide`)
      .send({ approve: false });
    expect(again.status).toBe(409);
  });

  it('rejects an end date before the start date', async () => {
    const agent = await signIn('super@sharkmart.test');
    const employeeId = await createEmployee(agent);

    const res = await agent.post('/api/v1/admin/hrm/leaves').send({
      employeeId,
      type: 'CASUAL',
      startDate: '2026-11-13',
      endDate: '2026-11-12',
    });

    expect(res.status).toBe(422);
  });
});
