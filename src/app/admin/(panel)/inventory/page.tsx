/**
 * Inventory — `/admin/inventory`.
 *
 * A server component: it reads the query string, fetches once from
 * `GET /api/v1/admin/inventory` plus `/alerts`, and renders. No figure on this
 * page is computed in the browser — the stock of record, the status badge and
 * every KPI arrive from the endpoint, because the rule that decides them spans
 * `ProductVariant` and `WarehouseStock` and the storefront and checkout must
 * agree with it. One implementation, on the server.
 *
 * ── The two tabs ───────────────────────────────────────────────────────────
 *
 * `?view=stock` (default) is the shelf. `?view=movements` is the log, newest
 * first. Both live in the URL so a filtered view survives a refresh and the back
 * button does what the operator expects. The log is a tab rather than a separate
 * route because it is the answer to "why is this number what it is", which is
 * always asked from the shelf.
 *
 * ── No money on this screen ────────────────────────────────────────────────
 *
 * There is no stock-value column. `Product` has no cost field, so a valuation
 * would be invented data. The reference shows one; this schema cannot support
 * it, and a fabricated figure on an inventory screen is worse than a missing
 * column. Recorded in HANDOFF.md.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, Boxes, PackageX, TrendingDown } from 'lucide-react';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type {
  InventoryAlerts,
  InventoryListItem,
  InventoryListResponse,
  InventorySort,
  InventoryStockFilter,
  MovementListResponse,
  MovementRow,
} from '@/lib/api/admin-inventory';
import { InventoryTable, InventoryToolbar, MovementTable } from '@/components/admin/inventory-table';

export const metadata: Metadata = {
  title: 'Inventory',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Admin surface uses lakh grouping (AGENTS.md §3). */
function num(value: number, lang: 'en' | 'bn'): string {
  return value.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN');
}

export default async function InventoryPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const view = (one(params.view) ?? 'stock') as 'stock' | 'movements';
  const q = one(params.q) ?? '';
  const stock = (one(params.stock) ?? 'all') as InventoryStockFilter;
  const sort = (one(params.sort) ?? 'name_asc') as InventorySort;
  const page = Math.max(1, Number(one(params.page) ?? 1) || 1);
  const limit = 20;

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (stock !== 'all') query.set('stock', stock);
  if (sort !== 'name_asc') query.set('sort', sort);
  if (view !== 'stock') query.set('view', view);
  query.set('page', String(page));
  query.set('limit', String(limit));

  /**
   * The list request must not carry `view`.
   *
   * `adminInventoryListQuery` is `.strict()`, so an unknown key is a 422 — and
   * `view` is a page concern, not an API one. Sending it made the Movements tab
   * render "Request validation failed" with every KPI at zero, because the list
   * call failed and took the alerts call down with it in the same `Promise.all`.
   * Caught live, not by types: the query string is untyped all the way down.
   */
  const listQuery = new URLSearchParams(query.toString());
  listQuery.delete('view');

  let items: InventoryListItem[] = [];
  let movements: MovementRow[] = [];
  let total = 0;
  let alerts: InventoryAlerts | null = null;
  let error: string | null = null;

  try {
    const [list, alertData] = await Promise.all([
      adminFetchServer<InventoryListResponse>(`/admin/inventory?${listQuery.toString()}`),
      adminFetchServer<InventoryAlerts>('/admin/inventory/alerts'),
    ]);
    items = list.data.items;
    total = list.data.total;
    alerts = alertData.data;
  } catch (caught) {
    if (caught instanceof AdminApiError) {
      error = caught.message;
    } else {
      error = lang === 'bn' ? 'ইনভেন্টরি লোড করা যায়নি।' : 'Could not load inventory.';
    }
  }

  // The movement log is fetched only when that tab is open — a second request on
  // the shelf view would be work nobody asked for.
  if (view === 'movements' && !error) {
    try {
      const logQuery = new URLSearchParams();
      // No `q`: the movements endpoint filters by productId and type, not by
      // free text, and its schema is `.strict()`. The search box belongs to the
      // shelf tab.
      logQuery.set('page', String(page));
      logQuery.set('limit', String(limit));
      const log = await adminFetchServer<MovementListResponse>(
        `/admin/inventory/movements?${logQuery.toString()}`,
      );
      movements = log.data.items;
      total = log.data.total;
    } catch (caught) {
      error =
        caught instanceof AdminApiError
          ? caught.message
          : lang === 'bn'
            ? 'মুভমেন্ট লগ লোড করা যায়নি।'
            : 'Could not load the movement log.';
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function hrefWith(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams(query.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    return `/admin/inventory?${next.toString()}`;
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'ইনভেন্টরি' : 'Inventory'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${num(alerts?.skus ?? 0, lang)}টি পণ্য · ${num(alerts?.units ?? 0, lang)} ইউনিট`
              : `${num(alerts?.skus ?? 0, lang)} products · ${num(alerts?.units ?? 0, lang)} units`}
          </p>
        </div>
      </div>

      {/* ── KPI strip. Every number comes from /alerts; nothing is counted in
             the browser. ─────────────────────────────────────────────────── */}
      <section className="grid-4 inv-kpis" aria-label={lang === 'bn' ? 'স্টক সারসংক্ষেপ' : 'Stock summary'}>
        <article className="card kpi">
          <div className="label">
            <PackageX size={18} aria-hidden />
            {lang === 'bn' ? 'স্টক নেই' : 'Out of stock'}
          </div>
          <div className="value">{num(alerts?.out ?? 0, lang)}</div>
          <div className="foot">
            <span>{lang === 'bn' ? 'পণ্য শূন্যে' : 'products at zero'}</span>
          </div>
        </article>

        <article className="card kpi">
          <div className="label">
            <TrendingDown size={18} aria-hidden />
            {lang === 'bn' ? 'কম স্টক' : 'Low stock'}
          </div>
          <div className="value">{num(alerts?.low ?? 0, lang)}</div>
          <div className="foot">
            <span>{lang === 'bn' ? '৫ বা তার কম' : '5 units or fewer'}</span>
          </div>
        </article>

        <article className="card kpi">
          <div className="label">
            <Boxes size={18} aria-hidden />
            {lang === 'bn' ? 'মোট ইউনিট' : 'Total units'}
          </div>
          <div className="value">{num(alerts?.units ?? 0, lang)}</div>
          <div className="foot">
            <span>{lang === 'bn' ? 'প্রকৃত স্টক অনুযায়ী' : 'across stock of record'}</span>
          </div>
        </article>

        <article className="card kpi">
          <div className="label">
            <AlertTriangle size={18} aria-hidden />
            {lang === 'bn' ? 'ট্র্যাক করা SKU' : 'SKUs tracked'}
          </div>
          <div className="value">{num(alerts?.skus ?? 0, lang)}</div>
          <div className="foot">
            <span>
              {lang === 'bn'
                ? `${num(alerts?.in ?? 0, lang)}টি স্টকে আছে`
                : `${num(alerts?.in ?? 0, lang)} in stock`}
            </span>
          </div>
        </article>
      </section>

      {/* View tabs. Links, so the tab survives a refresh and is shareable. */}
      <div className="seg inv-tabs" role="tablist" aria-label={lang === 'bn' ? 'দৃশ্য' : 'View'}>
        <Link
          href={hrefWith({ view: undefined, page: undefined })}
          className={view === 'stock' ? 'on' : undefined}
          role="tab"
          aria-selected={view === 'stock'}
        >
          {lang === 'bn' ? 'স্টক' : 'Stock'}
        </Link>
        <Link
          href={hrefWith({ view: 'movements', page: undefined })}
          className={view === 'movements' ? 'on' : undefined}
          role="tab"
          aria-selected={view === 'movements'}
        >
          {lang === 'bn' ? 'মুভমেন্ট' : 'Movements'}
        </Link>
      </div>

      {view === 'stock' && (
        <InventoryToolbar lang={lang} initialQuery={q} stock={stock} sort={sort} view={view} />
      )}

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : view === 'movements' ? (
        <MovementTable
          lang={lang}
          items={movements}
          total={total}
          page={page}
          limit={limit}
          totalPages={totalPages}
          prevHref={page > 1 ? hrefWith({ page: String(page - 1) }) : null}
          nextHref={page < totalPages ? hrefWith({ page: String(page + 1) }) : null}
        />
      ) : items.length === 0 ? (
        <div className="card inv-empty">
          <p>
            {lang === 'bn'
              ? 'কোনো পণ্য মেলেনি। ফিল্টার বদলান বা অন্য কিছু খুঁজুন।'
              : 'No products match. Change the filters or search for something else.'}
          </p>
        </div>
      ) : (
        <InventoryTable
          lang={lang}
          items={items}
          total={total}
          page={page}
          limit={limit}
          totalPages={totalPages}
          prevHref={page > 1 ? hrefWith({ page: String(page - 1) }) : null}
          nextHref={page < totalPages ? hrefWith({ page: String(page + 1) }) : null}
          canWrite
        />
      )}
    </>
  );
}
