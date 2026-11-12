/**
 * Admin order DTOs — the read shape for the panel, not the storefront.
 *
 * ── Why this is separate from `OrderDto` ────────────────────────────────────
 *
 * `services/order.service.ts` produces `OrderDto`, which is the customer's view
 * of their own order: no customer identity beyond the recipient, no internal
 * notes, no audit trail, no payment reconciliation fields. The admin list needs
 * the opposite — who ordered, what the business has done to the order, and how
 * it was paid — plus a row shape light enough to render 20 at a time.
 *
 * So this is a second mapper with a second select. `OrderDto` is not widened,
 * and `order.service.ts` is not imported for its types. A field added here is a
 * field the panel needs; a field added there is a customer contract change.
 *
 * ── The money rule ─────────────────────────────────────────────────────────
 *
 * Every amount on this surface is an integer number of poisha, straight from
 * the row. Nothing is recomputed here. The order is a historical record: the
 * prices on it were computed at checkout and are the truth, even if the product
 * has since been repriced. Recomputing would make yesterday's order change
 * value overnight, which is the one thing an order must never do.
 */

import type { Prisma } from '@prisma/client';

// ─── Wire types ────────────────────────────────────────────────────────────

export type AdminOrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURNED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export type AdminPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED';

/** One row in the orders list. Deliberately small: the list renders 20 of these. */
export interface AdminOrderListItem {
  id: string;
  orderNumber: string;
  status: AdminOrderStatus;
  paymentStatus: AdminPaymentStatus;
  paymentMethod: string;
  /** Registered customer's name, or the guest name captured at checkout. */
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  /** True when the order has no `userId` — a guest checkout. */
  isGuest: boolean;
  recipientName: string;
  district: string;
  division: string;
  itemCount: number;
  /** Distinct products, not units — "3 items" reads as 3 lines to an operator. */
  lineCount: number;
  subtotalPoisha: number;
  discountAmountPoisha: number;
  deliveryChargePoisha: number;
  totalAmountPoisha: number;
  paidAmountPoisha: number;
  courierName: string | null;
  consignmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOrderLine {
  id: string;
  productId: string;
  variantId: string | null;
  nameEn: string;
  nameBn: string;
  sku: string;
  quantity: number;
  unitPricePoisha: number;
  discountPercent: number;
  lineTotalPoisha: number;
  returnStatus: string | null;
  /** The product's current thumbnail, for the drawer. Null if it has none. */
  imageUrl: string | null;
}

export interface AdminOrderHistoryEntry {
  id: string;
  status: AdminOrderStatus;
  note: string | null;
  changedBy: string | null;
  changedByName: string | null;
  createdAt: string;
}

/** The full drawer payload. */
export interface AdminOrderDetail extends AdminOrderListItem {
  notes: string | null;
  couponCode: string | null;
  paymentGateway: string | null;
  paymentTxnId: string | null;
  trackingUrl: string | null;
  items: AdminOrderLine[];
  shippingAddress: {
    recipientName: string;
    phone: string;
    division: string;
    district: string;
    area: string;
    address: string;
    postalCode: string | null;
  } | null;
  statusHistory: AdminOrderHistoryEntry[];
  /**
   * Every status this order may legally move to right now, from the same table
   * the API enforces (`services/order-status.ts`).
   *
   * Sent to the client so the status dropdown cannot offer an illegal move. The
   * API still refuses one — the list is UX, the check is the control.
   */
  allowedTransitions: AdminOrderStatus[];
}

// ─── Selects ───────────────────────────────────────────────────────────────

/**
 * The list select.
 *
 * `items` is included only for the count and the line count, so it selects
 * nothing but `id` and `quantity` — a `_count` on items gives the line count but
 * not the unit count, and an operator scanning the list wants units ("3 items"),
 * not lines. Both are cheap here because the relation is at most a handful of
 * rows and the page is 20 orders.
 *
 * `shippingAddress` supplies the recipient and the district, which is the column
 * an operator actually sorts by when planning a courier run.
 */
export const ADMIN_ORDER_LIST_SELECT = {
  id: true,
  orderNumber: true,
  currentStatus: true,
  paymentStatus: true,
  paymentMethod: true,
  guestName: true,
  guestPhone: true,
  subtotalPoisha: true,
  discountAmountPoisha: true,
  deliveryChargePoisha: true,
  totalAmountPoisha: true,
  paidAmountPoisha: true,
  courierName: true,
  consignmentId: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { name: true, email: true, phone: true } },
  shippingAddress: {
    select: { recipientName: true, phone: true, district: true, division: true },
  },
  items: { select: { id: true, quantity: true } },
} satisfies Prisma.OrderSelect;

export type AdminOrderListRow = Prisma.OrderGetPayload<{
  select: typeof ADMIN_ORDER_LIST_SELECT;
}>;

/** The detail select — everything the drawer renders. */
export const ADMIN_ORDER_DETAIL_SELECT = {
  id: true,
  orderNumber: true,
  currentStatus: true,
  paymentStatus: true,
  paymentMethod: true,
  guestName: true,
  guestPhone: true,
  subtotalPoisha: true,
  discountAmountPoisha: true,
  deliveryChargePoisha: true,
  totalAmountPoisha: true,
  paidAmountPoisha: true,
  courierName: true,
  consignmentId: true,
  trackingUrl: true,
  notes: true,
  paymentGateway: true,
  paymentTxnId: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { name: true, email: true, phone: true } },
  coupon: { select: { code: true } },
  shippingAddress: {
    select: {
      recipientName: true,
      phone: true,
      division: true,
      district: true,
      area: true,
      address: true,
      postalCode: true,
    },
  },
  items: {
    select: {
      id: true,
      productId: true,
      variantId: true,
      nameEn: true,
      nameBn: true,
      sku: true,
      quantity: true,
      unitPricePoisha: true,
      discountPercent: true,
      lineTotalPoisha: true,
      returnStatus: true,
      product: {
        select: {
          images: {
            select: { url: true },
            orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }],
            take: 1,
          },
        },
      },
    },
  },
  statusHistory: {
    select: { id: true, status: true, note: true, changedBy: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrderSelect;

export type AdminOrderDetailRow = Prisma.OrderGetPayload<{
  select: typeof ADMIN_ORDER_DETAIL_SELECT;
}>;

// ─── Mappers ───────────────────────────────────────────────────────────────

/**
 * Who placed the order.
 *
 * A guest order has no `user`, so the name and phone come from the checkout
 * snapshot. Falling back to the shipping address is deliberate: `guestName` is
 * nullable and an order with no name at all is unusable in a support call.
 */
function customerOf(row: {
  user: { name: string; email: string | null; phone: string | null } | null;
  guestName: string | null;
  guestPhone: string | null;
  shippingAddress: { recipientName: string; phone: string } | null;
}): { name: string; phone: string; email: string | null; isGuest: boolean } {
  const isGuest = row.user === null;
  return {
    name: row.user?.name ?? row.guestName ?? row.shippingAddress?.recipientName ?? '—',
    phone: row.user?.phone ?? row.guestPhone ?? row.shippingAddress?.phone ?? '—',
    email: row.user?.email ?? null,
    isGuest,
  };
}

/** One list row → the admin list item. */
export function toAdminOrderListItem(row: AdminOrderListRow): AdminOrderListItem {
  const customer = customerOf(row);
  const units = row.items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.currentStatus as AdminOrderStatus,
    paymentStatus: row.paymentStatus as AdminPaymentStatus,
    paymentMethod: row.paymentMethod,
    customerName: customer.name,
    customerPhone: customer.phone,
    customerEmail: customer.email,
    isGuest: customer.isGuest,
    recipientName: row.shippingAddress?.recipientName ?? customer.name,
    district: row.shippingAddress?.district ?? '—',
    division: row.shippingAddress?.division ?? '—',
    itemCount: units,
    lineCount: row.items.length,
    subtotalPoisha: row.subtotalPoisha,
    discountAmountPoisha: row.discountAmountPoisha,
    deliveryChargePoisha: row.deliveryChargePoisha,
    totalAmountPoisha: row.totalAmountPoisha,
    paidAmountPoisha: row.paidAmountPoisha,
    courierName: row.courierName,
    consignmentId: row.consignmentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * One detail row → the drawer payload.
 *
 * `changedByName` is not resolved here: `OrderStatusHistory.changedBy` holds a
 * user id and there is no relation on it, so the caller resolves the names in
 * one query and passes them in. Doing it per row would be an N+1 over the
 * history, which is the exact thing the storefront list was fixed for.
 */
export function toAdminOrderDetail(
  row: AdminOrderDetailRow,
  options: {
    changedByNames: Map<string, string>;
    allowedTransitions: AdminOrderStatus[];
  },
): AdminOrderDetail {
  const customer = customerOf(row);
  const units = row.items.reduce((sum, item) => sum + item.quantity, 0);

  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.currentStatus as AdminOrderStatus,
    paymentStatus: row.paymentStatus as AdminPaymentStatus,
    paymentMethod: row.paymentMethod,
    customerName: customer.name,
    customerPhone: customer.phone,
    customerEmail: customer.email,
    isGuest: customer.isGuest,
    recipientName: row.shippingAddress?.recipientName ?? customer.name,
    district: row.shippingAddress?.district ?? '—',
    division: row.shippingAddress?.division ?? '—',
    itemCount: units,
    lineCount: row.items.length,
    subtotalPoisha: row.subtotalPoisha,
    discountAmountPoisha: row.discountAmountPoisha,
    deliveryChargePoisha: row.deliveryChargePoisha,
    totalAmountPoisha: row.totalAmountPoisha,
    paidAmountPoisha: row.paidAmountPoisha,
    courierName: row.courierName,
    consignmentId: row.consignmentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    notes: row.notes,
    couponCode: row.coupon?.code ?? null,
    paymentGateway: row.paymentGateway,
    paymentTxnId: row.paymentTxnId,
    trackingUrl: row.trackingUrl,
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      nameEn: item.nameEn,
      nameBn: item.nameBn,
      sku: item.sku,
      quantity: item.quantity,
      unitPricePoisha: item.unitPricePoisha,
      discountPercent: item.discountPercent,
      lineTotalPoisha: item.lineTotalPoisha,
      returnStatus: item.returnStatus,
      imageUrl: item.product?.images[0]?.url ?? null,
    })),
    shippingAddress: row.shippingAddress,
    statusHistory: row.statusHistory.map((entry) => ({
      id: entry.id,
      status: entry.status as AdminOrderStatus,
      note: entry.note,
      changedBy: entry.changedBy,
      changedByName: entry.changedBy ? (options.changedByNames.get(entry.changedBy) ?? null) : null,
      createdAt: entry.createdAt.toISOString(),
    })),
    allowedTransitions: options.allowedTransitions,
  };
}
