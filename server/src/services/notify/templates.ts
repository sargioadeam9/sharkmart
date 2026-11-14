/**
 * Transactional email templates.
 *
 * ── Defaults in code, copy in the database ─────────────────────────────────
 *
 * A fresh install has to be able to send a password reset before anyone has
 * opened the admin panel, so every template has a working default here. The
 * operator can override any of them: `renderEmail()` looks the key up in
 * `EmailTemplate` first and falls back to this file. That is the same shape as
 * `settings.service.ts` — code owns a valid default, the database owns the
 * shop's version of it.
 *
 * ── Why the body is HTML with `{{placeholders}}` ───────────────────────────
 *
 * The people editing these are shop operators, not developers. A row of
 * `{{orderNumber}}` is something they can move around in the panel; a React
 * component is not. The interpolation escapes every value by default, because
 * the values include a customer's name and address — a name containing `<` must
 * not be able to break the markup. Values that are themselves markup (the item
 * table) are listed in `raw` by the caller.
 */

import { prisma } from '../../config/database.js';
import { getStoreProfile } from '../settings.service.js';

/** The server has no shared language type; the shop ships two. */
export type Lang = 'en' | 'bn';

export type TemplateKey =
  | 'password_reset'
  | 'order_confirmation'
  | 'order_status'
  | 'order_cancelled'
  | 'admin_new_order';

interface TemplateDefault {
  name: string;
  subjectEn: string;
  subjectBn: string;
  bodyEn: string;
  bodyBn: string;
  type: 'TRANSACTIONAL';
}

/**
 * The shipped copy.
 *
 * Written to be short. A confirmation email that repeats the entire order in
 * three colours is a confirmation email nobody reads; the order number, the
 * total and what happens next is the whole message.
 */
export const DEFAULT_TEMPLATES: Record<TemplateKey, TemplateDefault> = {
  password_reset: {
    name: 'Password reset',
    subjectEn: 'Reset your {{shopName}} password',
    subjectBn: '{{shopName}} পাসওয়ার্ড রিসেট করুন',
    bodyEn:
      '<p>Hello {{customerName}},</p>' +
      '<p>Someone asked to reset the password on your {{shopName}} account. If it was you, use the button below — the link works once and expires in {{expiresMinutes}} minutes.</p>' +
      '<p><a class="btn" href="{{resetUrl}}">Choose a new password</a></p>' +
      '<p class="muted">If you did not ask for this, you can ignore this email. Your password has not changed.</p>',
    bodyBn:
      '<p>প্রিয় {{customerName}},</p>' +
      '<p>আপনার {{shopName}} অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ এসেছে। আপনি করে থাকলে নিচের বাটনে ক্লিক করুন — লিংকটি একবারই কাজ করবে এবং {{expiresMinutes}} মিনিট পর্যন্ত বৈধ।</p>' +
      '<p><a class="btn" href="{{resetUrl}}">নতুন পাসওয়ার্ড দিন</a></p>' +
      '<p class="muted">আপনি অনুরোধ না করে থাকলে এই ইমেইলটি উপেক্ষা করুন। আপনার পাসওয়ার্ড বদলায়নি।</p>',
    type: 'TRANSACTIONAL',
  },

  order_confirmation: {
    name: 'Order confirmation',
    subjectEn: 'Order {{orderNumber}} received',
    subjectBn: 'অর্ডার {{orderNumber}} গ্রহণ করা হয়েছে',
    bodyEn:
      '<p>Hello {{customerName}},</p>' +
      '<p>We have your order <strong>{{orderNumber}}</strong> and will call to confirm it before dispatch.</p>' +
      '{{itemsTable}}' +
      '<p class="total">Total: <strong>{{total}}</strong> ({{paymentMethod}})</p>' +
      '<p class="muted">You can check the status any time with your order number and phone number.</p>',
    bodyBn:
      '<p>প্রিয় {{customerName}},</p>' +
      '<p>আপনার অর্ডার <strong>{{orderNumber}}</strong> আমরা পেয়েছি। পাঠানোর আগে ফোন করে নিশ্চিত করব।</p>' +
      '{{itemsTable}}' +
      '<p class="total">মোট: <strong>{{total}}</strong> ({{paymentMethod}})</p>' +
      '<p class="muted">অর্ডার নম্বর ও মোবাইল নম্বর দিয়ে যেকোনো সময় অবস্থা দেখতে পারবেন।</p>',
    type: 'TRANSACTIONAL',
  },

  order_status: {
    name: 'Order status changed',
    subjectEn: 'Order {{orderNumber}} — {{statusLabel}}',
    subjectBn: 'অর্ডার {{orderNumber}} — {{statusLabel}}',
    bodyEn:
      '<p>Hello {{customerName}},</p>' +
      '<p>Your order <strong>{{orderNumber}}</strong> is now <strong>{{statusLabel}}</strong>.</p>' +
      '{{statusNote}}' +
      '<p class="muted">Total {{total}}. Reply to this email if anything looks wrong.</p>',
    bodyBn:
      '<p>প্রিয় {{customerName}},</p>' +
      '<p>আপনার অর্ডার <strong>{{orderNumber}}</strong> এখন <strong>{{statusLabel}}</strong>।</p>' +
      '{{statusNote}}' +
      '<p class="muted">মোট {{total}}। কিছু ভুল মনে হলে এই ইমেইলে উত্তর দিন।</p>',
    type: 'TRANSACTIONAL',
  },

  order_cancelled: {
    name: 'Order cancelled',
    subjectEn: 'Order {{orderNumber}} cancelled',
    subjectBn: 'অর্ডার {{orderNumber}} বাতিল হয়েছে',
    bodyEn:
      '<p>Hello {{customerName}},</p>' +
      '<p>Your order <strong>{{orderNumber}}</strong> has been cancelled. If you paid online, the refund goes back the way it came.</p>' +
      '<p class="muted">Changed your mind? The items are still on the site.</p>',
    bodyBn:
      '<p>প্রিয় {{customerName}},</p>' +
      '<p>আপনার অর্ডার <strong>{{orderNumber}}</strong> বাতিল করা হয়েছে। অনলাইনে পেমেন্ট করে থাকলে টাকা সেই পথেই ফেরত যাবে।</p>' +
      '<p class="muted">আবার অর্ডার করতে চাইলে পণ্যগুলো সাইটেই আছে।</p>',
    type: 'TRANSACTIONAL',
  },

  admin_new_order: {
    name: 'New order (admin)',
    subjectEn: 'New order {{orderNumber}} — {{total}}',
    subjectBn: 'নতুন অর্ডার {{orderNumber}} — {{total}}',
    bodyEn:
      '<p>A new order came in.</p>' +
      '<p><strong>{{orderNumber}}</strong> · {{total}} · {{paymentMethod}}</p>' +
      '<p>{{customerName}} · {{customerPhone}}<br>{{address}}</p>' +
      '{{itemsTable}}',
    bodyBn:
      '<p>নতুন অর্ডার এসেছে।</p>' +
      '<p><strong>{{orderNumber}}</strong> · {{total}} · {{paymentMethod}}</p>' +
      '<p>{{customerName}} · {{customerPhone}}<br>{{address}}</p>' +
      '{{itemsTable}}',
    type: 'TRANSACTIONAL',
  },
};

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Escapes a value for interpolation. Every var is escaped unless listed in `raw`. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fill(template: string, vars: Record<string, string>, raw: readonly string[]): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return raw.includes(name) ? value : escapeHtml(value);
  });
}

/**
 * A crude text alternative — enough to keep the message out of spam filters.
 *
 * Links are rewritten to `label (url)` **before** the tags are stripped. Without
 * that step the plain-text part of a password reset reads "Choose a new
 * password" and carries no address at all — a customer whose mail client shows
 * text/plain has no way to continue, and that is the one email in this system
 * that has to work.
 */
function toText(html: string): string {
  return html
    .replace(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_match, href: string, label: string) => `${label.replace(/<[^>]+>/g, '').trim()} (${href})`,
    )
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|div|h1|h2)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The HTML shell.
 *
 * Inline styles and a table-free centred card: email clients strip `<style>`
 * blocks unpredictably (Outlook most of all), so anything that matters is on the
 * element. Width is capped at 600px, which is what every client renders without
 * a horizontal scroll.
 */
function shell(storeName: string, storeAddress: string, body: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:#f6f7fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2238;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e8eaf0;border-radius:14px;overflow:hidden;">
    <div style="background:#c51f4b;height:4px;"></div>
    <div style="padding:26px 28px;font-size:15px;line-height:1.65;">
      ${body}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #eef0f5;font-size:12px;color:#6b7490;">
      ${escapeHtml(storeName)} · ${escapeHtml(storeAddress)}
    </div>
  </div>
  <style>
    .btn { display:inline-block;background:#c51f4b;color:#fff !important;text-decoration:none;
           padding:11px 20px;border-radius:999px;font-weight:600;font-size:14px; }
    .muted { color:#6b7490;font-size:13px; }
    .total { font-size:16px; }
    table.items { width:100%;border-collapse:collapse;margin:14px 0;font-size:13.5px; }
    table.items td { padding:7px 0;border-bottom:1px solid #eef0f5; }
    table.items td.qty { text-align:center;width:44px;color:#6b7490; }
    table.items td.amt { text-align:right;white-space:nowrap; }
  </style>
</body></html>`;
}

/**
 * Renders one template for one recipient.
 *
 * The database row wins when it exists and has a non-empty body; otherwise the
 * shipped default is used. `shopName` is injected automatically so no caller has
 * to remember it, and `lang` picks the column — a Bengali customer gets the
 * Bengali copy even though the operator only ever sees one row.
 */
export async function renderEmail(
  key: TemplateKey,
  lang: Lang,
  vars: Record<string, string>,
  raw: readonly string[] = [],
): Promise<RenderedEmail> {
  const fallback = DEFAULT_TEMPLATES[key];

  const [row, store] = await Promise.all([
    prisma.emailTemplate.findUnique({
      where: { key },
      select: { subjectEn: true, subjectBn: true, bodyEn: true, bodyBn: true },
    }),
    getStoreProfile(),
  ]);

  const subjectTemplate =
    (lang === 'bn' ? row?.subjectBn : row?.subjectEn) || (lang === 'bn' ? fallback.subjectBn : fallback.subjectEn);
  const bodyTemplate =
    (lang === 'bn' ? row?.bodyBn : row?.bodyEn) || (lang === 'bn' ? fallback.bodyBn : fallback.bodyEn);

  const allVars = { ...vars, shopName: store.name };
  const allRaw = [...raw, 'itemsTable'];

  const subject = fill(subjectTemplate, allVars, allRaw);
  const body = fill(bodyTemplate, allVars, allRaw);

  return {
    subject,
    html: shell(store.name, store.address, body),
    text: toText(`${subject}\n\n${body}\n\n${store.name} · ${store.address}`),
  };
}

/** The item table used by the order templates. Built here, not in the copy. */
export function itemsTable(
  items: Array<{ name: string; quantity: number; lineTotal: string }>,
): string {
  const rows = items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.name)}</td><td class="qty">${item.quantity}</td><td class="amt">${escapeHtml(item.lineTotal)}</td></tr>`,
    )
    .join('');

  return `<table class="items">${rows}</table>`;
}
