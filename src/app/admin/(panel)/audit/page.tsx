/**
 * Audit log — `/admin/audit` (Phase 10 pass C, System).
 *
 * A server component with a plain GET form for its filters. No client island:
 * the filters are URL state, so a form submission does exactly what a debounced
 * search box would do, without shipping JavaScript for it. On a screen whose job
 * is "show me what happened", the simplest thing that works is the right thing.
 *
 * The table shows the action, the entity, who did it and when. The `changes`
 * payload is not rendered inline — it is a JSON blob whose shape differs per
 * action, and dumping it into a table cell makes every row unreadable. It is
 * available per row in a `<details>` block instead, which is where someone who
 * actually needs it will look.
 */

import type { Metadata } from 'next';
import Link from 'next/link';

import { adminFetchServer, AdminApiError } from '@/lib/api/admin';
import { getLang } from '@/lib/locale';
import type { AuditEntry, AuditListResponse } from '@/lib/api/admin-audit';

export const metadata: Metadata = {
  title: 'Audit log',
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function formatDateTime(iso: string, lang: 'en' | 'bn'): string {
  return new Date(iso).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** `product.update` → `update` on `product`, so the badge tone can follow the verb. */
function toneFor(action: string): string {
  if (action.endsWith('.create') || action.endsWith('.add')) return 'ok';
  if (action.endsWith('.delete') || action.endsWith('.archive')) return 'bad';
  if (action.includes('activate') || action.includes('publish')) return 'info';
  return 'warn';
}

export default async function AuditPage({ searchParams }: PageProps) {
  const lang = await getLang();
  const params = await searchParams;

  const q = one(params.q) ?? '';
  const entity = one(params.entity) ?? '';
  const from = one(params.from) ?? '';
  const to = one(params.to) ?? '';
  const page = Math.max(1, Number(one(params.page) ?? 1) || 1);
  const limit = 50;

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (entity) query.set('entity', entity);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  query.set('page', String(page));
  query.set('limit', String(limit));

  let data: AuditListResponse | null = null;
  let error: string | null = null;

  try {
    const response = await adminFetchServer<AuditListResponse>(`/admin/audit?${query.toString()}`);
    data = response.data;
  } catch (caught) {
    error =
      caught instanceof AdminApiError
        ? caught.message
        : lang === 'bn'
          ? 'অডিট লগ লোড করা যায়নি।'
          : 'Could not load the audit log.';
  }

  const entries: AuditEntry[] = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  function hrefWith(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams(query.toString());
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    return `/admin/audit?${next.toString()}`;
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{lang === 'bn' ? 'অডিট লগ' : 'Audit log'}</h1>
          <p className="sub">
            {lang === 'bn'
              ? `${total}টি এন্ট্রি · নতুন আগে`
              : `${total} entries · newest first`}
          </p>
        </div>
      </div>

      <form className="prod-toolbar ord-toolbar" action="/admin/audit" method="get">
        <div className="prod-search">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={
              lang === 'bn' ? 'অ্যাকশন, এন্টিটি বা আইডি' : 'Action, entity or record id'
            }
            aria-label={lang === 'bn' ? 'অডিট খুঁজুন' : 'Search the audit log'}
          />
        </div>

        <div className="prod-filters">
          <select name="entity" defaultValue={entity} aria-label={lang === 'bn' ? 'এন্টিটি' : 'Entity'}>
            <option value="">{lang === 'bn' ? 'সব এন্টিটি' : 'All entities'}</option>
            <option value="product">product</option>
            <option value="order">order</option>
            <option value="coupon">coupon</option>
            <option value="expense">expense</option>
            <option value="setting">setting</option>
            <option value="review">review</option>
            <option value="category">category</option>
            <option value="brand">brand</option>
          </select>

          <input type="date" name="from" defaultValue={from} className="ord-date" aria-label={lang === 'bn' ? 'শুরু' : 'From'} />
          <input type="date" name="to" defaultValue={to} className="ord-date" aria-label={lang === 'bn' ? 'শেষ' : 'To'} />

          <button type="submit" className="btn sm">
            {lang === 'bn' ? 'ফিল্টার' : 'Filter'}
          </button>

          {(q || entity || from || to) && (
            <Link className="btn ghost sm" href="/admin/audit">
              {lang === 'bn' ? 'মুছুন' : 'Clear'}
            </Link>
          )}
        </div>
      </form>

      {error ? (
        <div className="card">
          <p style={{ color: 'var(--bad)' }}>{error}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="card prod-empty">
          <p>
            {lang === 'bn'
              ? 'কোনো এন্ট্রি নেই। ফিল্টার বদলান।'
              : 'No entries match. Change the filters.'}
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th scope="col">{lang === 'bn' ? 'সময়' : 'When'}</th>
                  <th scope="col">{lang === 'bn' ? 'কে' : 'Who'}</th>
                  <th scope="col">{lang === 'bn' ? 'কাজ' : 'Action'}</th>
                  <th scope="col">{lang === 'bn' ? 'এন্টিটি' : 'Entity'}</th>
                  <th scope="col">{lang === 'bn' ? 'বিস্তারিত' : 'Detail'}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td data-label={lang === 'bn' ? 'সময়' : 'When'}>
                      {formatDateTime(entry.createdAt, lang)}
                    </td>
                    <td data-label={lang === 'bn' ? 'কে' : 'Who'}>
                      {entry.userName ?? '—'}
                      {entry.userRole && <div className="cpn-sub">{entry.userRole}</div>}
                    </td>
                    <td data-label={lang === 'bn' ? 'কাজ' : 'Action'}>
                      <span className={`badge ${toneFor(entry.action)}`}>{entry.action}</span>
                    </td>
                    <td data-label={lang === 'bn' ? 'এন্টিটি' : 'Entity'}>
                      {entry.entity}
                      <div className="cpn-sub">{entry.entityId.slice(0, 8)}…</div>
                    </td>
                    <td data-label={lang === 'bn' ? 'বিস্তারিত' : 'Detail'}>
                      <details>
                        <summary className="cpn-sub">
                          {lang === 'bn' ? 'পরিবর্তন দেখুন' : 'View changes'}
                        </summary>
                        <pre className="audit-json">{JSON.stringify(entry.changes, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="prod-pager">
            <span>
              {lang === 'bn'
                ? `${total}টি · পৃষ্ঠা ${page}/${totalPages}`
                : `${total} total · page ${page} of ${totalPages}`}
            </span>
            <div>
              {page > 1 && (
                <Link className="btn ghost sm" href={hrefWith({ page: String(page - 1) })}>
                  {lang === 'bn' ? 'আগের' : 'Previous'}
                </Link>
              )}
              {page < totalPages && (
                <Link className="btn ghost sm" href={hrefWith({ page: String(page + 1) })}>
                  {lang === 'bn' ? 'পরের' : 'Next'}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
