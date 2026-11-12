/**
 * `/checkout/success` — the order confirmation.
 *
 * The order number arrives in the query string because the checkout that just
 * created it has the full DTO in memory and only needs to hand off a reference.
 * Rather than trust the URL for anything but the number, this page re-reads the
 * order from the API when the visitor is signed in — so the confirmation shows
 * the server's totals, not a value that travelled through a URL.
 *
 * A guest cannot re-read it (that would need the phone, and asking for it here
 * is friction at the worst moment), so a guest sees the number and the tracking
 * link, which is exactly what they need to come back later.
 */

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import type { OrderDto } from '@/types/account';
import { useLang } from '@/lib/hooks';
import { useSessionStore } from '@/lib/store/session-store';
import { listOrders } from '@/lib/api/account';
import { formatMoney } from '@/lib/format';
import { Skeleton } from '@/components/ui/skeleton';
import { OrderStatusBadge } from '@/components/account/order-status-badge';

export function CheckoutSuccess() {
  const { lang, tu } = useLang();
  const searchParams = useSearchParams();
  const orderNumber = searchParams.get('order') ?? '';

  const signedIn = useSessionStore((s) => s.status) === 'authenticated';

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * Find the order by number among the user's recent orders.
   *
   * There is no `GET /me/orders/by-number`, and adding one for this page alone
   * would be a new endpoint for a read the list already serves. The order was
   * just created, so it is on page 1.
   */
  useEffect(() => {
    if (!signedIn || !orderNumber) return;

    let cancelled = false;

    listOrders({ page: 1, limit: 10 })
      .then(({ orders }) => {
        if (cancelled) return;
        setOrder(orders.find((entry) => entry.orderNumber === orderNumber) ?? null);
      })
      .catch(() => {
        // A failed read must not turn a placed order into an error screen —
        // the order exists, this is only the receipt.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn, orderNumber]);

  return (
    <div className="acct-confirm">
      <div className="acct-confirm-icon" aria-hidden="true">
        ✓
      </div>

      <h1>{tu('orderPlaced')}</h1>
      <p>{tu('orderPlacedBody')}</p>

      {orderNumber && (
        <div className="acct-confirm-num" aria-label={tu('orderNumber')}>
          {orderNumber}
        </div>
      )}

      {loading && <Skeleton className="mx-auto h-[80px] w-full max-w-[420px]" />}

      {order && (
        <div className="acct-panel" style={{ marginTop: 20, textAlign: 'start' }}>
          <div className="acct-panel-head">
            <h2>{tu('orderDetails')}</h2>
            <OrderStatusBadge status={order.status} />
          </div>
          <div className="acct-panel-body">
            <div className="acct-rows">
              <div className="acct-row">
                <span>{tu('orderTotal')}</span>
                <b>{formatMoney(order.totalAmountPoisha, lang)}</b>
              </div>
              <div className="acct-row">
                <span>{tu('reviewPayment')}</span>
                <b>{order.paymentMethod}</b>
              </div>
              {order.shippingAddress && (
                <div className="acct-row">
                  <span>{tu('reviewAddress')}</span>
                  <b>
                    {order.shippingAddress.area}, {order.shippingAddress.district}
                  </b>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="acct-confirm-actions">
        <Link className="btn red" href={`/track?order=${encodeURIComponent(orderNumber)}`}>
          {tu('trackOrder')}
        </Link>
        {signedIn && (
          <Link className="btn line" href="/orders">
            {tu('myOrders')}
          </Link>
        )}
        <Link className="btn line" href="/">
          {tu('continueShopping')}
        </Link>
      </div>
    </div>
  );
}
