/**
 * Sends the shop's day to Telegram. Maintenance tool — run it from cron.
 *
 * ── Why a script and not a scheduled job in the API ────────────────────────
 *
 * The API has no scheduler, and adding one (node-cron, a queue worker, a lock so
 * two processes do not both fire) is a lot of machinery for one message a day.
 * A cron line is one line and it survives a server restart, a redeploy and a
 * crashed process.
 *
 *     # every day at 22:00 Dhaka time (server clock in UTC -> 16:00)
 *     0 16 * * * cd /path/to/app && node tools/notify-daily.mjs >> logs/daily.log 2>&1
 *
 * ── What it counts ────────────────────────────────────────────────────────
 *
 * "Today" means today in Dhaka, not UTC. A 23:30 order in Dhaka is 17:30 UTC the
 * same day, but a 01:00 order is 19:00 UTC *yesterday* — so the boundary is
 * computed from the shop's offset rather than from `new Date().setHours(0,0,0,0)`,
 * which would silently report the wrong day for six hours of every day.
 *
 * Cancelled orders are excluded from the takings and counted separately: a shop
 * that counts cancellations as revenue has a number that never matches its bank.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.join(here, '..', 'server');

const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
const { PrismaClient } = requireFromServer('@prisma/client');
requireFromServer('dotenv').config({ path: path.join(serverDir, '.env') });

const prisma = new PrismaClient();

/** Bangladesh Standard Time. No DST, which is why a constant is safe. */
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

function startOfTodayDhaka() {
  const shifted = new Date(Date.now() + DHAKA_OFFSET_MS);
  const midnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return new Date(midnightUtc - DHAKA_OFFSET_MS);
}

function taka(poisha) {
  return `৳${new Intl.NumberFormat('en-IN').format(Math.round(poisha / 100))}`;
}

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main() {
  const since = startOfTodayDhaka();

  const [orders, pending, settings] = await Promise.all([
    prisma.order.findMany({
      where: { createdAt: { gte: since } },
      select: {
        orderNumber: true,
        currentStatus: true,
        paymentMethod: true,
        totalAmountPoisha: true,
        items: { select: { nameEn: true, quantity: true } },
      },
    }),
    prisma.order.count({ where: { currentStatus: 'PENDING' } }),
    prisma.setting.findMany({
      where: { key: { in: ['notify.telegramChatId', 'notify.telegramEnabled'] } },
      select: { key: true, value: true },
    }),
  ]);

  const setting = (key) => settings.find((row) => row.key === key)?.value ?? '';

  if (setting('notify.telegramEnabled') === 'false') {
    console.log('telegram is switched off in settings; nothing sent.');
    return;
  }

  const chatId = setting('notify.telegramChatId') || process.env.TELEGRAM_CHAT_ID || '';
  const token = process.env.TELEGRAM_BOT_TOKEN || '';

  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set.');
    process.exitCode = 1;
    return;
  }
  if (!chatId) {
    console.error('No Telegram chat id: set it in Settings, or TELEGRAM_CHAT_ID.');
    process.exitCode = 1;
    return;
  }

  const live = orders.filter((order) => order.currentStatus !== 'CANCELLED');
  const cancelled = orders.length - live.length;
  const revenue = live.reduce((sum, order) => sum + order.totalAmountPoisha, 0);

  const byMethod = live.reduce((acc, order) => {
    acc[order.paymentMethod] = (acc[order.paymentMethod] ?? 0) + order.totalAmountPoisha;
    return acc;
  }, {});

  const productTotals = new Map();
  for (const order of live) {
    for (const item of order.items) {
      productTotals.set(item.nameEn, (productTotals.get(item.nameEn) ?? 0) + item.quantity);
    }
  }
  const top = [...productTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

  const day = new Date(Date.now() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);

  const lines = [
    `📊 <b>Daily summary — ${esc(day)}</b>`,
    '',
    `Orders: <b>${live.length}</b>${cancelled ? ` (+${cancelled} cancelled)` : ''}`,
    `Takings: <b>${esc(taka(revenue))}</b>`,
    `COD: ${esc(taka(byMethod.COD ?? 0))}`,
    `Online: ${esc(taka(revenue - (byMethod.COD ?? 0)))}`,
    `Awaiting confirmation: <b>${pending}</b>`,
  ];

  if (top.length > 0) {
    lines.push('', '<b>Top sellers</b>');
    for (const [name, quantity] of top) lines.push(`· ${esc(name)} × ${quantity}`);
  }

  if (live.length === 0) {
    lines.push('', 'No orders today.');
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: lines.join('\n'),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    console.error(`telegram ${response.status}: ${body?.description ?? 'no detail'}`);
    process.exitCode = 1;
    return;
  }

  console.log(`sent: ${live.length} orders, ${taka(revenue)}`);
}

main()
  .catch((error) => {
    console.error('FAILED:', error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
