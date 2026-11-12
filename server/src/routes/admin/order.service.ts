/**
 * Admin order service — list, detail, status change, bulk status, payment,
 * courier and notes.
 *
 * ── The four things that are easy to get wrong here ─────────────────────────
 *
 * **1. The status machine is the only authority.**
 *
 * `services/order-status.ts` already owns the transition table, because the
 * customer-facing cancel and return paths use it. This service does not
 * re-implement it and does not widen it: an admin moving PENDING → SHIPPED is
 * refused exactly as a customer would be, because the table says so. Staff have
 * a wider *permission* set, not a wider *state* set. The one thing staff can do
 * that a customer cannot is move money (REFUND_PENDING → REFUNDED), and that is
 * gated by `orders:refund`, not by a different table.
 *
 * **2. A status change and its history row are one transaction.**
 *
 * `OrderStatusHistory` is the order's timeline. A status that changed without a
 * history row is an order whose story has a hole in it, and the audit log is not
 * a substitute — it records who did it, not what the order's state became. Both
 * writes, plus the audit row, go through `withAudit()` so they commit together.
 *
 * **3. Cancelling or returning must put the stock back.**
 *
 * The customer path does this (`cancelOrder` in order.service.ts:899) with a
 * raw `UPDATE ... stock = stock + n, reservedStock = GREATEST(0, ...)`. The same
 * statement shape is used here, for the same reason: a symmetric ledger. If the
 * admin path forgot it, an order cancelled from the panel would silently lose
 * its units — the product would read as sold forever.
 *
 * **4. The list filter must not lie about `total`.**
 *
 * Every filter below is a real column predicate (`currentStatus`,
 * `paymentStatus`, `userId is null`, `createdAt` range) or a relation predicate
 * Prisma can push down (`user.name contains`). None of them requires a
 * post-filter, so the page query and the count query share one `where` and
 * `total` is honest. This is the opposite of the products list's stock filter,
 * which has to resolve an id set first — that complexity is not needed here and
 * is not copied in.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { withAudit, diffChanges } from '../../services/audit.service.js';
import { HttpError, notFound } from '../../middleware/errorHandler.js';
import {
  canTransition,
  releasesStock,
  transitionRefusal,
  type OrderStatus,
} from '../../services/order-status.js';
import {
  ADMIN_ORDER_DETAIL_SELECT,
  ADMIN_ORDER_LIST_SELECT,
  toAdminOrderDetail,
  toAdminOrderListItem,
  type AdminOrderDetail,
  type AdminOrderListItem,
  type AdminOrderListRow,
  type AdminOrderStatus,
} from '../../services/admin/order.admin.service.js';
import type {
  AdminOrderListInput,
  OrderBulkStatusInput,
  OrderCourierInput,
  OrderPaymentInput,
  OrderStatusInput,
} from '../../validators/adminOrder.schema.js';

/** Who is acting, and from where. Passed from the route, never guessed. */
export interface Actor {
  userId: string;
  ipAddress: string | null;
}

export interface AdminOrderListResult {
  items: AdminOrderListItem[];
  total: number;
  page: number;
  limit: number;
}

/**
 * The statuses an order may move to right now.
 *
 * Derived from the shared table so the drawer's dropdown and the API's check
 * cannot disagree. Exported because the detail mapper needs it and because the
 * test suite asserts against it directly.
 */
export function allowedTransitionsFrom(status: AdminOrderStatus): AdminOrderStatus[] {
  const candidates: AdminOrderStatus[] = [
    'PENDING',
    'CONFIRMED',
    'PROCESSING',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
    'RETURNED',
    'REFUND_PENDING',
    'REFUNDED',
  ];
  return candidates.filter((candidate) => canTransition(status as OrderStatus, candidate as OrderStatus));
}

// ─── Where ─────────────────────────────────────────────────────────────────

/**
 * The one `where` used by both the page query and the count.
 *
 * `q` spans order number, customer name, phone and email. Prisma resolves the
 * relation predicates as a join, so this stays a single SQL round trip per
 * query rather than a scan in JS.
 */
function whereFor(query: AdminOrderListInput): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};

  if (query.status !== 'all') where.currentStatus = query.status;
  if (query.paymentStatus !== 'all') where.paymentStatus = query.paymentStatus;

  if (query.customerType === 'guest') where.userId = null;
  if (query.customerType === 'registered') where.userId = { not: null };

  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
    // `to` is inclusive of the whole day, so it becomes the last millisecond of
    // that date rather than midnight (which would exclude everything on it).
    if (query.to) where.createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);
  }

  if (query.q) {
    const term = query.q;
    where.OR = [
      { orderNumber: { contains: term } },
      { guestName: { contains: term } },
      { guestPhone: { contains: term } },
      { user: { is: { name: { contains: term } } } },
      { user: { is: { email: { contains: term } } } },
      { user: { is: { phone: { contains: term } } } },
      { shippingAddress: { is: { recipientName: { contains: term } } } },
      { shippingAddress: { is: { phone: { contains: term } } } },
    ];
  }

  return where;
}

function orderByFor(sort: AdminOrderListInput['sort']): Prisma.OrderOrderByWithRelationInput {
  switch (sort) {
    case 'oldest':
      return { createdAt: 'asc' };
    case 'total_desc':
      return { totalAmountPoisha: 'desc' };
    case 'total_asc':
      return { totalAmountPoisha: 'asc' };
    case 'newest':
    default:
      return { createdAt: 'desc' };
  }
}

// ─── List ──────────────────────────────────────────────────────────────────

export async function listAdminOrders(query: AdminOrderListInput): Promise<AdminOrderListResult> {
  const where = whereFor(query);
  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: ADMIN_ORDER_LIST_SELECT,
      orderBy: orderByFor(query.sort),
      skip,
      take: query.limit,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    items: (rows as AdminOrderListRow[]).map(toAdminOrderListItem),
    total,
    page: query.page,
    limit: query.limit,
  };
}

/**
 * The counts for the status tabs.
 *
 * One `groupBy`, not nine counts. The tabs render "All 199 · Pending 152 · …"
 * and each number must match what clicking that tab returns, so they are
 * computed from the same table with no filters applied — the tab counts describe
 * the whole order book, which is what an operator expects when triaging.
 */
export async function orderStatusCounts(): Promise<{
  all: number;
  byStatus: Record<string, number>;
}> {
  const grouped = await prisma.order.groupBy({
    by: ['currentStatus'],
    _count: { _all: true },
  });

  const byStatus: Record<string, number> = {};
  let all = 0;
  for (const row of grouped) {
    byStatus[row.currentStatus] = row._count._all;
    all += row._count._all;
  }

  return { all, byStatus };
}

// ─── Detail ────────────────────────────────────────────────────────────────

/**
 * Resolves the names behind `OrderStatusHistory.changedBy`.
 *
 * `changedBy` is a plain string column with no relation, so Prisma cannot join
 * it. One query for the whole history, not one per row.
 */
async function changedByNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });

  return new Map(users.map((user) => [user.id, user.name]));
}

export async function getAdminOrder(id: string): Promise<AdminOrderDetail> {
  const row = await prisma.order.findUnique({
    where: { id },
    select: ADMIN_ORDER_DETAIL_SELECT,
  });

  if (!row) throw notFound('Order');

  const names = await changedByNames(row.statusHistory.map((entry) => entry.changedBy ?? ''));

  return toAdminOrderDetail(row, {
    changedByNames: names,
    allowedTransitions: allowedTransitionsFrom(row.currentStatus as AdminOrderStatus),
  });
}

/** Looks up an order by its public order number, for the search box. */
export async function getAdminOrderByNumber(orderNumber: string): Promise<AdminOrderDetail> {
  const row = await prisma.order.findUnique({
    where: { orderNumber },
    select: { id: true },
  });

  if (!row) throw notFound('Order');
  return getAdminOrder(row.id);
}

// ─── Status change ─────────────────────────────────────────────────────────

/**
 * Moves one order to a new status.
 *
 * The order of operations matters:
 *
 *   1. Read the order and its lines inside the transaction, so the stock
 *      release uses the quantities that are actually on the order.
 *   2. Refuse an illegal transition with the human-readable reason from the
 *      shared table, before any write.
 *   3. Update the status, write the history row, release stock if the target
 *      status releases it, and write the audit row — all in one transaction.
 *
 * A no-op (moving to the status it is already in) is refused rather than
 * silently writing a duplicate history row. `canTransition` already returns
 * false for it, so the refusal message is the generic one; that is correct,
 * because "already shipped" and "cannot ship" are the same answer to the
 * operator: nothing to do.
 */
export async function changeOrderStatus(
  id: string,
  input: OrderStatusInput,
  actor: Actor,
): Promise<AdminOrderDetail> {
  await withAudit(
    (result: { from: string; to: string }) => ({
      userId: actor.userId,
      action: 'order.status_change',
      entity: 'order',
      entityId: id,
      changes: { status: { from: result.from, to: result.to }, note: input.note },
      ipAddress: actor.ipAddress,
    }),
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        select: {
          id: true,
          orderNumber: true,
          currentStatus: true,
          items: { select: { variantId: true, quantity: true } },
        },
      });

      if (!order) throw notFound('Order');

      const from = order.currentStatus as OrderStatus;
      const to = input.status as OrderStatus;

      if (!canTransition(from, to)) {
        throw new HttpError(409, 'CONFLICT', transitionRefusal(from, to));
      }

      await tx.order.update({
        where: { id: order.id },
        data: { currentStatus: to },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          status: to,
          note: input.note,
          changedBy: actor.userId,
        },
      });

      // Same statement shape as the customer cancel path, so the stock ledger
      // stays symmetric whichever surface released the units.
      if (releasesStock(to)) {
        for (const item of order.items) {
          if (!item.variantId) continue;
          await tx.$executeRaw`
            UPDATE ProductVariant
            SET stock = stock + ${item.quantity},
                reservedStock = GREATEST(0, reservedStock - ${item.quantity})
            WHERE id = ${item.variantId}
          `;
        }
      }

      return { from, to };
    },
  );

  return getAdminOrder(id);
}

/**
 * Bulk status change.
 *
 * Reports per-id outcomes instead of failing the whole batch on one bad order.
 * A bulk "mark shipped" over 20 orders where one has already been cancelled
 * should ship the other 19 and say which one it skipped — failing all 20 because
 * of one is the behaviour that makes operators stop trusting bulk actions.
 *
 * Each order still goes through its own transaction, so a failure part-way
 * leaves the completed ones committed and audited. That is the honest outcome:
 * the response says exactly what happened.
 */
export async function bulkChangeOrderStatus(
  input: OrderBulkStatusInput,
  actor: Actor,
): Promise<{
  updated: string[];
  skipped: Array<{ id: string; reason: string }>;
}> {
  const updated: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const id of input.ids) {
    try {
      await changeOrderStatus(id, { status: input.status, note: input.note }, actor);
      updated.push(id);
    } catch (error) {
      if (error instanceof HttpError) {
        skipped.push({ id, reason: error.message });
        continue;
      }
      throw error;
    }
  }

  return { updated, skipped };
}

// ─── Payment ───────────────────────────────────────────────────────────────

/**
 * Records a payment against an order.
 *
 * The payment status is derived, never accepted from the caller:
 *
 *   paid >= total   -> PAID
 *   paid > 0        -> PARTIALLY_PAID
 *   otherwise       -> UNPAID
 *
 * That is the only way the three numbers on the order (`totalAmountPoisha`,
 * `paidAmountPoisha`, `paymentStatus`) can stay consistent with each other. A
 * caller-supplied status would let an order read PAID with 0 collected.
 *
 * Overpayment is allowed and recorded as-is rather than clamped: a customer who
 * paid ৳1,050 for a ৳1,000 order did pay ৳1,050, and the extra is a refund
 * question, not a data-entry correction. The status still reads PAID.
 */
export async function recordOrderPayment(
  id: string,
  input: OrderPaymentInput,
  actor: Actor,
): Promise<AdminOrderDetail> {
  await withAudit(
    (result: { paid: number; status: string }) => ({
      userId: actor.userId,
      action: 'order.payment',
      entity: 'order',
      entityId: id,
      changes: {
        paidAmountPoisha: { to: result.paid },
        paymentStatus: { to: result.status },
        amountPoisha: { to: input.amountPoisha },
        method: { to: input.method ?? null },
        txnId: { to: input.txnId ?? null },
        note: { to: input.note ?? null },
      },
      ipAddress: actor.ipAddress,
    }),
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        select: {
          id: true,
          totalAmountPoisha: true,
          paidAmountPoisha: true,
          paymentMethod: true,
          paymentStatus: true,
        },
      });

      if (!order) throw notFound('Order');

      if (order.paymentStatus === 'REFUNDED') {
        throw new HttpError(
          409,
          'CONFLICT',
          'This order has been refunded. A new payment cannot be recorded against it.',
        );
      }

      const paid = order.paidAmountPoisha + input.amountPoisha;
      const status = paid >= order.totalAmountPoisha ? 'PAID' : paid > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

      await tx.order.update({
        where: { id: order.id },
        data: {
          paidAmountPoisha: paid,
          paymentStatus: status,
          // Only overwrite the method when the caller named one — a COD
          // collection on a bKash order should not relabel the order.
          ...(input.method ? { paymentMethod: input.method } : {}),
          ...(input.txnId ? { paymentTxnId: input.txnId, paymentGateway: input.method ?? order.paymentMethod } : {}),
        },
      });

      /**
       * Deliberately NO `OrderStatusHistory` row here.
       *
       * That table is the order's *status* timeline, and `status` is a required
       * column. Recording a payment in it would mean inventing a status for a
       * transition that did not happen — a pending order would show "DELIVERED"
       * in its history because someone collected cash. The audit row above is
       * the record of the payment; the drawer reads `paidAmountPoisha` and
       * `paymentStatus` off the order itself.
       */
      return { paid, status };
    },
  );

  return getAdminOrder(id);
}

// ─── Courier ───────────────────────────────────────────────────────────────

/**
 * Attaches a courier booking.
 *
 * No courier API is called — there is no integration and inventing one would be
 * a lie in the UI. This records what the operator booked elsewhere: courier,
 * consignment id, tracking URL. The reference's panel shows exactly these three
 * fields, so this is the honest implementation of it.
 */
export async function setOrderCourier(
  id: string,
  input: OrderCourierInput,
  actor: Actor,
): Promise<AdminOrderDetail> {
  await withAudit(
    {
      userId: actor.userId,
      action: 'order.courier',
      entity: 'order',
      entityId: id,
      changes: {
        courierName: { to: input.courierName },
        consignmentId: { to: input.consignmentId },
        trackingUrl: { to: input.trackingUrl ?? null },
      },
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        select: { id: true, currentStatus: true },
      });

      if (!order) throw notFound('Order');

      if (order.currentStatus === 'CANCELLED') {
        throw new HttpError(409, 'CONFLICT', 'A cancelled order cannot be booked with a courier.');
      }

      await tx.order.update({
        where: { id: order.id },
        data: {
          courierName: input.courierName,
          consignmentId: input.consignmentId,
          trackingUrl: input.trackingUrl ?? null,
        },
      });

      return order;
    },
  );

  return getAdminOrder(id);
}

// ─── Notes ─────────────────────────────────────────────────────────────────

/**
 * Replaces the internal note on an order.
 *
 * The note is internal: it never reaches the customer and is not part of
 * `OrderDto`. The audit row carries the before/after so an overwritten note is
 * still recoverable from the log.
 */
export async function setOrderNotes(
  id: string,
  notes: string | null,
  actor: Actor,
): Promise<AdminOrderDetail> {
  const before = await prisma.order.findUnique({
    where: { id },
    select: { id: true, notes: true },
  });

  if (!before) throw notFound('Order');

  const changes = diffChanges({ notes: before.notes }, { notes });

  // Nothing changed: no write, no audit row. A PATCH that changes nothing should
  // not claim it did.
  if (Object.keys(changes).length === 0) return getAdminOrder(id);

  await withAudit(
    {
      userId: actor.userId,
      action: 'order.notes',
      entity: 'order',
      entityId: id,
      changes: changes as Prisma.InputJsonValue,
      ipAddress: actor.ipAddress,
    },
    async (tx) => {
      await tx.order.update({ where: { id }, data: { notes } });
    },
  );

  return getAdminOrder(id);
}
