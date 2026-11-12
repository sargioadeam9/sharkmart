/**
 * Dashboard aggregates — `/api/v1/admin/dashboard`.
 *
 * The rule this file exists to satisfy: "Every number from a real endpoint. If
 * an aggregate is missing, add it to the admin API; do not compute it in the
 * browser from a list endpoint."
 *
 * So every figure below is a database aggregate, computed server-side, over the
 * whole dataset. The browser receives finished numbers and renders them.
 *
 * ── What is NOT here, and why ───────────────────────────────────────────────
 *
 * The reference dashboard shows "Estimated profit" and a margin percentage. This
 * schema has no cost field on `Product` — no `costPoisha`, no supplier cost, no
 * landed cost. Profit is therefore not computable from the data that exists, and
 * inventing a margin (revenue × 0.234, as the mock does) would be a fabricated
 * number on a dashboard an operator makes decisions from.
 *
 * So the KPI slot holds "Delivered revenue" instead — money actually collected,
 * which the schema can prove — and the profit card is omitted until a cost field
 * exists. Recorded in HANDOFF.md as a schema gap, not silently faked.
 *
 * ── Date ranges ─────────────────────────────────────────────────────────────
 *
 * `from`/`to` are ISO dates. A range is inclusive of both days, and the end is
 * pushed to 23:59:59.999 so "today" includes the orders placed a minute ago.
 * Weeks start Saturday (AGENTS.md landmine #8) — that matters for the calendar
 * the range picker opens, not for the arithmetic here, but the `custom` range
 * the client sends is already Saturday-aligned by the time it arrives.
 */

import { Prisma, type OrderStatus } from '@prisma/client';
import { prisma } from '../../config/database.js';

/** The statuses that count as money earned. */
const REVENUE_STATUSES: OrderStatus[] = ['DELIVERED'];

/** Statuses that represent live work in the pipeline. */
const PIPELINE_STATUSES: OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
];

export interface Range {
  from: Date;
  to: Date;
}

/**
 * Resolves a range preset into concrete dates.
 *
 * `today` is a single day, `7d`/`30d` are the last N days *including* today
 * (so `7d` spans 7 calendar days, not 8), and `custom` uses the supplied pair.
 * Everything is computed in server local time, which for this deployment is
 * Asia/Dhaka — the same clock the orders were placed on.
 */
export function resolveRange(preset: string, from?: string, to?: string): Range {
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const startOfDaysAgo = (days: number): Date => {
    const start = new Date(now);
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
    return start;
  };

  switch (preset) {
    case 'today':
      return { from: startOfDaysAgo(1), to: endOfToday };
    case '7d':
      return { from: startOfDaysAgo(7), to: endOfToday };
    case '30d':
      return { from: startOfDaysAgo(30), to: endOfToday };
    case 'custom': {
      // A custom range with a missing or unparseable bound falls back to 30d
      // rather than throwing — the range picker can send a half-filled form.
      const start = from ? new Date(from) : null;
      const end = to ? new Date(to) : null;
      if (!start || Number.isNaN(start.getTime())) return { from: startOfDaysAgo(30), to: endOfToday };
      start.setHours(0, 0, 0, 0);
      if (!end || Number.isNaN(end.getTime())) return { from: start, to: endOfToday };
      end.setHours(23, 59, 59, 999);
      // A reversed range is a UI slip; swap rather than return nothing.
      return start <= end ? { from: start, to: end } : { from: end, to: start };
    }
    default:
      return { from: startOfDaysAgo(7), to: endOfToday };
  }
}

/** The four KPI cards. */
export async function kpis(range: Range) {
  const inRange = { createdAt: { gte: range.from, lte: range.to } };

  const [revenueAgg, orderCount, deliveredCount, cancelledCount, paidAgg] = await Promise.all([
    // Delivered revenue: money actually collected, not money ordered.
    prisma.order.aggregate({
      where: { ...inRange, currentStatus: { in: REVENUE_STATUSES } },
      _sum: { totalAmountPoisha: true },
      _count: true,
    }),
    prisma.order.count({ where: inRange }),
    prisma.order.count({ where: { ...inRange, currentStatus: 'DELIVERED' } }),
    prisma.order.count({ where: { ...inRange, currentStatus: 'CANCELLED' } }),
    // Online money received, regardless of delivery state.
    prisma.order.aggregate({
      where: { ...inRange, paymentStatus: 'PAID' },
      _sum: { paidAmountPoisha: true },
    }),
  ]);

  const revenuePoisha = revenueAgg._sum.totalAmountPoisha ?? 0;
  const delivered = deliveredCount;

  return {
    revenuePoisha,
    orderCount,
    deliveredCount: delivered,
    cancelledCount,
    paidOnlinePoisha: paidAgg._sum.paidAmountPoisha ?? 0,
    /**
     * Average order value over delivered orders only — dividing by all orders
     * would drag the average down with cancellations that never earned anything.
     */
    averageOrderPoisha: delivered > 0 ? Math.round(revenuePoisha / delivered) : 0,
  };
}

/** Orders per day across the range, for the bar chart. */
export async function salesSeries(range: Range) {
  /**
   * Raw SQL rather than a Prisma `groupBy`: grouping by DATE(createdAt) needs a
   * date function, which `groupBy` cannot express. The range is parameterised,
   * not interpolated — `Prisma.sql` handles the binding.
   */
  const rows = await prisma.$queryRaw<Array<{ day: Date; orders: bigint; revenue: bigint }>>`
    SELECT DATE(o.createdAt) AS day,
           COUNT(*) AS orders,
           COALESCE(SUM(CASE WHEN o.currentStatus = 'DELIVERED' THEN o.totalAmountPoisha ELSE 0 END), 0) AS revenue
    FROM \`Order\` o
    WHERE o.createdAt >= ${range.from} AND o.createdAt <= ${range.to}
    GROUP BY DATE(o.createdAt)
    ORDER BY day ASC
  `;

  return rows.map((row) => ({
    // `DATE()` comes back as a Date at midnight; the ISO date part is what the
    // chart's x-axis wants.
    date: row.day.toISOString().slice(0, 10),
    orders: Number(row.orders),
    revenuePoisha: Number(row.revenue),
  }));
}

/** The order pipeline — how many orders sit at each status right now. */
export async function pipeline() {
  const grouped = await prisma.order.groupBy({
    by: ['currentStatus'],
    _count: true,
    where: { currentStatus: { in: PIPELINE_STATUSES } },
  });

  const counts = new Map<string, number>();
  for (const row of grouped) counts.set(row.currentStatus, row._count);

  // Every pipeline status is present in the response, including the zeroes —
  // a stage that vanished from the chart because it was empty would read as a
  // missing stage rather than an empty one.
  return PIPELINE_STATUSES.map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}

/**
 * "Needs attention" — the things an operator should look at first.
 *
 * Each item is a real query. The list is ordered by how much it costs to ignore:
 * unfulfilled paid orders first, then stockouts, then stuck orders.
 */
export async function needsAttention() {
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

  const [unfulfilledPaid, lowStock, stuckPending, pendingReviews] = await Promise.all([
    // Paid but not shipped — the customer has parted with money.
    prisma.order.count({
      where: {
        paymentStatus: 'PAID',
        currentStatus: { in: ['PENDING', 'CONFIRMED', 'PROCESSING'] },
      },
    }),
    // Variants at or below 5 units. `stock` is on the variant, not the product.
    prisma.productVariant.count({ where: { isActive: true, stock: { lte: 5 } } }),
    // Pending for more than 48 hours — nobody confirmed them.
    prisma.order.count({ where: { currentStatus: 'PENDING', createdAt: { lte: twoDaysAgo } } }),
    // Reviews awaiting moderation.
    prisma.review.count({ where: { isApproved: false } }),
  ]);

  return [
    {
      key: 'unfulfilled_paid',
      labelEn: 'Paid orders not yet shipped',
      labelBn: 'পেমেন্ট হয়েছে, এখনো পাঠানো হয়নি',
      count: unfulfilledPaid,
      href: '/admin/orders?payment=PAID&status=PROCESSING',
      severity: unfulfilledPaid > 0 ? 'high' : 'ok',
    },
    {
      key: 'low_stock',
      labelEn: 'Variants at 5 units or fewer',
      labelBn: '৫ বা তার কম স্টক',
      count: lowStock,
      href: '/admin/inventory?filter=low',
      severity: lowStock > 0 ? 'warn' : 'ok',
    },
    {
      key: 'stuck_pending',
      labelEn: 'Pending for more than 48 hours',
      labelBn: '৪৮ ঘণ্টার বেশি পেন্ডিং',
      count: stuckPending,
      href: '/admin/orders?status=PENDING',
      severity: stuckPending > 0 ? 'high' : 'ok',
    },
    {
      key: 'pending_reviews',
      labelEn: 'Reviews awaiting moderation',
      labelBn: 'পর্যালোচনা অপেক্ষমাণ',
      count: pendingReviews,
      href: '/admin/reviews?status=pending',
      severity: pendingReviews > 0 ? 'warn' : 'ok',
    },
  ];
}

/** Recent orders for the dashboard table. */
export async function recentOrders(limit = 8) {
  const rows = await prisma.order.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      orderNumber: true,
      currentStatus: true,
      paymentStatus: true,
      paymentMethod: true,
      totalAmountPoisha: true,
      createdAt: true,
      guestName: true,
      user: { select: { name: true } },
      shippingAddress: { select: { recipientName: true, district: true } },
      _count: { select: { items: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.currentStatus,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    totalPoisha: row.totalAmountPoisha,
    itemCount: row._count.items,
    // A guest order has no user row; the shipping address is the reliable name.
    customerName: row.user?.name ?? row.shippingAddress?.recipientName ?? row.guestName ?? 'Guest',
    district: row.shippingAddress?.district ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Best sellers by units sold, over the range, delivered orders only. */
export async function bestSellers(range: Range, limit = 5) {
  const rows = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: {
      order: {
        createdAt: { gte: range.from, lte: range.to },
        currentStatus: { in: REVENUE_STATUSES },
      },
    },
    _sum: { quantity: true, lineTotalPoisha: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: limit,
  });

  if (rows.length === 0) return [];

  // One query for the names, rather than N queries in a loop.
  const products = await prisma.product.findMany({
    where: { id: { in: rows.map((row) => row.productId) } },
    select: { id: true, nameEn: true, nameBn: true, slug: true, sku: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  return rows.map((row) => {
    const product = byId.get(row.productId);
    return {
      productId: row.productId,
      nameEn: product?.nameEn ?? 'Unknown product',
      nameBn: product?.nameBn ?? 'অজানা পণ্য',
      slug: product?.slug ?? null,
      sku: product?.sku ?? null,
      unitsSold: row._sum.quantity ?? 0,
      revenuePoisha: row._sum.lineTotalPoisha ?? 0,
    };
  });
}

/**
 * Courier delivery rates.
 *
 * "Rate" is delivered ÷ (delivered + returned) per courier — the share of
 * consignments that actually completed. Orders with no courier yet are excluded,
 * because an unbooked order is not a courier failure.
 */
export async function courierRates() {
  const rows = await prisma.order.groupBy({
    by: ['courierName', 'currentStatus'],
    where: { courierName: { not: null } },
    _count: true,
  });

  const byCourier = new Map<string, { delivered: number; returned: number; total: number }>();

  for (const row of rows) {
    const name = row.courierName as string;
    const entry = byCourier.get(name) ?? { delivered: 0, returned: 0, total: 0 };
    entry.total += row._count;
    if (row.currentStatus === 'DELIVERED') entry.delivered += row._count;
    if (row.currentStatus === 'RETURNED') entry.returned += row._count;
    byCourier.set(name, entry);
  }

  return [...byCourier.entries()]
    .map(([courier, stats]) => {
      const settled = stats.delivered + stats.returned;
      return {
        courier,
        delivered: stats.delivered,
        returned: stats.returned,
        total: stats.total,
        // No settled orders yet means no rate to report — null, not 0%, which
        // would read as "every delivery failed".
        deliveryRate: settled > 0 ? Math.round((stats.delivered / settled) * 1000) / 10 : null,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/** Everything the dashboard needs, in one round trip. */
export async function dashboardPayload(range: Range) {
  const [kpiData, series, pipelineData, attention, orders, sellers, couriers] = await Promise.all([
    kpis(range),
    salesSeries(range),
    pipeline(),
    needsAttention(),
    recentOrders(),
    bestSellers(range),
    courierRates(),
  ]);

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    kpis: kpiData,
    series,
    pipeline: pipelineData,
    needsAttention: attention,
    recentOrders: orders,
    bestSellers: sellers,
    couriers,
  };
}

/** Re-exported so the route can type its query without importing Prisma. */
export type { Prisma };
