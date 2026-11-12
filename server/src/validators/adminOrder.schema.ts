/**
 * Zod schemas for the admin orders API — security.md §7.
 *
 * Styled like `adminProduct.schema.ts`: every object is `.strict()`, every
 * numeric query field is coerced and bounded, and a PATCH that changes nothing
 * is rejected rather than writing an audit row that claims it did.
 *
 * Three rules specific to this surface:
 *
 *   1. **Status is an enum, never a free string.** The nine `OrderStatus` values
 *      are the only legal inputs. A typo becomes a 422 at the edge instead of a
 *      Prisma error at the database.
 *   2. **A status change always carries a note.** The reference's status flow is
 *      "status update with note", and the note is the only record of *why* an
 *      order was cancelled or returned. Optional here would mean most rows have
 *      none, so it is required and bounded.
 *   3. **Money is never in the body.** There is no field on any schema below
 *      that lets a caller set a total, a discount or a paid amount. Those are
 *      facts the checkout and the payment gateway assert, not values an operator
 *      types. The one exception is `paidAmountPoisha` on the payment endpoint,
 *      which is a deliberate, permission-gated reconciliation action.
 */

import { z } from 'zod';

export const ADMIN_ORDER_MAX_LIMIT = 100;
export const ADMIN_ORDER_DEFAULT_LIMIT = 20;

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce
  .number()
  .int()
  .min(1)
  .max(ADMIN_ORDER_MAX_LIMIT)
  .default(ADMIN_ORDER_DEFAULT_LIMIT);

/** The nine statuses, mirroring `enum OrderStatus` in schema.prisma. */
export const ORDER_STATUS = z.enum([
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURNED',
  'REFUND_PENDING',
  'REFUNDED',
]);

export const PAYMENT_STATUS = z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED']);

// ─── List ──────────────────────────────────────────────────────────────────

/**
 * The orders list query.
 *
 * `q` matches order number, customer name, phone and email — the four things an
 * operator has in hand when a customer calls. It is a single box because a
 * support call never starts with "which field is this in".
 *
 * `from`/`to` are ISO dates and filter on `createdAt`. Both ends are inclusive
 * of the day, resolved in the service rather than here, because "to" means end
 * of day and a bare date string is midnight.
 */
export const adminOrderListQuery = z
  .object({
    page,
    limit,
    q: z.string().trim().min(1).max(120).optional(),
    status: z.union([ORDER_STATUS, z.literal('all')]).default('all'),
    paymentStatus: z.union([PAYMENT_STATUS, z.literal('all')]).default('all'),
    /** `guest` / `registered` — the COD fraud review queue, in one click. */
    customerType: z.enum(['all', 'guest', 'registered']).default('all'),
    from: z.string().date('must be a YYYY-MM-DD date').optional(),
    to: z.string().date('must be a YYYY-MM-DD date').optional(),
    sort: z.enum(['newest', 'oldest', 'total_desc', 'total_asc']).default('newest'),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must be on or before to',
    path: ['from'],
  });

export type AdminOrderListInput = z.infer<typeof adminOrderListQuery>;

// ─── Params ────────────────────────────────────────────────────────────────

export const orderIdParams = z.object({ id: z.string().uuid('must be an order id') }).strict();

// ─── Status change ─────────────────────────────────────────────────────────

/**
 * POST /:id/status — the single status transition endpoint.
 *
 * One endpoint, not nine. The legal set is decided by `order-status.ts`, so a
 * `PATCH /:id/cancel` and a `PATCH /:id/ship` would be two more places for the
 * transition table to drift out of. The body names the target and the note.
 */
export const orderStatusBody = z
  .object({
    status: ORDER_STATUS,
    note: z.string().trim().min(1, 'a note is required').max(500),
  })
  .strict();

export type OrderStatusInput = z.infer<typeof orderStatusBody>;

/**
 * Bulk status change.
 *
 * Capped at 100 ids: the bulk bar acts on the current page, and an unbounded
 * array is a way to make one request do an unbounded amount of work. The
 * service reports per-id outcomes, because a bulk action that half-succeeds
 * must say which half.
 */
export const orderBulkStatusBody = z
  .object({
    ids: z.array(z.string().uuid()).min(1, 'select at least one order').max(100),
    status: ORDER_STATUS,
    note: z.string().trim().min(1, 'a note is required').max(500),
  })
  .strict();

export type OrderBulkStatusInput = z.infer<typeof orderBulkStatusBody>;

// ─── Payment ───────────────────────────────────────────────────────────────

/**
 * POST /:id/payment — record a payment against the order.
 *
 * This is the reconciliation action for COD: the courier hands over cash, and
 * an operator records it. `amountPoisha` is what was actually collected, which
 * may be less than the total (a partial COD collection), so the service derives
 * the payment status from the running total rather than trusting a status the
 * caller sends.
 *
 * `txnId` is the gateway or courier reference. Never card data, never wallet
 * credentials (AGENTS.md §7.10).
 */
export const orderPaymentBody = z
  .object({
    amountPoisha: z.number().int('must be an integer number of poisha').min(1),
    method: z.enum(['COD', 'BKASH', 'NAGAD', 'SSLCOMMERZ', 'BANK']).optional(),
    txnId: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type OrderPaymentInput = z.infer<typeof orderPaymentBody>;

// ─── Courier ───────────────────────────────────────────────────────────────

/**
 * POST /:id/courier — attach a courier booking to the order.
 *
 * There is no courier integration in this project yet (no Pathao/RedX/Steadfast
 * credentials), so this records what an operator booked by hand: the courier,
 * the consignment id and the tracking URL. That is honest — it is the same
 * information the reference's "courier booking" panel displays, and it does not
 * pretend to call an API that does not exist.
 */
export const orderCourierBody = z
  .object({
    courierName: z.string().trim().min(1, 'courierName is required').max(80),
    consignmentId: z.string().trim().min(1, 'consignmentId is required').max(120),
    trackingUrl: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => /^https?:\/\//i.test(value), 'trackingUrl must start with http:// or https://')
      .optional(),
  })
  .strict();

export type OrderCourierInput = z.infer<typeof orderCourierBody>;

// ─── Notes ─────────────────────────────────────────────────────────────────

/** PATCH /:id/notes — the internal note on an order. */
export const orderNotesBody = z
  .object({
    notes: z.string().trim().max(2000).nullable(),
  })
  .strict();
