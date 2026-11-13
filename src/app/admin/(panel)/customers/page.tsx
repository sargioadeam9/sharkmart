/**
 * Customers — `/admin/customers` (Phase 10 pass G, CRM).
 *
 * Server component: reads the query string, fetches one page of the selected
 * segment, renders the tabs and hands the rows to the island.
 *
 * The segment counts are not fetched separately: each tab is a `Link` that re-runs
 * this query with a different `HAVING`, and the total on the page is that
 * segment's total. Four extra count queries to decorate four tabs would be four
 * more chances for a badge to disagree with the rows behind it.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type {
  CustomerListResponse,
  CustomerSegment,
  CustomerSort,
} from '@/lib/api/admin-customers';
import { CustomersTable, CustomersToolbar } from '@/components/admin/customers-table';

export const metadata: Metadata = {
  title: 'Customers',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const TABS: Array<{ key: CustomerSegment; en: string; bn: string }> = [
  { key: 'all', en: 'All', bn: 'সব' },
  { key: 'new', en: 'New', bn: 'নতুন' },
  { key: 'returning', en: 'Returning', bn: 'ফিরে আসা' },
  { key: 'high_value', en: 'High value', bn: 'বেশি খরচ' },
  { key: 'inactive', en: 'Inactive', bn: 'নিষ্ক্রিয়' },
];

export default async function CustomersPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const q = one(params.q) ?? '';
  const segment = (one(params.segment) ?? 'all') as CustomerSegment;
  const sort = (one(params.sort) ?? 'spend') as CustomerSort;
  const page = Math.max(1, Number(one(params.page) ?? 1) || 1);
  const limit = 20;

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (segment !== 'all') query.set('segment', segment);
  if (sort !== 'spend') query.set('sort', sort);
  query.set('page', String(page));
  query.set('limit', String(limit));

  let data: CustomerListResponse | null = null;
  let error: string | null = null;

  try {
    const response = await adminFetchServer<CustomerListResponse>(
      `/admin/customers?${query.toString()}`,
    );
    data = response.data;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'ক্রেতা লোড করা যায়নি।'
          : 'Could not load customers.';
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
    return `/admin/customers?${next.toString()}`;
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'ক্রেতা' : 'Customers'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${total} জন · বাতিল ও ফেরত বাদ দিয়ে হিসাব`
              : `${total} customers · cancelled and returned excluded`}
          </p>
        </div>
      </div>

      <div className="seg prod-tabs" role="tablist" aria-label={lang === 'bn' ? 'সেগমেন্ট' : 'Segment'}>
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={hrefWith({ segment: tab.key === 'all' ? undefined : tab.key })}
            className={segment === tab.key ? 'on' : undefined}
            role="tab"
            aria-selected={segment === tab.key}
          >
            {lang === 'bn' ? tab.bn : tab.en}
          </Link>
        ))}
      </div>

      <CustomersToolbar lang={lang} initialQuery={q} segment={segment} sort={sort} />

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card prod-empty">
          <p>
            {lang === 'bn'
              ? 'এই সেগমেন্টে কোনো ক্রেতা নেই।'
              : 'No customers in this segment.'}
          </p>
        </div>
      ) : (
        <CustomersTable
          lang={lang}
          items={items}
          total={total}
          page={page}
          totalPages={totalPages}
          prevHref={page > 1 ? hrefWith({ page: String(page - 1) }) : null}
          nextHref={page < totalPages ? hrefWith({ page: String(page + 1) }) : null}
          queryString={query.toString()}
          openId={one(params.open) ?? null}
        />
      )}

      <p className="cpn-hint" style={{ marginTop: 14 }}>
        {lang === 'bn'
          ? 'সেগমেন্টগুলো ওভারল্যাপ করে — একজন ফিরে আসা ক্রেতা একইসাথে বেশি খরচেরও হতে পারেন।'
          : 'Segments overlap on purpose — a returning customer can also be high value.'}
      </p>
    </>
  );
}
