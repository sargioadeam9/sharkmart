/**
 * `/orders/[id]` — one order, with its timeline and the actions the status
 * allows.
 *
 * The cancel and return buttons are gated by `canCancel` / `canReturn`, which
 * mirror the server's transition rules. The server refuses anything else; this
 * just avoids offering a button that is guaranteed to 409.
 *
 * A 404 is rendered as "not found", not as an error. That is deliberate: the
 * server returns 404 for another user's order (not 403), so the two cases are
 * indistinguishable by design — and a page that said "forbidden" would confirm
 * the order exists.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import type { OrderDto } from '@/types/account';
import { useLang } from '@/lib/hooks';
import { cancelOrder, getOrder, requestReturn } from '@/lib/api/account';
import { formatMoney } from '@/lib/format';
import { localized } from '@/types/catalog';
import { toast } from '@/components/shared/toast';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { TextAreaField, FormAlert } from '@/components/account/form-fields';
import {
  OrderStatusBadge,
  canCancel,
  canReturn,
  useOrderStatusLabel,
} from '@/components/account/order-status-badge';

type Status = 'loading' | 'ready' | 'notfound' | 'failed';

export function OrderDetailPage({ orderId }: { orderId: string }) {
  const { lang, tu } = useLang();
  const statusLabel = useOrderStatusLabel();

  const [order, setOrder] = useState<OrderDto | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const [showReturn, setShowReturn] = useState(false);
  const [returnReason, setReturnReason] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      setOrder(await getOrder(orderId));
      setStatus('ready');
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'status' in error
        ? (error as { status: number }).status
        : 0;
      setStatus(code === 404 ? 'notfound' : 'failed');
    }
  }, [orderId]);

  /**
   * Inlined rather than calling `load()`: the rule reads a callback call as a
   * synchronous setState. `orderId` is the only input, so this re-runs exactly
   * when `load` would have.
   */
  useEffect(() => {
    let cancelled = false;

    getOrder(orderId)
      .then((next) => {
        if (cancelled) return;
        setOrder(next);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const code = typeof error === 'object' && error !== null && 'status' in error
          ? (error as { status: number }).status
          : 0;
        setStatus(code === 404 ? 'notfound' : 'failed');
      });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const handleCancel = useCallback(async () => {
    if (!order) return;
    setActionError(null);
    setBusy(true);

    try {
      const updated = await cancelOrder(order.id, cancelReason.trim() || undefined);
      setOrder(updated);
      setShowCancel(false);
      setCancelReason('');
      toast(tu('orderCancelled'));
    } catch {
      setActionError(tu('errorBody'));
    } finally {
      setBusy(false);
    }
  }, [order, cancelReason, tu]);

  const handleReturn = useCallback(async () => {
    if (!order) return;

    if (returnReason.trim().length < 5) {
      setActionError(tu('returnReason'));
      return;
    }

    setActionError(null);
    setBusy(true);

    try {
      const updated = await requestReturn(order.id, returnReason.trim());
      setOrder(updated);
      setShowReturn(false);
      setReturnReason('');
      toast(tu('returnRequested'));
    } catch {
      setActionError(tu('errorBody'));
    } finally {
      setBusy(false);
    }
  }, [order, returnReason, tu]);

  // ── states ─────────────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div className="wrap acct-page" aria-busy="true">
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (status === 'notfound') {
    return (
      <div className="wrap acct-page">
        <EmptyState
          tone="empty"
          title={tu('notFoundTitle')}
          body={tu('notFoundBody')}
          action={
            <Link className="btn red" href="/orders">
              {tu('myOrders')}
            </Link>
          }
        />
      </div>
    );
  }

  if (status === 'failed' || !order) {
    return (
      <div className="wrap acct-page">
        <EmptyState
          tone="error"
          title={tu('errorTitle')}
          body={tu('errorBody')}
          action={
            <button type="button" className="btn red" onClick={() => void load()}>
              {tu('retry')}
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="wrap acct-page">
      <div className="acct-head">
        <Link href="/orders" className="acct-link">
          ← {tu('myOrders')}
        </Link>
        <h1 style={{ marginTop: 8 }}>{order.orderNumber}</h1>
        <p>
          {tu('orderDate')}: {formatDate(order.createdAt, lang)}
        </p>
      </div>

      {actionError && (
        <div style={{ marginBottom: 14 }}>
          <FormAlert tone="error">{actionError}</FormAlert>
        </div>
      )}

      <div className="acct-split">
        <div>
          {/* ── items ───────────────────────────────────────────────────── */}
          <div className="acct-panel">
            <div className="acct-panel-head">
              <h2>{tu('orderDetails')}</h2>
              <OrderStatusBadge status={order.status} />
            </div>

            {order.items.map((item) => (
              <div key={item.id} className="acct-line">
                <div className="acct-line-img" aria-hidden="true">
                  🛍️
                </div>
                <div>
                  <Link href={`/product/${item.productId}`} className="acct-line-name">
                    {localized(lang, item.nameEn, item.nameBn)}
                  </Link>
                  <div className="acct-line-variant">{item.sku}</div>
                  <div className="acct-line-price">
                    {formatMoney(item.unitPricePoisha, lang)} × {item.quantity}
                  </div>
                </div>
                <div className="acct-line-right">
                  <span className="acct-line-total">
                    {formatMoney(item.lineTotalPoisha, lang)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* ── timeline ────────────────────────────────────────────────── */}
          <div className="acct-panel">
            <div className="acct-panel-head">
              <h2>{tu('orderTimeline')}</h2>
            </div>
            <div className="acct-panel-body">
              <ul className="acct-timeline">
                {order.statusHistory.map((entry, index) => (
                  <li
                    key={`${entry.status}-${index}`}
                    className={index === order.statusHistory.length - 1 ? 'is-current' : undefined}
                  >
                    <div className="acct-timeline-status">
                      {statusLabel(entry.status as OrderDto['status'])}
                    </div>
                    {entry.note && <div className="acct-timeline-note">{entry.note}</div>}
                    <div className="acct-timeline-time">
                      {formatDateTime(entry.createdAt, lang)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ── actions ─────────────────────────────────────────────────── */}
          {(canCancel(order.status) || canReturn(order.status)) && (
            <div className="acct-panel">
              <div className="acct-panel-body">
                {showCancel && (
                  <div style={{ marginBottom: 14 }}>
                    <TextAreaField
                      label={tu('cancelReason')}
                      value={cancelReason}
                      onChange={setCancelReason}
                      rows={2}
                      maxLength={300}
                    />
                  </div>
                )}

                {showReturn && (
                  <div style={{ marginBottom: 14 }}>
                    <TextAreaField
                      label={tu('returnReason')}
                      value={returnReason}
                      onChange={setReturnReason}
                      rows={3}
                      maxLength={500}
                      required
                    />
                  </div>
                )}

                <div className="acct-actions" style={{ marginTop: 0 }}>
                  {canCancel(order.status) && !showCancel && (
                    <button
                      type="button"
                      className="btn line"
                      onClick={() => setShowCancel(true)}
                      disabled={busy}
                    >
                      {tu('cancelOrder')}
                    </button>
                  )}

                  {canCancel(order.status) && showCancel && (
                    <>
                      <button
                        type="button"
                        className="btn red"
                        onClick={() => void handleCancel()}
                        disabled={busy}
                      >
                        {busy ? tu('loading') : tu('confirmCancel')}
                      </button>
                      <button
                        type="button"
                        className="btn line"
                        onClick={() => {
                          setShowCancel(false);
                          setCancelReason('');
                        }}
                        disabled={busy}
                      >
                        {tu('close')}
                      </button>
                    </>
                  )}

                  {canReturn(order.status) && !showReturn && (
                    <button
                      type="button"
                      className="btn line"
                      onClick={() => setShowReturn(true)}
                      disabled={busy}
                    >
                      {tu('requestReturn')}
                    </button>
                  )}

                  {canReturn(order.status) && showReturn && (
                    <>
                      <button
                        type="button"
                        className="btn red"
                        onClick={() => void handleReturn()}
                        disabled={busy}
                      >
                        {busy ? tu('loading') : tu('requestReturn')}
                      </button>
                      <button
                        type="button"
                        className="btn line"
                        onClick={() => {
                          setShowReturn(false);
                          setReturnReason('');
                        }}
                        disabled={busy}
                      >
                        {tu('close')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── summary ───────────────────────────────────────────────────── */}
        <aside className="acct-aside">
          <div className="acct-panel">
            <div className="acct-panel-head">
              <h2>{tu('cartSummary')}</h2>
            </div>
            <div className="acct-panel-body">
              <div className="acct-rows">
                <div className="acct-row">
                  <span>{tu('reviewItems')}</span>
                  <b>{formatMoney(order.subtotalPoisha, lang)}</b>
                </div>

                {order.discountAmountPoisha > 0 && (
                  <div className="acct-row acct-row-disc">
                    <span>{tu('couponCode')}</span>
                    <b>−{formatMoney(order.discountAmountPoisha, lang)}</b>
                  </div>
                )}

                <div className="acct-row">
                  <span>{tu('reviewDelivery')}</span>
                  <b>
                    {order.deliveryChargePoisha
                      ? formatMoney(order.deliveryChargePoisha, lang)
                      : tu('freeDelivery')}
                  </b>
                </div>

                <div className="acct-row acct-row-total">
                  <span>{tu('orderTotal')}</span>
                  <span>{formatMoney(order.totalAmountPoisha, lang)}</span>
                </div>
              </div>

              <div className="acct-divider" />

              <div className="acct-rows">
                <div className="acct-row">
                  <span>{tu('reviewPayment')}</span>
                  <b>{order.paymentMethod}</b>
                </div>
                <div className="acct-row">
                  <span>{tu('orderStatus')}</span>
                  <b>
                    {order.paymentStatus === 'PAID'
                      ? tu('paymentPaid')
                      : order.paymentStatus === 'REFUNDED'
                        ? tu('paymentRefunded')
                        : tu('paymentUnpaid')}
                  </b>
                </div>
              </div>

              {order.shippingAddress && (
                <>
                  <div className="acct-divider" />
                  <div className="acct-address-body">
                    <strong style={{ color: 'var(--navy)' }}>
                      {order.shippingAddress.recipientName}
                    </strong>
                    <br />
                    {order.shippingAddress.address}, {order.shippingAddress.area},{' '}
                    {order.shippingAddress.district}
                    <br />
                    {order.shippingAddress.phone}
                  </div>
                </>
              )}

              {order.trackingUrl && (
                <>
                  <div className="acct-divider" />
                  <a
                    className="btn line"
                    href={order.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ width: '100%' }}
                  >
                    {tu('trackOrder')} ↗
                  </a>
                </>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function formatDate(iso: string, lang: 'en' | 'bn'): string {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

function formatDateTime(iso: string, lang: 'en' | 'bn'): string {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}
