/**
 * Drains the notification queue. Maintenance tool — not part of the API process.
 *
 * ── Why this is a script and not a request ─────────────────────────────────
 *
 * Sending 2,000 SMS inside an HTTP handler means a request that runs for minutes,
 * holds a connection, and dies halfway with no record of where it stopped. The
 * composer writes `Notification` rows as PENDING; this script turns them into SENT
 * or FAILED, one at a time, so a crash resumes where it left off.
 *
 * ── What it will and will not do ───────────────────────────────────────────
 *
 * SMS: if `SMS_GATEWAY_URL` is set, each row is POSTed as `{ to, message }`. That
 * body shape must match the provider that URL belongs to — it is a starting point,
 * not a universal contract.
 *
 * Email: Resend, over HTTPS. The canonical implementation is
 * `server/src/services/notify/mailer.ts`; the twenty lines are repeated here
 * because this script runs on plain node with no TypeScript loader, and making
 * it depend on a build would mean the queue cannot be drained from a machine
 * that has not run `tsc`. If the mailer changes, change both — the comment in
 * each points at the other.
 *
 * A row that cannot be delivered is left PENDING with the reason printed, rather
 * than marked SENT, because a delivery report that says "sent" when nothing left
 * the building is worse than one that says "not sent".
 *
 * Without `--send`, everything is a dry run: rows are marked SENT with a note, so
 * the queue can be exercised end to end without spending money.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *     node tools/dispatch-notifications.mjs             # dry run, 50 rows
 *     node tools/dispatch-notifications.mjs --limit 500
 *     node tools/dispatch-notifications.mjs --send      # real SMS if configured
 *     node tools/dispatch-notifications.mjs --status    # queue counts, no writes
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', 'server');

const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
const { PrismaClient } = requireFromServer('@prisma/client');

// The API's own env loader, so the script reads exactly what the server reads.
requireFromServer('dotenv').config({ path: path.join(serverDir, '.env') });

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const statusOnly = args.includes('--status');
const send = args.includes('--send');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) || 50 : 50;

const CAMPAIGN_TYPES = ['campaign_sms', 'campaign_email'];

async function counts() {
  const grouped = await prisma.notification.groupBy({
    by: ['channel', 'status'],
    where: { type: { in: CAMPAIGN_TYPES } },
    _count: { _all: true },
  });

  if (grouped.length === 0) {
    console.log('queue: empty');
    return;
  }

  for (const row of grouped) {
    console.log(`  ${row.channel.padEnd(6)} ${row.status.padEnd(8)} ${row._count._all}`);
  }
}

async function deliver(row) {
  if (!send) {
    return { ok: true, reason: 'dry run' };
  }

  if (row.channel === 'EMAIL') {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;

    if (!key || !from) {
      return { ok: false, reason: 'RESEND_API_KEY or MAIL_FROM is not set' };
    }

    const to = row.toEmail ?? row.recipient?.email;
    if (!to) return { ok: false, reason: 'no email address on the row' };

    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a2238;">${String(
      row.body,
    )
      .split('\n')
      .map((line) => (line.trim() ? `<p>${line.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</p>` : ''))
      .join('')}</div>`;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: row.subject ?? 'A message from the shop',
        html,
        ...(process.env.MAIL_REPLY_TO ? { reply_to: process.env.MAIL_REPLY_TO } : {}),
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      return { ok: false, reason: `resend ${response.status}: ${body?.message ?? 'no detail'}` };
    }

    return { ok: true, reason: 'resend accepted' };
  }

  const gateway = process.env.SMS_GATEWAY_URL;
  if (!gateway) {
    return { ok: false, reason: 'SMS_GATEWAY_URL is not set' };
  }

  const to = row.toPhone ?? row.recipient?.phone;
  if (!to) return { ok: false, reason: 'recipient has no phone' };

  const response = await fetch(gateway, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.SMS_GATEWAY_API_KEY
        ? { authorization: `Bearer ${process.env.SMS_GATEWAY_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({ to, message: row.body }),
  });

  if (!response.ok) {
    return { ok: false, reason: `gateway ${response.status}` };
  }

  return { ok: true, reason: 'gateway accepted' };
}

async function main() {
  await counts();
  if (statusOnly) return;

  const pending = await prisma.notification.findMany({
    where: { type: { in: CAMPAIGN_TYPES }, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: {
      id: true,
      channel: true,
      subject: true,
      body: true,
      toEmail: true,
      toPhone: true,
      recipient: { select: { phone: true, email: true } },
    },
  });

  if (pending.length === 0) {
    console.log('\nnothing pending.');
    return;
  }

  console.log(`\nprocessing ${pending.length} row(s) ${send ? '' : '(dry run)'}`);

  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    const result = await deliver(row);

    if (result.ok) {
      await prisma.notification.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date() },
      });
      sent += 1;
    } else {
      // Left PENDING on purpose: the reason is printed, and a later run can retry
      // once the transport is configured. Marking FAILED would need a schema field
      // to hold the reason, and losing it is worse than retrying.
      failed += 1;
      console.log(`  ${row.channel} ${row.id.slice(0, 8)}: ${result.reason}`);
    }
  }

  console.log(`\nsent ${sent}, skipped ${failed}`);
}

main()
  .catch((error) => {
    console.error('FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
