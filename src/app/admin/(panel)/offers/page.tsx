/**
 * Offers and coupons — `/admin/offers` (Phase 10 pass A).
 *
 * A server component: it reads the query string, fetches the page and the state
 * counts, and renders. Filters live in the URL, so a filtered view survives a
 * refresh and `total` is honest because the server did the filtering.
 *
 * The interactive parts — search, the type filter, the create/edit drawer and the
 * redemption report — are one client island in `components/admin/coupons-table.tsx`.
 *
 * ── Why the tabs are derived state, not a stored column ────────────────────
 *
 * A coupon is "live" because the clock is inside its window and its counter is
 * under the cap, not because a row says so. The server computes all five states
 * in SQL (see `coupon.service.ts`), so the tab counts and the rows they open
 * always agree. A stored status column would drift the first midnight after it
 * was written.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type {
  CouponCounts,
  CouponListResponse,
  CouponStateFilter,
} from '@/lib/api/admin-coupons';
import { CouponsTable, CouponsToolbar } from '@/components/admin/coupons-table';

export const metadata: Metadata = {
  title: 'Offers and coupons',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const TABS: Array<{ key: CouponStateFilter; en: string; bn: string }> = [
  { key: 'all', en: 'All', bn: 'সব' },
  { key: 'live', en: 'Live', bn: 'চালু' },
  { key: 'scheduled', en: 'Scheduled', bn: 'নির্ধারিত' },
  { key: 'expired', en: 'Expired', bn: 'মেয়াদোত্তীর্ণ' },
  { key: 'exhausted', en: 'Exhausted', bn: 'শেষ' },
  { key: 'inactive', en: 'Inactive', bn: 'নিষ্ক্রিয়' },
];

export default async function OffersPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const q = one(params.q) ?? '';
  const type = one(params.type) ?? '';
  const state = (one(params.state) ?? 'all') as CouponStateFilter;
  const sort = (one(params.sort) ?? 'newest') as 'newest' | 'oldest' | 'used' | 'ending';
  const page = Math.max(1, Number(one(params.page) ?? 1) || 1);
  const limit = 20;

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (type) query.set('type', type);
  if (state !== 'all') query.set('state', state);
  if (sort !== 'newest') query.set('sort', sort);
  query.set('page', String(page));
  query.set('limit', String(limit));

  let data: CouponListResponse | null = null;
  let counts: CouponCounts = { all: 0, live: 0, scheduled: 0, expired: 0, exhausted: 0, inactive: 0 };
  let error: string | null = null;

  try {
    const [list, tabCounts] = await Promise.all([
      adminFetchServer<CouponListResponse>(`/admin/coupons?${query.toString()}`),
      adminFetchServer<CouponCounts>('/admin/coupons/counts'),
    ]);
    data = list.data;
    counts = tabCounts.data;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'কুপন লোড করা যায়নি।'
          : 'Could not load coupons.';
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  function hrefWith(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams(query.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    return `/admin/offers?${next.toString()}`;
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'অফার ও কুপন' : 'Offers and coupons'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${total}টি কুপন · ${counts.live}টি এখন চালু`
              : `${total} coupon${total === 1 ? '' : 's'} · ${counts.live} live now`}
          </p>
        </div>
      </div>

      <div className="seg prod-tabs" role="tablist" aria-label={lang === 'bn' ? 'অবস্থা' : 'State'}>
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={hrefWith({ state: tab.key === 'all' ? undefined : tab.key })}
            className={state === tab.key ? 'on' : undefined}
            role="tab"
            aria-selected={state === tab.key}
          >
            {lang === 'bn' ? tab.bn : tab.en}
            <span className="ord-tab-count">{counts[tab.key]}</span>
          </Link>
        ))}
      </div>

      <CouponsToolbar lang={lang} initialQuery={q} type={type} sort={sort} state={state} />

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card prod-empty">
          <p>
            {lang === 'bn'
              ? 'কোনো কুপন নেই। নতুন একটা বানান।'
              : 'No coupons here. Create one.'}
          </p>
        </div>
      ) : (
        <CouponsTable
          lang={lang}
          items={items}
          total={total}
          page={page}
          totalPages={totalPages}
          prevHref={page > 1 ? hrefWith({ page: String(page - 1) }) : null}
          nextHref={page < totalPages ? hrefWith({ page: String(page + 1) }) : null}
          queryString={query.toString()}
          openNew={one(params.new) === '1'}
          editId={one(params.edit) ?? null}
          redeemId={one(params.redeem) ?? null}
        />
      )}
    </>
  );
}
