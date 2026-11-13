/**
 * Reports — `/admin/reports` (Phase 10 pass F).
 *
 * Server component with a plain GET form for the date range. No client island:
 * every figure is read-only, and the export is a link, so there is nothing here
 * that needs JavaScript.
 *
 * ── What this screen is careful to say ─────────────────────────────────────
 *
 * "Revenue" excludes cancelled and returned orders, and "delivered revenue" is the
 * narrower figure for orders that completed. Both are shown, labelled, because the
 * two answers to "how much did we make" differ and picking one silently is how a
 * report gets misread.
 *
 * There is no profit line. `Product` has no cost field, and expenses are shown
 * separately — revenue minus expenses is a cash view, not margin.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import { formatMoneyAdmin } from '@/lib/format';
import { exportUrl, type ReportPayload } from '@/lib/api/admin-reports';

export const metadata: Metadata = {
  title: 'Reports',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatDay(day: string, lang: 'en' | 'bn'): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const from = one(params.from) ?? daysAgo(29);
  const to = one(params.to) ?? today();

  const query = new URLSearchParams({ from, to });

  let data: ReportPayload | null = null;
  let error: string | null = null;

  try {
    const response = await adminFetchServer<ReportPayload>(`/admin/reports?${query.toString()}`);
    data = response.data;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'রিপোর্ট লোড করা যায়নি।'
          : 'Could not load the report.';
  }

  const summary = data?.summary;
  const series = data?.series ?? [];
  const peak = Math.max(1, ...series.map((point) => point.revenuePoisha));

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'রিপোর্ট' : 'Reports'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${from} — ${to} · বাতিল ও ফেরত বাদ দিয়ে`
              : `${from} — ${to} · cancelled and returned excluded`}
          </p>
        </div>
      </div>

      <form className="prod-toolbar ord-toolbar" action="/admin/reports" method="get">
        <div className="prod-filters">
          <input type="date" name="from" defaultValue={from} className="ord-date" aria-label="From" />
          <input type="date" name="to" defaultValue={to} className="ord-date" aria-label="To" />
          <button type="submit" className="btn sm">
            {lang === 'bn' ? 'দেখুন' : 'Run'}
          </button>
          <Link className="btn ghost sm" href="/admin/reports">
            {lang === 'bn' ? '৩০ দিন' : 'Last 30 days'}
          </Link>

          {data && (
            <>
              <a className="btn ghost sm" href={exportUrl('orders', from, to)}>
                {lang === 'bn' ? 'অর্ডার CSV' : 'Orders CSV'}
              </a>
              <a className="btn ghost sm" href={exportUrl('products', from, to)}>
                {lang === 'bn' ? 'পণ্য CSV' : 'Products CSV'}
              </a>
            </>
          )}
        </div>
      </form>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : !summary ? null : (
        <>
          <div className="exp-summary">
            <div className="exp-summary-total">
              <span>{lang === 'bn' ? 'আয় (বাতিল বাদে)' : 'Revenue (excl. cancelled)'}</span>
              <b>{formatMoneyAdmin(summary.revenuePoisha)}</b>
              <small>
                {summary.orders} {lang === 'bn' ? 'অর্ডার' : 'orders'} ·{' '}
                {lang === 'bn' ? 'গড়' : 'avg'} {formatMoneyAdmin(summary.averageOrderPoisha)}
              </small>
            </div>

            <div className="exp-summary-item">
              <span>{lang === 'bn' ? 'ডেলিভারি সম্পন্ন' : 'Delivered'}</span>
              <b>{formatMoneyAdmin(summary.deliveredRevenuePoisha)}</b>
              <small>
                {summary.deliveredOrders} {lang === 'bn' ? 'অর্ডার' : 'orders'}
              </small>
            </div>

            <div className="exp-summary-item">
              <span>{lang === 'bn' ? 'ছাড়' : 'Discount given'}</span>
              <b>{formatMoneyAdmin(summary.discountPoisha)}</b>
              <small>{lang === 'bn' ? 'কুপন ও অফার' : 'coupons and offers'}</small>
            </div>

            <div className="exp-summary-item">
              <span>{lang === 'bn' ? 'খরচ' : 'Expenses'}</span>
              <b>{formatMoneyAdmin(summary.expensesPoisha)}</b>
              <small>{lang === 'bn' ? 'এই সময়ে' : 'in range'}</small>
            </div>

            <div className="exp-summary-item">
              <span>{lang === 'bn' ? 'আয় − খরচ' : 'Revenue − expenses'}</span>
              <b>{formatMoneyAdmin(summary.revenueMinusExpensesPoisha)}</b>
              <small>{lang === 'bn' ? 'মুনাফা নয়, নগদ দৃশ্য' : 'cash view, not profit'}</small>
            </div>
          </div>

          <div className="card rep-card">
            <h2>{lang === 'bn' ? 'দৈনিক আয়' : 'Daily revenue'}</h2>
            {series.length === 0 ? (
              <p className="cpn-hint">
                {lang === 'bn' ? 'এই সময়ে কোনো অর্ডার নেই।' : 'No orders in this range.'}
              </p>
            ) : (
              <div className="rep-bars">
                {series.map((point) => (
                  <div key={point.day} className="rep-bar">
                    <div
                      className="rep-bar-fill"
                      style={{ height: `${Math.max(4, Math.round((point.revenuePoisha / peak) * 100))}%` }}
                      title={`${point.day}: ${formatMoneyAdmin(point.revenuePoisha)}`}
                    />
                    <span>{formatDay(point.day, lang)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rep-grid">
            <div className="card rep-card">
              <h2>{lang === 'bn' ? 'সেরা পণ্য' : 'Top products'}</h2>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">{lang === 'bn' ? 'পণ্য' : 'Product'}</th>
                    <th scope="col">{lang === 'bn' ? 'সংখ্যা' : 'Qty'}</th>
                    <th scope="col">{lang === 'bn' ? 'আয়' : 'Revenue'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.topProducts.map((row) => (
                    <tr key={row.productId}>
                      <td data-label={lang === 'bn' ? 'পণ্য' : 'Product'}>
                        {row.nameEn}
                        <div className="cpn-sub">{row.sku}</div>
                      </td>
                      <td data-label={lang === 'bn' ? 'সংখ্যা' : 'Qty'}>{row.quantity}</td>
                      <td data-label={lang === 'bn' ? 'আয়' : 'Revenue'}>
                        {formatMoneyAdmin(row.revenuePoisha)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card rep-card">
              <h2>{lang === 'bn' ? 'ক্যাটাগরি' : 'Categories'}</h2>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">{lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}</th>
                    <th scope="col">{lang === 'bn' ? 'সংখ্যা' : 'Qty'}</th>
                    <th scope="col">{lang === 'bn' ? 'আয়' : 'Revenue'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.categories.map((row) => (
                    <tr key={row.id}>
                      <td data-label={lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}>{row.name}</td>
                      <td data-label={lang === 'bn' ? 'সংখ্যা' : 'Qty'}>{row.quantity}</td>
                      <td data-label={lang === 'bn' ? 'আয়' : 'Revenue'}>
                        {formatMoneyAdmin(row.revenuePoisha)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card rep-card">
              <h2>{lang === 'bn' ? 'ব্র্যান্ড' : 'Brands'}</h2>
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">{lang === 'bn' ? 'ব্র্যান্ড' : 'Brand'}</th>
                    <th scope="col">{lang === 'bn' ? 'সংখ্যা' : 'Qty'}</th>
                    <th scope="col">{lang === 'bn' ? 'আয়' : 'Revenue'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.brands.map((row) => (
                    <tr key={row.id}>
                      <td data-label={lang === 'bn' ? 'ব্র্যান্ড' : 'Brand'}>{row.name}</td>
                      <td data-label={lang === 'bn' ? 'সংখ্যা' : 'Qty'}>{row.quantity}</td>
                      <td data-label={lang === 'bn' ? 'আয়' : 'Revenue'}>
                        {formatMoneyAdmin(row.revenuePoisha)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="cpn-hint" style={{ marginTop: 14 }}>
            {lang === 'bn'
              ? 'ক্যাটাগরি ও ব্র্যান্ড বর্তমান পণ্য-তথ্য থেকে হিসাব হয় — পণ্য ক্যাটাগরি বদলালে পুরনো বিক্রিও নতুন ক্যাটাগরিতে দেখাবে।'
              : 'Category and brand rollups use the product’s current attributes — moving a product to another category re-attributes its older sales.'}
          </p>
        </>
      )}
    </>
  );
}
