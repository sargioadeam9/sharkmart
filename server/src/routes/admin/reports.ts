/**
 * `/api/v1/admin/reports` — Phase 10 pass F.
 *
 * ── What "revenue" means here ──────────────────────────────────────────────
 *
 * `revenue` is the sum of `totalAmountPoisha` for orders that were **not**
 * cancelled or returned. It is money the shop expects or has received, not money
 * it has banked: COD is collected on delivery, and a SHIPPED order can still come
 * back. `deliveredRevenue` is the narrower figure for orders that actually
 * completed, and both are shown so nobody has to guess which one they are reading.
 *
 * ── Why there is no profit line ────────────────────────────────────────────
 *
 * `Product` has no cost field. `SupplierProduct.costPricePoisha` exists, but it is
 * the price from one supplier for one product and most products have no supplier
 * link — deriving a margin from it would be a guess dressed as an accounting
 * figure. Expenses are reported separately for the same reason: revenue minus
 * expenses is a cash view, not profit, and calling it profit would be a lie.
 *
 * ── Category and brand attribution ─────────────────────────────────────────
 *
 * `OrderItem` snapshots the product's name and SKU but not its category or brand,
 * so those rollups join the **current** `Product` row. If a product was moved to
 * another category last week, its older sales report under the new category. That
 * is a real limitation of the schema, stated here rather than discovered later.
 *
 * ── Streaming ──────────────────────────────────────────────────────────────
 *
 * The CSV export writes batches as it reads them (`take`/`skip` pages of 500) and
 * never materialises the whole result. A 50k-row export must not become a 50k-row
 * array in memory.
 */

import { Router } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ok } from '../../types/api.js';
import { prisma } from '../../config/database.js';

export const reportsRouter: Router = Router();

const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/);

const rangeQuery = z
  .object({
    from: day.optional(),
    to: day.optional(),
  })
  .strict();

const exportQuery = z
  .object({
    type: z.enum(['orders', 'products']),
    from: day.optional(),
    to: day.optional(),
  })
  .strict();

/** UTC start of a `YYYY-MM-DD`, or `days` ago when absent. */
function startOf(value: string | undefined, days: number, now = new Date()): Date {
  if (value) return new Date(`${value}T00:00:00.000Z`);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/** UTC start of the day after `to`, so the range is inclusive of `to`. */
function endOf(value: string | undefined, now = new Date()): Date {
  if (value) {
    const d = new Date(`${value}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d;
  }
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** MySQL returns COUNT/SUM as BigInt; JSON cannot serialise that. */
function num(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (value === null || value === undefined) return 0;
  return Number(value);
}

interface SummaryRow {
  orders: unknown;
  revenue: unknown;
  discount: unknown;
  delivery: unknown;
  delivered: unknown;
  deliveredRevenue: unknown;
}

interface SeriesRow {
  day: unknown;
  orders: unknown;
  revenue: unknown;
}

interface ProductRow {
  productId: string;
  nameEn: string;
  sku: string;
  qty: unknown;
  revenue: unknown;
}

interface GroupRow {
  id: string;
  name: string;
  qty: unknown;
  revenue: unknown;
}

export interface ReportPayload {
  from: string;
  to: string;
  summary: {
    orders: number;
    revenuePoisha: number;
    discountPoisha: number;
    deliveryPoisha: number;
    averageOrderPoisha: number;
    deliveredOrders: number;
    deliveredRevenuePoisha: number;
    expensesPoisha: number;
    revenueMinusExpensesPoisha: number;
  };
  series: Array<{ day: string; orders: number; revenuePoisha: number }>;
  topProducts: Array<{ productId: string; nameEn: string; sku: string; quantity: number; revenuePoisha: number }>;
  categories: Array<{ id: string; name: string; quantity: number; revenuePoisha: number }>;
  brands: Array<{ id: string; name: string; quantity: number; revenuePoisha: number }>;
}

reportsRouter.get('/', requirePermission('reports:read'), validate({ query: rangeQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof rangeQuery>;
    const from = startOf(query.from, 29);
    const to = endOf(query.to);

    const [summaryRows, seriesRows, productRows, categoryRows, brandRows, expenseRows] =
      await Promise.all([
        prisma.$queryRaw<SummaryRow[]>`
          SELECT COUNT(*) AS orders,
                 COALESCE(SUM(totalAmountPoisha), 0) AS revenue,
                 COALESCE(SUM(discountAmountPoisha), 0) AS discount,
                 COALESCE(SUM(deliveryChargePoisha), 0) AS delivery,
                 COALESCE(SUM(CASE WHEN currentStatus = 'DELIVERED' THEN 1 ELSE 0 END), 0) AS delivered,
                 COALESCE(SUM(CASE WHEN currentStatus = 'DELIVERED' THEN totalAmountPoisha ELSE 0 END), 0) AS deliveredRevenue
          FROM \`Order\`
          WHERE createdAt >= ${from} AND createdAt < ${to}
            AND currentStatus NOT IN ('CANCELLED', 'RETURNED')
        `,
        prisma.$queryRaw<SeriesRow[]>`
          SELECT DATE(createdAt) AS day, COUNT(*) AS orders, COALESCE(SUM(totalAmountPoisha), 0) AS revenue
          FROM \`Order\`
          WHERE createdAt >= ${from} AND createdAt < ${to}
            AND currentStatus NOT IN ('CANCELLED', 'RETURNED')
          GROUP BY DATE(createdAt)
          ORDER BY day ASC
        `,
        prisma.$queryRaw<ProductRow[]>`
          SELECT oi.productId AS productId,
                 MAX(oi.nameEn) AS nameEn,
                 MAX(oi.sku) AS sku,
                 SUM(oi.quantity) AS qty,
                 COALESCE(SUM(oi.lineTotalPoisha), 0) AS revenue
          FROM OrderItem oi
          JOIN \`Order\` o ON o.id = oi.orderId
          WHERE o.createdAt >= ${from} AND o.createdAt < ${to}
            AND o.currentStatus NOT IN ('CANCELLED', 'RETURNED')
          GROUP BY oi.productId
          ORDER BY revenue DESC
          LIMIT 10
        `,
        prisma.$queryRaw<GroupRow[]>`
          SELECT p.categoryId AS id,
                 MAX(c.nameEn) AS name,
                 SUM(oi.quantity) AS qty,
                 COALESCE(SUM(oi.lineTotalPoisha), 0) AS revenue
          FROM OrderItem oi
          JOIN \`Order\` o ON o.id = oi.orderId
          JOIN Product p ON p.id = oi.productId
          JOIN Category c ON c.id = p.categoryId
          WHERE o.createdAt >= ${from} AND o.createdAt < ${to}
            AND o.currentStatus NOT IN ('CANCELLED', 'RETURNED')
          GROUP BY p.categoryId
          ORDER BY revenue DESC
        `,
        prisma.$queryRaw<GroupRow[]>`
          SELECT COALESCE(p.brandId, 'none') AS id,
                 COALESCE(MAX(b.nameEn), 'No brand') AS name,
                 SUM(oi.quantity) AS qty,
                 COALESCE(SUM(oi.lineTotalPoisha), 0) AS revenue
          FROM OrderItem oi
          JOIN \`Order\` o ON o.id = oi.orderId
          JOIN Product p ON p.id = oi.productId
          LEFT JOIN Brand b ON b.id = p.brandId
          WHERE o.createdAt >= ${from} AND o.createdAt < ${to}
            AND o.currentStatus NOT IN ('CANCELLED', 'RETURNED')
          GROUP BY p.brandId
          ORDER BY revenue DESC
        `,
        prisma.$queryRaw<Array<{ total: unknown }>>`
          SELECT COALESCE(SUM(amountPoisha), 0) AS total
          FROM Expense
          WHERE date >= ${from} AND date < ${to}
        `,
      ]);

    const s = summaryRows[0];
    const orders = num(s?.orders);
    const revenue = num(s?.revenue);
    const expenses = num(expenseRows[0]?.total);

    const payload: ReportPayload = {
      from: from.toISOString().slice(0, 10),
      to: new Date(to.getTime() - 1).toISOString().slice(0, 10),
      summary: {
        orders,
        revenuePoisha: revenue,
        discountPoisha: num(s?.discount),
        deliveryPoisha: num(s?.delivery),
        averageOrderPoisha: orders === 0 ? 0 : Math.round(revenue / orders),
        deliveredOrders: num(s?.delivered),
        deliveredRevenuePoisha: num(s?.deliveredRevenue),
        expensesPoisha: expenses,
        revenueMinusExpensesPoisha: revenue - expenses,
      },
      series: seriesRows.map((row) => ({
        day: String(row.day).slice(0, 10),
        orders: num(row.orders),
        revenuePoisha: num(row.revenue),
      })),
      topProducts: productRows.map((row) => ({
        productId: row.productId,
        nameEn: row.nameEn,
        sku: row.sku,
        quantity: num(row.qty),
        revenuePoisha: num(row.revenue),
      })),
      categories: categoryRows.map((row) => ({
        id: row.id,
        name: row.name,
        quantity: num(row.qty),
        revenuePoisha: num(row.revenue),
      })),
      brands: brandRows.map((row) => ({
        id: row.id,
        name: row.name,
        quantity: num(row.qty),
        revenuePoisha: num(row.revenue),
      })),
    };

    res.json(ok(payload));
  } catch (error) {
    next(error);
  }
});

/** One CSV cell, quoted when it could break the row. */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * CSV export, streamed.
 *
 * Rows are read in pages of 500 and written as they arrive; the response is never
 * assembled in memory. `res.flushHeaders()` sends the header early so the browser
 * starts downloading before the first page is even queried.
 */
reportsRouter.get(
  '/export',
  requirePermission('reports:read'),
  validate({ query: exportQuery }),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof exportQuery>;
      const from = startOf(query.from, 29);
      const to = endOf(query.to);
      const stamp = `${from.toISOString().slice(0, 10)}_${new Date(to.getTime() - 1)
        .toISOString()
        .slice(0, 10)}`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="report-${query.type}-${stamp}.csv"`);
      // Excel needs a BOM to read UTF-8 (Bangla product names) correctly.
      res.write('\uFEFF');

      if (query.type === 'orders') {
        res.write('orderNumber,date,status,paymentStatus,subtotal,discount,delivery,total\n');

        const pageSize = 500;
        for (let page = 0; ; page += 1) {
          const rows = await prisma.$queryRaw<
            Array<{
              orderNumber: string;
              createdAt: Date;
              currentStatus: string;
              paymentStatus: string;
              subtotalPoisha: number;
              discountAmountPoisha: number;
              deliveryChargePoisha: number;
              totalAmountPoisha: number;
            }>
          >`
            SELECT orderNumber, createdAt, currentStatus, paymentStatus,
                   subtotalPoisha, discountAmountPoisha, deliveryChargePoisha, totalAmountPoisha
            FROM \`Order\`
            WHERE createdAt >= ${from} AND createdAt < ${to}
            ORDER BY createdAt ASC
            LIMIT ${pageSize} OFFSET ${page * pageSize}
          `;

          if (rows.length === 0) break;

          for (const row of rows) {
            res.write(
              [
                cell(row.orderNumber),
                cell(row.createdAt.toISOString().slice(0, 19).replace('T', ' ')),
                cell(row.currentStatus),
                cell(row.paymentStatus),
                (row.subtotalPoisha / 100).toFixed(2),
                (row.discountAmountPoisha / 100).toFixed(2),
                (row.deliveryChargePoisha / 100).toFixed(2),
                (row.totalAmountPoisha / 100).toFixed(2),
              ].join(',') + '\n',
            );
          }

          if (rows.length < pageSize) break;
        }
      } else {
        res.write('product,sku,quantity,revenue\n');

        const pageSize = 500;
        for (let page = 0; ; page += 1) {
          const rows = await prisma.$queryRaw<
            Array<{ nameEn: string; sku: string; qty: unknown; revenue: unknown }>
          >`
            SELECT MAX(oi.nameEn) AS nameEn, MAX(oi.sku) AS sku,
                   SUM(oi.quantity) AS qty, COALESCE(SUM(oi.lineTotalPoisha), 0) AS revenue
            FROM OrderItem oi
            JOIN \`Order\` o ON o.id = oi.orderId
            WHERE o.createdAt >= ${from} AND o.createdAt < ${to}
              AND o.currentStatus NOT IN ('CANCELLED', 'RETURNED')
            GROUP BY oi.productId
            ORDER BY revenue DESC
            LIMIT ${pageSize} OFFSET ${page * pageSize}
          `;

          if (rows.length === 0) break;

          for (const row of rows) {
            res.write(
              [cell(row.nameEn), cell(row.sku), num(row.qty), (num(row.revenue) / 100).toFixed(2)].join(
                ',',
              ) + '\n',
            );
          }

          if (rows.length < pageSize) break;
        }
      }

      res.end();
    } catch (error) {
      // Headers are already sent, so the error handler cannot write a JSON body.
      // Ending the stream is the honest signal: the file will be short.
      if (res.headersSent) {
        res.end();
        return;
      }
      next(error);
    }
  },
);
