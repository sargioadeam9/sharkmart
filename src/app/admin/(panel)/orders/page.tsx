/**
 * Orders list — `/admin/orders`.
 *
 * A server component: it reads the query string, fetches the page and the tab
 * counts from `GET /api/v1/admin/orders`, and renders. No figure on this page is
 * computed in the browser — the totals, the item counts and the status badges all
 * arrive from the endpoint.
 *
 * Filters live in the URL, not in component state, for the same reasons the
 * products list does: a filtered queue survives a refresh, is bookmarkable, and
 * `total` is honest because the server did the filtering.
 *
 * The interactive parts (search box, filter selects, the row drawer, the status
 * flow, the bulk bar) are one client island in
 * `components/admin/orders-table.tsx`.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type {
  AdminOrderCounts,
  AdminOrderListItem,
  AdminOrderListResponse,
  AdminOrderStatus,
} from '@/lib/api/admin-orders';
import { OrdersToolbar, OrdersTable } from '@/components/admin/orders-table';

export const metadata: Metadata = {
  title: 'Orders',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Reads a single query value, ignoring the array form. */
function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * The status tabs.
 *
 * These mirror the reference's `#ordTabs` exactly: All, Pending, Shipped,
 * Delivered, Cancelled. The remaining states — CONFIRMED, PROCESSING, RETURNED,
 * REFUND_PENDING, REFUNDED — are reachable through the status select in the
 * toolbar, which lists all nine. That select is not optional decoration: the
 * transition table allows PENDING -> CONFIRMED, so CONFIRMED orders are created
 * by the normal flow, and a returned order is a real state with real money
 * attached. Nine tabs on one row would be a wall of text, so the tabs stay as
 * the fast path and the select carries the full list.
 */
const TABS: Array<{ key: AdminOrderStatus | 'all'; en: string; bn: string }> = [
  { key: 'all', en: 'All', bn: 'সব' },
  { key: 'PENDING', en: 'Pending', bn: 'অপেক্ষমাণ' },
  { key: 'SHIPPED', en: 'Shipped', bn: 'পাঠানো হয়েছে' },
  { key: 'DELIVERED', en: 'Delivered', bn: 'বিতরণ করা হয়েছে' },
  { key: 'CANCELLED', en: 'Cancelled', bn: 'বাতিল' },
];

export default async function OrdersPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const q = one(params.q) ?? '';
  const status = (one(params.status) ?? 'all') as AdminOrderStatus | 'all';
  const paymentStatus = (one(params.paymentStatus) ?? 'all') as
    | 'all'
    | 'UNPAID'
    | 'PARTIALLY_PAID'
    | 'PAID'
    | 'REFUNDED';
  const customerType = (one(params.customerType) ?? 'all') as 'all' | 'guest' | 'registered';
  const from = one(params.from) ?? '';
  const to = one(params.to) ?? '';
  const sort = (one(params.sort) ?? 'newest') as 'newest' | 'oldest' | 'total_desc' | 'total_asc';
  const page = Math.max(1, Number(one(params.page) ?? 1) || 1);
  const limit = 20;

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (status !== 'all') query.set('status', status);
  if (paymentStatus !== 'all') query.set('paymentStatus', paymentStatus);
  if (customerType !== 'all') query.set('customerType', customerType);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (sort !== 'newest') query.set('sort', sort);
  query.set('page', String(page));
  query.set('limit', String(limit));

  let data: AdminOrderListResponse | null = null;
  let counts: AdminOrderCounts = { all: 0, byStatus: {} };
  let error: string | null = null;

  try {
    const [list, tabCounts] = await Promise.all([
      adminFetchServer<AdminOrderListResponse>(`/admin/orders?${query.toString()}`),
      adminFetchServer<AdminOrderCounts>('/admin/orders/counts'),
    ]);
    data = list.data;
    counts = tabCounts.data;
  } catch (caught) {
    if (caught instanceof AdminApiError) {
      error = caught.message;
    } else {
      error = lang === 'bn' ? 'অর্ডার লোড করা যায়নি।' : 'Could not load orders.';
    }
  }

  const items: AdminOrderListItem[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  /** Preserves the current filters while changing one of them. */
  function hrefWith(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams(query.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    return `/admin/orders?${next.toString()}`;
  }

  /** The count shown on a tab: the whole book, not the current filter. */
  function countFor(key: AdminOrderStatus | 'all'): number {
    return key === 'all' ? counts.all : (counts.byStatus[key] ?? 0);
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'অর্ডার' : 'Orders'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${total}টি অর্ডার · ${items.length}টি দেখানো হচ্ছে`
              : `${total} order${total === 1 ? '' : 's'} · showing ${items.length}`}
          </p>
        </div>
      </div>

      {/* Status tabs. Each is a link, so the filter survives a refresh and the
          URL is shareable. The count is the whole book for that status, which is
          what an operator triaging a queue expects. */}
      <div className="seg prod-tabs" role="tablist" aria-label={lang === 'bn' ? 'অবস্থা' : 'Status'}>
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={hrefWith({ status: tab.key === 'all' ? undefined : tab.key, page: undefined })}
            className={status === tab.key ? 'on' : undefined}
            role="tab"
            aria-selected={status === tab.key}
          >
            {lang === 'bn' ? tab.bn : tab.en}
            <span className="ord-tab-count">{countFor(tab.key)}</span>
          </Link>
        ))}
      </div>

      <OrdersToolbar
        lang={lang}
        initialQuery={q}
        status={status}
        paymentStatus={paymentStatus}
        customerType={customerType}
        from={from}
        to={to}
        sort={sort}
      />

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card prod-empty">
          <p>
            {lang === 'bn'
              ? 'কোনো অর্ডার পাওয়া যায়নি। ফিল্টার বদলান।'
              : 'No orders match. Change the filters.'}
          </p>
        </div>
      ) : (
        <OrdersTable
          lang={lang}
          items={items}
          total={total}
          page={page}
          totalPages={totalPages}
          prevHref={page > 1 ? hrefWith({ page: String(page - 1) }) : null}
          nextHref={page < totalPages ? hrefWith({ page: String(page + 1) }) : null}
        />
      )}
    </>
  );
}
