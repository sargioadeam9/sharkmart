/**
 * Expenses — `/admin/expenses` (Phase 10 pass C).
 *
 * Server component: reads the query string, fetches the page, the filtered total
 * and the category summary, then renders. Every figure comes from an endpoint.
 *
 * The summary strip defaults to the current month and follows the date filter
 * when one is set. It prints its own range, so there is no ambiguity about what
 * the total covers — the mistake to avoid is a headline number whose period the
 * operator has to guess.
 */

import type { Metadata } from 'next';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type {
  ExpenseListResponse,
  ExpenseSort,
  ExpenseSummary,
} from '@/lib/api/admin-expenses';
import {
  ExpenseSummaryStrip,
  ExpensesTable,
  ExpensesToolbar,
} from '@/components/admin/expenses-table';

export const metadata: Metadata = {
  title: 'Expenses',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function ExpensesPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const q = one(params.q) ?? '';
  const category = one(params.category) ?? '';
  const from = one(params.from) ?? '';
  const to = one(params.to) ?? '';
  const sort = (one(params.sort) ?? 'newest') as ExpenseSort;
  const page = Math.max(1, Number(one(params.page) ?? 1) || 1);
  const limit = 20;

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (category) query.set('category', category);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (sort !== 'newest') query.set('sort', sort);
  query.set('page', String(page));
  query.set('limit', String(limit));

  const summaryQuery = new URLSearchParams();
  if (from) summaryQuery.set('from', from);
  if (to) summaryQuery.set('to', to);

  let data: ExpenseListResponse | null = null;
  let summary: ExpenseSummary | null = null;
  let categories: string[] = [];
  let error: string | null = null;

  try {
    const [list, strip, cats] = await Promise.all([
      adminFetchServer<ExpenseListResponse>(`/admin/expenses?${query.toString()}`),
      adminFetchServer<ExpenseSummary>(`/admin/expenses/summary?${summaryQuery.toString()}`),
      adminFetchServer<{ categories: string[] }>('/admin/expenses/categories'),
    ]);
    data = list.data;
    summary = strip.data;
    categories = cats.data.categories;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'খরচ লোড করা যায়নি।'
          : 'Could not load expenses.';
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
    return `/admin/expenses?${next.toString()}`;
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'খরচ' : 'Expenses'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${total}টি এন্ট্রি · ফিল্টার করা মোট ${data ? data.totalAmountPoisha / 100 : 0} টাকা`
              : `${total} entries · filtered total ৳${data ? Math.round(data.totalAmountPoisha / 100).toLocaleString('en-IN') : 0}`}
          </p>
        </div>
      </div>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : (
        <>
          {summary && <ExpenseSummaryStrip lang={lang} summary={summary} />}

          <ExpensesToolbar
            lang={lang}
            initialQuery={q}
            category={category}
            from={from}
            to={to}
            sort={sort}
            categories={categories}
          />

          {items.length === 0 && one(params.new) !== '1' && !one(params.edit) ? (
            /* Same trap as suppliers: the drawer lives in the table component. */
            <div className="card prod-empty">
              <p>
                {lang === 'bn'
                  ? 'কোনো খরচ পাওয়া যায়নি। নতুন একটা যোগ করুন।'
                  : 'No expenses here. Add one.'}
              </p>
            </div>
          ) : (
            <ExpensesTable
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
              categories={categories}
            />
          )}
        </>
      )}
    </>
  );
}
