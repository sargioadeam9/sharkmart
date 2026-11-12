/**
 * Order status machine — masterbuild Phase 8 constraint.
 *
 * "Enforce valid status transitions. A shipped order cannot be cancelled by the
 * customer. Refunds go through REFUND_PENDING → REFUNDED."
 *
 * This is a table, not a chain of `if`s, because the rule has to be readable by
 * the next agent and testable without a request.
 */

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'RETURNED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

/**
 * Every legal transition, keyed by current status.
 *
 * `CANCELLED`, `RETURNED` and `REFUNDED` are terminal — nothing leaves them,
 * because a cancelled order that ships is a refund dispute waiting to happen.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED', 'RETURNED'],
  DELIVERED: ['RETURNED', 'REFUND_PENDING'],
  CANCELLED: [],
  RETURNED: ['REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
};

/**
 * Statuses a **customer** may move an order to. Staff have a wider set.
 *
 * A customer can cancel while the order has not shipped, and can request a
 * return once it has been delivered. They cannot mark their own order delivered
 * or refunded — those are facts only the business can assert.
 */
const CUSTOMER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  PROCESSING: ['CANCELLED'],
  SHIPPED: [], // Too late — the parcel is with the courier.
  DELIVERED: ['RETURNED'],
  CANCELLED: [],
  RETURNED: [],
  REFUND_PENDING: [],
  REFUNDED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function canCustomerTransition(from: OrderStatus, to: OrderStatus): boolean {
  return CUSTOMER_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Statuses that put stock back on the shelf.
 *
 * A cancellation or a return releases the reserved units; anything else does
 * not. Kept as data so the restock path cannot drift from the status machine.
 */
export function releasesStock(status: OrderStatus): boolean {
  return status === 'CANCELLED' || status === 'RETURNED';
}

/** Human-readable reason a transition was refused, for the error envelope. */
export function transitionRefusal(from: OrderStatus, to: OrderStatus): string {
  if (from === 'SHIPPED' && to === 'CANCELLED') {
    return 'This order has already shipped and cannot be cancelled. Please request a return once it arrives.';
  }
  if (from === 'DELIVERED' && to === 'CANCELLED') {
    return 'This order has been delivered. Please request a return instead.';
  }
  return `An order that is ${from.toLowerCase()} cannot be moved to ${to.toLowerCase()}.`;
}
