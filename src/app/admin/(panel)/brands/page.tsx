/**
 * Brands — `/admin/brands`.
 *
 * A server component: it reads the query string, fetches once from
 * `GET /api/v1/admin/brands`, and hands the rows to the client island. Every
 * figure (`productCount`, `sortOrder`) arrives from the endpoint.
 *
 * ── Scope decision in B5, not by oversight ─────────────────────────────────
 *
 * Reorder is button-based (up/down per row) rather than drag-and-drop: both call
 * `POST /admin/brands/reorder` with the same complete id list and produce the
 * same dense `sortOrder`, and the buttons work on touch and with a keyboard.
 * CSV export is absent — 25 brands do not need one. Bulk select and the sticky
 * bulk bar are absent because the API exposes no bulk operation for brands, so
 * the bar would be decoration. Create and edit forms are not in this pass.
 *
 * ── The delete contract this screen has to honour ──────────────────────────
 *
 * Brand delete is `SET NULL` on products, which means the delete succeeds
 * silently and the products lose their brand. The API therefore refuses a brand
 * with products unless `?detach=true` was sent, and this screen never sends that
 * flag without the operator having read the count and pressed the button that
 * says so. See `brands-table.tsx`.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import { NewBrandButton } from '@/components/admin/brand-create';
import {
  BrandsTable,
  type ActiveFilter,
  type BrandListResponse,
  type BrandRow,
  type BrandSort,
} from '@/components/admin/brands-table';

export const metadata: Metadata = {
  title: 'Brands',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

const VALID_ACTIVE: ActiveFilter[] = ['all', 'true', 'false'];
const VALID_SORT: BrandSort[] = ['sortOrder', 'name', 'products'];

interface MeResponse {
  permissions: string[];
}

export default async function BrandsPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const q = (one(params.q) ?? '').trim();
  const rawActive = one(params.active) ?? 'all';
  const active: ActiveFilter = VALID_ACTIVE.includes(rawActive as ActiveFilter)
    ? (rawActive as ActiveFilter)
    : 'all';
  const rawSort = one(params.sort) ?? 'sortOrder';
  const sort: BrandSort = VALID_SORT.includes(rawSort as BrandSort)
    ? (rawSort as BrandSort)
    : 'sortOrder';

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (active !== 'all') query.set('active', active);
  if (sort !== 'sortOrder') query.set('sort', sort);

  let items: BrandRow[] = [];
  let total = 0;
  let canWrite = false;
  let error: string | null = null;

  try {
    const [list, me] = await Promise.all([
      adminFetchServer<BrandListResponse>(`/admin/brands?${query.toString()}`),
      adminFetchServer<MeResponse>('/admin/me'),
    ]);

    items = list.data.items;
    total = list.data.total;
    canWrite = me.data.permissions.includes('catalog:write');
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'ব্র্যান্ড লোড করা যায়নি।'
          : 'Could not load brands.';
  }

  /** Admin surface uses lakh grouping (AGENTS.md §3). */
  const num = (value: number) => value.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN');

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'ব্র্যান্ড' : 'Brands'}</h1>
          <p className="sub">
            {lang === 'bn' ? `${num(total)}টি ব্র্যান্ড` : `${num(total)} brands`}
          </p>
        </div>
        <NewBrandButton lang={lang} canWrite={canWrite} />
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <BrandsTable
          lang={lang}
          items={items}
          total={total}
          q={q}
          active={active}
          sort={sort}
          canWrite={canWrite}
        />
      )}
    </>
  );
}
