/**
 * Suppliers — `/admin/suppliers` (Phase 10 pass D).
 *
 * Server component: reads the query string, fetches one page of suppliers, and
 * hands it to the client island. Everything that mutates lives in the island; this
 * file never writes.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type { SupplierListResponse, SupplierSort } from '@/lib/api/admin-suppliers';
import { SuppliersTable, SuppliersToolbar } from '@/components/admin/suppliers-table';

export const metadata: Metadata = {
  title: 'Suppliers',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function SuppliersPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const q = one(params.q) ?? '';
  const active = one(params.active) ?? 'all';
  const sort = (one(params.sort) ?? 'newest') as SupplierSort;
  const page = Math.max(1, Number(one(params.page) ?? 1) || 1);
  const limit = 20;

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (active !== 'all') query.set('active', active);
  if (sort !== 'newest') query.set('sort', sort);
  query.set('page', String(page));
  query.set('limit', String(limit));

  let data: SupplierListResponse | null = null;
  let error: string | null = null;

  try {
    const response = await adminFetchServer<SupplierListResponse>(
      `/admin/suppliers?${query.toString()}`,
    );
    data = response.data;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'সরবরাহকারী লোড করা যায়নি।'
          : 'Could not load suppliers.';
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
    return `/admin/suppliers?${next.toString()}`;
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'সরবরাহকারী' : 'Suppliers'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${total}টি সরবরাহকারী · ক্রয় অর্ডার ও স্টক গ্রহণ`
              : `${total} suppliers · purchase orders and receiving`}
          </p>
        </div>
      </div>

      <SuppliersToolbar lang={lang} initialQuery={q} active={active} sort={sort} />

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card prod-empty">
          <p>
            {lang === 'bn'
              ? 'কোনো সরবরাহকারী নেই। নতুন একটা যোগ করুন।'
              : 'No suppliers yet. Add one.'}
          </p>
        </div>
      ) : (
        <SuppliersTable
          lang={lang}
          items={items}
          total={total}
          page={page}
          totalPages={totalPages}
          prevHref={page > 1 ? hrefWith({ page: String(page - 1) }) : null}
          nextHref={page < totalPages ? hrefWith({ page: String(page + 1) }) : null}
          queryString={query.toString()}
          openNew={one(params.new) === '1'}
          openId={one(params.open) ?? null}
        />
      )}
    </>
  );
}
