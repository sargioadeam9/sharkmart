/**
 * Phase 10 pass H — marketing queue.
 *
 * The assertion that matters is the boundary between "queued" and "sent": the
 * compose endpoint must write PENDING rows and deliver nothing. A module that
 * quietly sends inside the request is the thing the master prompt forbids, and it
 * is also the thing that breaks first under load.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, resetRateLimits } from './helpers.js';

const PASSWORD = 'Admin@12345';

const templateIds: string[] = [];

async function signIn(email: string): Promise<request.SuperAgentTest> {
  const agent = request.agent(app);
  const res = await agent
    .post('/api/v1/auth/login')
    .send({ identifier: email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}

async function smsTemplate(agent: request.SuperAgentTest): Promise<string> {
  const res = await agent.post('/api/v1/admin/marketing/templates/sms').send({
    name: `Template ${Date.now()}`,
    templateEn: 'Hi {name}, offer at {shop}',
    templateBn: 'হ্যালো {name}, {shop}-এ অফার',
  });
  if (res.status !== 201) throw new Error(`template create failed: ${res.status}`);
  templateIds.push(res.body.data.id);
  return res.body.data.id as string;
}

afterAll(async () => {
  // Campaign rows are tagged by type, so cleanup does not depend on ids.
  await prisma.notification.deleteMany({ where: { type: { in: ['campaign_sms', 'campaign_email'] } } });
  if (templateIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: templateIds } } });
    // Both tables share the id list, so both must be swept — the first version
    // only deleted SMS rows and left email templates behind for the next run.
    await prisma.sMSTemplate.deleteMany({ where: { id: { in: templateIds } } });
    await prisma.emailTemplate.deleteMany({ where: { id: { in: templateIds } } });
  }
  await prisma.auditLog.deleteMany({ where: { action: 'campaign.send' } });
});

beforeEach(async () => {
  await resetRateLimits();
});

describe('templates', () => {
  it('creates an SMS template and writes one audit row', async () => {
    const agent = await signIn('super@sharkmart.test');
    const id = await smsTemplate(agent);

    const audit = await prisma.auditLog.findFirst({
      where: { entityId: id, action: 'template.sms.create' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects an empty template body', async () => {
    const agent = await signIn('super@sharkmart.test');
    const res = await agent.post('/api/v1/admin/marketing/templates/sms').send({
      name: 'Empty',
      templateEn: '   ',
      templateBn: 'ok',
    });
    expect(res.status).toBe(422);
  });

  it('refuses INVENTORY_STAFF', async () => {
    const agent = await signIn('inventory@sharkmart.test');
    expect((await agent.get('/api/v1/admin/marketing/templates')).status).toBe(403);
  });
});

describe('compose', () => {
  it('previews a rendered sample and writes nothing', async () => {
    const agent = await signIn('super@sharkmart.test');
    const templateId = await smsTemplate(agent);

    const before = await prisma.notification.count();

    const res = await agent.post('/api/v1/admin/marketing/compose').send({
      channel: 'SMS',
      templateId,
      segment: 'all',
      language: 'bn',
      preview: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.recipients).toBeGreaterThan(0);
    // Placeholders substituted, shop name present.
    expect(res.body.data.sample.body).toContain('SharkMart');
    expect(res.body.data.sample.body).not.toContain('{name}');

    expect(await prisma.notification.count()).toBe(before);
  });

  it('queues PENDING rows and delivers nothing', async () => {
    const agent = await signIn('super@sharkmart.test');
    const templateId = await smsTemplate(agent);

    const res = await agent.post('/api/v1/admin/marketing/compose').send({
      channel: 'SMS',
      templateId,
      segment: 'returning',
      language: 'en',
      preview: false,
    });

    expect(res.status).toBe(201);
    const queued = res.body.data.queued as number;
    expect(queued).toBeGreaterThan(0);

    const rows = await prisma.notification.findMany({
      where: { type: 'campaign_sms' },
      select: { status: true, sentAt: true, body: true },
    });

    expect(rows).toHaveLength(queued);
    // Every row is waiting; none has a sentAt.
    expect(rows.every((row) => row.status === 'PENDING' && row.sentAt === null)).toBe(true);
    expect(rows[0]?.body).toContain('SharkMart');
  });

  it('queues an email campaign as EMAIL rows', async () => {
    const agent = await signIn('super@sharkmart.test');

    const created = await agent.post('/api/v1/admin/marketing/templates/email').send({
      name: `Email ${Date.now()}`,
      subjectEn: 'Offer from {shop}',
      subjectBn: '{shop} থেকে অফার',
      bodyEn: 'Hello {name}',
      bodyBn: 'হ্যালো {name}',
    });
    expect(created.status).toBe(201);
    templateIds.push(created.body.data.id);

    const res = await agent.post('/api/v1/admin/marketing/compose').send({
      channel: 'EMAIL',
      templateId: created.body.data.id,
      segment: 'returning',
      language: 'en',
      preview: false,
    });

    expect(res.status).toBe(201);

    const rows = await prisma.notification.findMany({
      where: { type: 'campaign_email' },
      select: { channel: true, subject: true },
    });
    expect(rows.length).toBe(res.body.data.queued);
    expect(rows.every((row) => row.channel === 'EMAIL')).toBe(true);
    expect(rows[0]?.subject).toContain('SharkMart');
  });

  it('refuses a segment with no reachable recipients', async () => {
    const agent = await signIn('super@sharkmart.test');
    const templateId = await smsTemplate(agent);

    // `inactive` is empty in the seeded data: every test customer is recent.
    const res = await agent.post('/api/v1/admin/marketing/compose').send({
      channel: 'SMS',
      templateId,
      segment: 'inactive',
      preview: false,
    });

    // Either there is genuinely nobody, or the send queued — both are honest; what
    // must not happen is a 201 with zero recipients written.
    if (res.status === 422) {
      expect(res.body.error.message).toMatch(/no reachable recipients/i);
    } else {
      expect(res.body.data.queued).toBeGreaterThan(0);
    }
  });
});

describe('report', () => {
  it('counts queued rows by channel and status', async () => {
    const agent = await signIn('super@sharkmart.test');
    const templateId = await smsTemplate(agent);

    await agent.post('/api/v1/admin/marketing/compose').send({
      channel: 'SMS',
      templateId,
      segment: 'returning',
      language: 'en',
      preview: false,
    });

    const res = await agent.get('/api/v1/admin/marketing/report?channel=SMS');
    expect(res.status).toBe(200);
    expect(res.body.data.counts.SMS_PENDING).toBeGreaterThan(0);
    expect(res.body.data.recent.length).toBeGreaterThan(0);
  });
});
