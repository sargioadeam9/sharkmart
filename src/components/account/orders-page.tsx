/**
 * `/orders` — the customer's order history.
 *
 * Paginated, with a status filter. The list is deliberately thin — number,
 * date, status, total — because the detail page is one click away and a list
 * that tries to show items too becomes unreadable on a phone.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import type { OrderDto, OrderStatus } from '@/types/account';
import { useLang } from '@/lib/hooks';
import { listOrders } from '@/lib/api/account';
import { formatMoney } from '@/lib/format';
import { EmptyState } from '@/components/shared/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { OrderStatusBadge } from '@/components/account/order-status-badge';
import { AccountNav } from '@/components/account/account-nav';
import type { UiKey } from '@/lib/i18n/ui';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;

/**
 * The filter chips.
 *
 * `labelKey` is a `UiKey`, not a string — that is what stops a typo becoming a
 * chip that renders its own key name. "All" reuses the reference's `allcat`
 * string ("All Categories"), which is wrong here, so it gets its own label
 * below rather than borrowing a category string.
 */
const FILTERS: Array<{ value: OrderStatus | 'ALL'; labelKey: UiKey }> = [
  { value: 'ALL', labelKey: 'allOrders' },
  { value: 'PENDING', labelKey: 'statusPending' },
  { value: 'SHIPPED', labelKey: 'statusShipped' },
  { value: 'DELIVERED', labelKey: 'statusDelivered' },
  { value: 'CANCELLED', labelKey: 'statusCancelled' },
];

export function OrdersPage() {
  const { lang, tu } = useLang();

  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<OrderStatus | 'ALL'>('ALL');

  const [failed, setFailed] = useState(false);

  /**
   * Which (page, filter) pair the current `orders` belong to.
   *
   * Loading is derived from this rather than held in its own state: setting a
   * `loading` flag synchronously inside the effect is the cascading render
   * `react-hooks/set-state-in-effect` forbids. `null` means nothing has
   * resolved yet, so the first paint is a skeleton.
   */
  const requestKey = `${page}:${filter}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== requestKey;

  const load = useCallback(async () => {
    try {
      const result = await listOrders({
        page,
        limit: PAGE_SIZE,
        ...(filter === 'ALL' ? {} : { status: filter }),
      });
      setOrders(result.orders);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoadedKey(`${page}:${filter}`);
    }
  }, [page, filter]);

  /**
   * Inlined rather than calling `load()`: the rule cannot see through a
   * callback and reads the call as a synchronous setState. `page`/`filter` are
   * the only inputs, so this re-runs exactly when `load` would have.
   */
  useEffect(() => {
    let cancelled = false;

    listOrders({
      page,
      limit: PAGE_SIZE,
      ...(filter === 'ALL' ? {} : { status: filter }),
    })
      .then((result) => {
        if (cancelled) return;
        setOrders(result.orders);
        setTotal(result.total);
        setTotalPages(result.totalPages);
        setFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(`${page}:${filter}`);
      });

    return () => {
      cancelled = true;
    };
  }, [page, filter]);

  const handleFilter = useCallback((value: OrderStatus | 'ALL') => {
    setFilter(value);
    setPage(1);
  }, []);

  return (
    <div className="wrap acct-page">
      <div className="acct-head">
        <h1>{tu('myOrders')}</h1>
      </div>

      <div className="acct-split">
        <div>
          {/* ── filters ─────────────────────────────────────────────────── */}
          <div className="acct-steps" style={{ marginBottom: 14 }}>
            {FILTERS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className={cn('acct-step', filter === entry.value && 'is-active')}
                onClick={() => handleFilter(entry.value)}
                aria-pressed={filter === entry.value}
                style={{ cursor: 'pointer' }}
              >
                {tu(entry.labelKey)}
              </button>
            ))}
          </div>

          {loading && <Skeleton className="h-[260px] w-full" />}

          {!loading && failed && (
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
          )}

          {!loading && !failed && orders.length === 0 && (
            <EmptyState
              tone="empty"
              title={tu('noOrders')}
              body={tu('noOrdersBody')}
              action={
                <Link className="btn red" href="/">
                  {tu('continueShopping')}
                </Link>
              }
            />
          )}

          {!loading && !failed && orders.length > 0 && (
            <>
              <div className="acct-panel">
                {orders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/orders/${order.id}`}
                    className="acct-order-row"
                  >
                    <div>
                      <div className="acct-order-num">{order.orderNumber}</div>
                      <div className="acct-order-meta">
                        <OrderStatusBadge status={order.status} />
                        <span>{formatDate(order.createdAt, lang)}</span>
                        <span>
                          {order.items.length} {tu('items')}
                        </span>
                      </div>
                    </div>

                    <span className="acct-order-amount">
                      {formatMoney(order.totalAmountPoisha, lang)}
                    </span>
                  </Link>
                ))}
              </div>

              {/* ── pagination ──────────────────────────────────────────── */}
              {totalPages > 1 && (
                <div className="acct-actions" style={{ justifyContent: 'space-between' }}>
                  <button
                    type="button"
                    className="btn line"
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    disabled={page <= 1}
                  >
                    ← {tu('previous')}
                  </button>

                  <span className="acct-muted">
                    {page} {tu('of')} {totalPages} · {total} {tu('items')}
                  </span>

                  <button
                    type="button"
                    className="btn line"
                    onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={page >= totalPages}
                  >
                    {tu('next')} →
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="acct-aside">
          <AccountNav active="orders" />
        </aside>
      </div>
    </div>
  );
}

/** `12 Nov 2026` — locale-aware, no time (an order date is a day, not a clock). */
function formatDate(iso: string, lang: 'en' | 'bn'): string {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}
