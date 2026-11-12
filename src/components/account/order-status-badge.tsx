/**
 * Order status badge.
 *
 * One mapping, used by the orders list, the order detail and the tracker, so a
 * status can never render three different colours on three screens.
 *
 * Colour follows meaning, not sequence: the in-flight states are neutral/blue,
 * DELIVERED is the success green, and the terminal bad states are red. That is
 * the storefront token set (`--ok`, `--red`, `--muted`), not the admin ramp.
 */

'use client';

import type { OrderStatus } from '@/types/account';
import { useLang } from '@/lib/hooks';
import type { UiKey } from '@/lib/i18n/ui';
import { cn } from '@/lib/utils';

/** Status -> label key. Exhaustive, so a new status fails the type check. */
const LABEL_KEY: Record<OrderStatus, UiKey> = {
  PENDING: 'statusPending',
  CONFIRMED: 'statusConfirmed',
  PROCESSING: 'statusProcessing',
  SHIPPED: 'statusShipped',
  DELIVERED: 'statusDelivered',
  CANCELLED: 'statusCancelled',
  RETURNED: 'statusReturned',
  REFUND_PENDING: 'statusRefundPending',
  REFUNDED: 'statusRefunded',
};

type Tone = 'neutral' | 'info' | 'ok' | 'bad';

const TONE: Record<OrderStatus, Tone> = {
  PENDING: 'neutral',
  CONFIRMED: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'ok',
  CANCELLED: 'bad',
  RETURNED: 'bad',
  REFUND_PENDING: 'neutral',
  REFUNDED: 'neutral',
};

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const { tu } = useLang();

  return (
    <span className={cn('acct-status', `acct-status-${TONE[status]}`, className)}>
      {tu(LABEL_KEY[status])}
    </span>
  );
}

/** The label alone, for places that already have their own styling. */
export function useOrderStatusLabel(): (status: OrderStatus) => string {
  const { tu } = useLang();
  return (status) => tu(LABEL_KEY[status]);
}

/**
 * Statuses a customer may still cancel from.
 *
 * Mirrors `canCustomerTransition` on the server. Duplicated deliberately: the
 * server is the authority and will refuse anything else, but the UI must not
 * offer a button that is guaranteed to fail.
 */
export function canCancel(status: OrderStatus): boolean {
  return status === 'PENDING' || status === 'CONFIRMED';
}

/** A return is only possible once the order is in the customer's hands. */
export function canReturn(status: OrderStatus): boolean {
  return status === 'DELIVERED';
}
