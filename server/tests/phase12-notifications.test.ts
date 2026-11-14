/**
 * Phase 12 — outbound email and Telegram.
 *
 * The suite runs against the real database and the real HTTP surface. What it
 * deliberately does NOT do is reach the network: `fetch` is stubbed for the one
 * test that needs a provider response, and every other send runs with no API key
 * configured — which is exactly the state a fresh install is in, and the state
 * that used to be silent.
 *
 * The three assertions that matter most:
 *
 *   1. A placed order writes an `order_confirmation` row addressed to the email
 *      the customer typed at checkout — the thing that did not exist before this
 *      pass, because `Notification.recipientId` was a required FK to `User`.
 *   2. A password reset writes a `password_reset` row. Without it the reset flow
 *      only ever worked in development.
 *   3. A send with no transport leaves the row PENDING **with the reason**. A
 *      row marked SENT when nothing left the building is the failure mode this
 *      whole module exists to avoid.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';

import { app, prisma, resetRateLimits } from './helpers.js';
import { renderEmail, itemsTable } from '../src/services/notify/templates.js';
import { sendEmail } from '../src/services/notify/mailer.js';
import { sendTelegram } from '../src/services/notify/telegram.js';
import { env } from '../src/config/env.js';

const PASSWORD = 'Admin@12345';

const createdOrderIds: string[] = [];
const createdUserIds: string[] = [];
const createdEmails: string[] = [];

beforeAll(async () => {
  await resetRateLimits();
});

afterEach(async () => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  /**
   * A registration that hit the rate limiter leaves `body.data.id` undefined,
   * and Prisma rejects `in: [undefined]` outright. Filtering here keeps a
   * partially-failed run from turning into a cleanup crash that hides the real
   * result.
   */
  const ids = (values: Array<string | undefined>): string[] =>
    values.filter((value): value is string => typeof value === 'string' && value.length > 0);

  const emails = ids(createdEmails);
  const orderIds = ids(createdOrderIds);
  const userIds = ids(createdUserIds);

  // Guest notifications have no user to cascade from.
  if (emails.length > 0) {
    await prisma.notification.deleteMany({ where: { toEmail: { in: emails } } });
  }

  if (orderIds.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});

function csrfOf(agent: request.SuperAgentTest): string {
  const cookies = agent.jar.getCookies({
    domain: '127.0.0.1',
    path: '/',
    secure: false,
    script: false,
  }) as unknown as Array<{ name: string; value: string }>;
  return cookies.find((cookie) => cookie.name === 'csrf_token')?.value ?? '';
}

// ─── Templates ─────────────────────────────────────────────────────────────

describe('email templates', () => {
  it('renders the order confirmation with the shop name and the order number', async () => {
    const rendered = await renderEmail('order_confirmation', 'en', {
      customerName: 'Rahim',
      orderNumber: 'SM-TEST-1',
      itemsTable: itemsTable([{ name: 'A4 Paper', quantity: 2, lineTotal: '৳1,040' }]),
      total: '৳1,040',
      paymentMethod: 'COD',
    });

    expect(rendered.subject).toContain('SM-TEST-1');
    expect(rendered.html).toContain('SM-TEST-1');
    expect(rendered.html).toContain('A4 Paper');
    // The shop's name comes from settings, not from the caller.
    expect(rendered.html).toContain('SharkMart');
    // And a plain-text alternative exists, because a text/plain part is one of
    // the things spam filters look for.
    expect(rendered.text.length).toBeGreaterThan(20);
    expect(rendered.text).not.toContain('<p>');
  });

  it('escapes a customer name that contains markup', async () => {
    const rendered = await renderEmail('order_confirmation', 'en', {
      customerName: '<script>alert(1)</script>',
      orderNumber: 'SM-TEST-2',
      itemsTable: '',
      total: '৳100',
      paymentMethod: 'COD',
    });

    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });

  it('renders the Bengali copy when asked for Bengali', async () => {
    const rendered = await renderEmail('password_reset', 'bn', {
      customerName: 'রহিম',
      resetUrl: 'https://example.test/reset-password?token=x',
      expiresMinutes: '30',
    });

    expect(rendered.subject).toContain('পাসওয়ার্ড');
    expect(rendered.html).toContain('https://example.test/reset-password?token=x');
  });
});

// ─── Transport ─────────────────────────────────────────────────────────────

describe('transport', () => {
  it('reports a missing Resend key instead of throwing', async () => {
    const result = await sendEmail({ to: 'someone@example.test', subject: 'x', html: '<p>x</p>' });

    // The test environment has no RESEND_API_KEY, which is the same state a
    // fresh install is in.
    if (!env.RESEND_API_KEY) {
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/RESEND_API_KEY|MAIL_FROM/);
    }
  });

  it('reports a missing bot token instead of throwing', async () => {
    const result = await sendTelegram('hello');

    if (!env.TELEGRAM_BOT_TOKEN) {
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/TELEGRAM_BOT_TOKEN/);
    }
  });

  it('passes the provider error back verbatim', async () => {
    /**
     * The reason string is the whole point: "domain is not verified" is what
     * fixes the problem, "send failed" is what starts a support thread.
     */
    const original = env.RESEND_API_KEY;
    const originalFrom = env.MAIL_FROM;
    (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = 're_test_key';
    (env as { MAIL_FROM?: string }).MAIL_FROM = 'SharkMart <test@example.test>';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({ message: 'The domain is not verified', name: 'validation_error' }),
      })),
    );

    try {
      const result = await sendEmail({ to: 'someone@example.test', subject: 'x', html: '<p>x</p>' });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('403');
      expect(result.reason).toContain('domain is not verified');
    } finally {
      (env as { RESEND_API_KEY?: string }).RESEND_API_KEY = original;
      (env as { MAIL_FROM?: string }).MAIL_FROM = originalFrom;
    }
  });
});

// ─── Wiring ────────────────────────────────────────────────────────────────

describe('order notifications', () => {
  it('records a confirmation row for the email given at checkout', async () => {
    const email = `notify-${Date.now()}@sharkmart.test`;
    createdEmails.push(email);

    const agent = request.agent(app);
    const product = await prisma.product.findFirst({
      where: {
        isPublished: true,
        isDraft: false,
        variants: { some: { isActive: true, stock: { gt: 5 } } },
      },
      select: {
        id: true,
        variants: { where: { isActive: true, stock: { gt: 5 } }, select: { id: true }, take: 1 },
      },
    });

    if (!product?.variants[0]) throw new Error('no orderable product in the seed');

    const created = await agent
      .post('/api/v1/checkout')
      .set('X-CSRF-Token', csrfOf(agent))
      .send({
        items: [{ productId: product.id, variantId: product.variants[0].id, quantity: 1 }],
        address: {
          recipientName: 'Notify Tester',
          phone: '01711111111',
          division: 'Dhaka',
          district: 'Dhaka',
          area: 'Gulshan',
          address: 'House 1, Road 1',
        },
        paymentMethod: 'COD',
        contactEmail: email,
      });

    expect(created.status).toBe(201);
    createdOrderIds.push(created.body.data.id);

    /**
     * The send is fired after the response, so the row lands a moment later —
     * and it is written *before* the attempt, which means an early read sees
     * PENDING with no error. Wait for the row to settle, not merely to exist.
     */
    let row = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      row = await prisma.notification.findFirst({
        where: { type: 'order_confirmation', toEmail: email },
        select: { id: true, status: true, error: true, subject: true, body: true },
      });
      if (row && (row.status !== 'PENDING' || row.error)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(row).not.toBeNull();
    expect(row!.subject).toContain(created.body.data.orderNumber);
    expect(row!.body).toContain('Notify Tester');
    /**
     * No transport is configured in this environment, so the honest outcome is
     * PENDING with a reason — never SENT.
     */
    if (!env.RESEND_API_KEY) {
      expect(row!.status).toBe('PENDING');
      expect(row!.error).toBeTruthy();
    }

    // The shop is told as well, on its own address.
    const adminRow = await prisma.notification.findFirst({
      where: { type: 'admin_new_order' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, toEmail: true },
    });
    expect(adminRow).not.toBeNull();
  });
});

describe('password reset email', () => {
  it('records a reset row for the account that asked', async () => {
    await resetRateLimits();


    const email = `reset-notify-${Date.now()}@sharkmart.test`;
    createdEmails.push(email);

    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send({
      name: 'Reset Notify',
      email,
      password: 'TestPass123',
      language: 'en',
    });

    expect(registered.status).toBe(201);
    createdUserIds.push(registered.body.data.id);

    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ identifier: email });
    expect(forgot.status).toBe(200);

    let row = null;
    for (let attempt = 0; attempt < 20 && !row; attempt += 1) {
      row = await prisma.notification.findFirst({
        where: { type: 'password_reset', toEmail: email },
        select: { id: true, body: true, status: true },
      });
      if (!row) await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(row).not.toBeNull();
    // The link is in the body — that is what the customer clicks.
    expect(row!.body).toContain('/reset-password?token=');
  });
});

describe('admin test endpoints', () => {
  it('refuses a test send from a role without settings:write', async () => {
    await resetRateLimits();
    const email = `notify-role-${Date.now()}@sharkmart.test`;
    createdEmails.push(email);

    const agent = request.agent(app);
    const registered = await agent.post('/api/v1/auth/register').send({
      name: 'Customer',
      email,
      password: 'TestPass123',
    });
    createdUserIds.push(registered.body.data.id);

    const res = await agent.post('/api/v1/admin/settings/test-email').send({});
    // A CUSTOMER is refused at the staff gate before the permission is checked.
    expect([401, 403]).toContain(res.status);
  });

  it('sends a test email as a super admin, or reports why it could not', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/v1/auth/login')
      .send({ identifier: 'super@sharkmart.test', password: PASSWORD });

    expect(login.status).toBe(200);

    const res = await agent
      .post('/api/v1/admin/settings/test-email')
      .send({ to: 'someone@example.test' });

    if (env.RESEND_API_KEY) {
      // With a live key this would really send; the assertion is only that the
      // endpoint answers in one of the two shapes.
      expect([200, 502]).toContain(res.status);
    } else {
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('UPSTREAM_ERROR');
      expect(res.body.error.message).toMatch(/RESEND_API_KEY|MAIL_FROM/);
    }
  });
});
