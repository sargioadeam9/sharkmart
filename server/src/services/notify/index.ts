/**
 * The notification facade — one way to tell someone something.
 *
 * ── The contract every caller gets ─────────────────────────────────────────
 *
 *   1. A `Notification` row is written first. It is the record: who, what,
 *      which channel, and later why it failed.
 *   2. The send is attempted inline, with a timeout.
 *   3. Success marks the row SENT. Failure leaves it PENDING with the reason in
 *      `error`, so the queue drainer retries it and the panel can show why.
 *
 * That is deliberately different from the campaign path, which only writes rows
 * and lets the cron do all the sending. A campaign is 2,000 messages and no
 * deadline; a password reset is one message and the customer is waiting. Same
 * table, two tempos.
 *
 * ── Nothing here throws ────────────────────────────────────────────────────
 *
 * A mail provider having a bad minute must not fail a checkout. Every function
 * returns void and swallows its errors into the row. Callers use `void
 * notify...()` where latency matters (order placement, status change) and
 * `await` only for the admin "send test" button, where the operator is waiting
 * for an answer.
 */

import { prisma } from '../../config/database.js';
import { getSettings, getStoreProfile } from '../settings.service.js';
import { sendEmail, mailConfigured } from './mailer.js';
import { sendTelegram, telegramConfigured, escapeTelegram } from './telegram.js';
import { renderEmail, type Lang, type TemplateKey } from './templates.js';

export { sendEmail, mailConfigured } from './mailer.js';
export { sendTelegram, telegramConfigured, escapeTelegram, telegramChatId } from './telegram.js';
export { renderEmail, itemsTable, DEFAULT_TEMPLATES, type TemplateKey, type Lang } from './templates.js';

/** `'true'` is the default for every switch — an unset key must not silence mail. */
function enabled(value: string | undefined): boolean {
  return value !== 'false';
}

export interface EmailRequest {
  /** Dotted, stable: `order_confirmation`, `password_reset`. */
  type: string;
  template: TemplateKey;
  lang: Lang;
  /** Null/empty means "we have no address", which is a skip, not an error. */
  to: string | null | undefined;
  vars: Record<string, string>;
  /** Keys whose values are markup and must not be escaped. */
  raw?: readonly string[];
  /** Set when the recipient is a registered user, for the audit trail. */
  recipientId?: string | null;
}

/**
 * Renders, records and sends one email.
 *
 * The row is written even when the transport is unconfigured. "We intended to
 * tell this customer and could not" is exactly the fact a shop needs to see
 * after a migration to a new host — deleting the evidence to keep the table
 * clean would hide the outage.
 */
export async function notifyEmail(request: EmailRequest): Promise<void> {
  const to = request.to?.trim();
  if (!to) return;

  try {
    const [rendered, settings] = await Promise.all([
      renderEmail(request.template, request.lang, request.vars, request.raw ?? []),
      getSettings(),
    ]);

    const row = await prisma.notification.create({
      data: {
        type: request.type,
        recipientId: request.recipientId ?? null,
        channel: 'EMAIL',
        toEmail: to,
        subject: rendered.subject,
        // The plain-text version is stored: the panel shows this, and a wall of
        // table markup in a report is unreadable.
        body: rendered.text,
        status: 'PENDING',
      },
      select: { id: true },
    });

    if (!enabled(settings['notify.emailEnabled'])) {
      await markFailed(row.id, 'email notifications are switched off in settings');
      return;
    }

    if (!mailConfigured()) {
      await markFailed(row.id, 'RESEND_API_KEY or MAIL_FROM is not set');
      return;
    }

    const result = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (result.ok) {
      await prisma.notification.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, error: null },
      });
    } else {
      await markFailed(row.id, result.reason ?? 'send failed');
    }
  } catch (error) {
    /**
     * A database failure here must not surface as a failed order. Log and move
     * on: the order is the important record, the email is not.
     */
    console.error('[notify] email failed', error instanceof Error ? error.message : error);
  }
}

async function markFailed(id: string, reason: string): Promise<void> {
  await prisma.notification
    .update({
      where: { id },
      data: { status: 'PENDING', error: reason.slice(0, 190), attempts: { increment: 1 } },
    })
    .catch(() => undefined);
}

// ─── Admin alerts ──────────────────────────────────────────────────────────

/** The address that receives "a new order came in", from settings then contact. */
export async function adminEmail(): Promise<string | null> {
  const settings = await getSettings();
  return settings['notify.adminEmail']?.trim() || settings['contact.supportEmail']?.trim() || null;
}

/**
 * Alerts the shop, not the customer.
 *
 * Email and Telegram are independent: a shop with no Resend key still gets the
 * Telegram ping, and vice versa. One channel being down must not silence the
 * other — that is the whole reason to have two.
 */
export async function notifyAdmins(request: {
  type: string;
  template: TemplateKey;
  lang: Lang;
  vars: Record<string, string>;
  raw?: readonly string[];
  telegram?: string;
}): Promise<void> {
  const [settings, to] = await Promise.all([getSettings(), adminEmail()]);

  if (enabled(settings['notify.emailEnabled']) && to) {
    await notifyEmail({
      type: request.type,
      template: request.template,
      lang: request.lang,
      to,
      vars: request.vars,
      raw: request.raw,
      recipientId: null,
    });
  }

  if (request.telegram && enabled(settings['notify.telegramEnabled'])) {
    await notifyTelegram(request.telegram);
  }
}

// ─── Telegram ──────────────────────────────────────────────────────────────

/**
 * Sends one Telegram message and records it.
 *
 * Telegram has no address, so the row's `toEmail`/`toPhone` stay null and the
 * chat id goes in `error` on failure — it is the one field an operator needs to
 * fix. Success stores the chat id in `subject`, which makes "which group got
 * this" answerable from the table.
 */
export async function notifyTelegram(text: string, chatIdOverride?: string): Promise<void> {
  try {
    const settings = await getSettings();
    if (!enabled(settings['notify.telegramEnabled'])) return;

    const row = await prisma.notification.create({
      data: {
        type: 'telegram_alert',
        recipientId: null,
        channel: 'PUSH',
        subject: chatIdOverride ?? settings['notify.telegramChatId'] ?? null,
        body: text,
        status: 'PENDING',
      },
      select: { id: true },
    });

    if (!telegramConfigured()) {
      await markFailed(row.id, 'TELEGRAM_BOT_TOKEN is not set');
      return;
    }

    const result = await sendTelegram(text, chatIdOverride);

    if (result.ok) {
      await prisma.notification.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, error: null },
      });
    } else {
      await markFailed(row.id, result.reason ?? 'send failed');
    }
  } catch (error) {
    console.error('[notify] telegram failed', error instanceof Error ? error.message : error);
  }
}

/** Escapes a value for the HTML parse mode. Re-exported for call sites. */
export const tgEscape = escapeTelegram;

/**
 * An absolute URL on the storefront, built from the shop's own domain setting.
 *
 * An email is read outside the browser that placed the order, so a relative link
 * is useless — the customer's mail client has no idea where the shop lives. The
 * domain comes from settings rather than an env var because it is the same value
 * the storefront renders in its canonical tag; one source, so a rebrand cannot
 * leave emails pointing at the old address.
 */
export async function shopUrl(path: string): Promise<string> {
  const store = await getStoreProfile();
  const host = store.domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * ৳1,234 — for email bodies.
 *
 * Lakh grouping, matching every other surface in this project. Written here
 * rather than imported from the storefront because the API has no `format.ts`
 * and an email is the one place a raw poisha number would reach a customer.
 */
export function formatTaka(poisha: number): string {
  return `৳${new Intl.NumberFormat('en-IN').format(Math.round(poisha / 100))}`;
}

/**
 * Order status, in both languages.
 *
 * An email that says "your order is now SHIPPED" reads like a database dump.
 * The enum stays the key; this is the only place it becomes prose.
 */
export const STATUS_LABELS: Record<string, { en: string; bn: string }> = {
  PENDING: { en: 'Pending', bn: 'অপেক্ষমাণ' },
  CONFIRMED: { en: 'Confirmed', bn: 'নিশ্চিত হয়েছে' },
  PROCESSING: { en: 'Being packed', bn: 'প্যাকিং চলছে' },
  SHIPPED: { en: 'Shipped', bn: 'পাঠানো হয়েছে' },
  DELIVERED: { en: 'Delivered', bn: 'ডেলিভারি হয়েছে' },
  CANCELLED: { en: 'Cancelled', bn: 'বাতিল হয়েছে' },
  RETURNED: { en: 'Returned', bn: 'ফেরত এসেছে' },
  REFUND_PENDING: { en: 'Refund pending', bn: 'রিফান্ড অপেক্ষমাণ' },
  REFUNDED: { en: 'Refunded', bn: 'রিফান্ড হয়েছে' },
};

/** The label for a status, falling back to the raw value rather than blank. */
export function statusLabel(status: string, lang: Lang): string {
  const entry = STATUS_LABELS[status];
  if (!entry) return status;
  return lang === 'bn' ? entry.bn : entry.en;
}
