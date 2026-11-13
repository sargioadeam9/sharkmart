'use client';

/**
 * Customers — the client island for `/admin/customers`.
 *
 * The list is read-only; the drawer is where the work happens: who they are, what
 * they have bought, and the staff notes. Notes are the reason this screen exists —
 * everything else is derivable from orders.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Trash2, X } from 'lucide-react';

import { formatMoneyAdmin } from '@/lib/format';
import {
  addCustomerNote,
  deleteCustomerNote,
  getCustomer,
  type CustomerListItem,
  type CustomerProfile,
  type CustomerSegment,
  type CustomerSort,
} from '@/lib/api/admin-customers';

type Lang = 'en' | 'bn';

function formatDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

const STATUS_TONE: Record<string, string> = {
  PENDING: 'warn',
  CONFIRMED: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'ok',
  CANCELLED: 'bad',
  RETURNED: 'warn',
};

// ─── Toolbar ────────────────────────────────────────────────────────────────

export function CustomersToolbar({
  lang,
  initialQuery,
  segment,
  sort,
}: {
  lang: Lang;
  initialQuery: string;
  segment: CustomerSegment;
  sort: CustomerSort;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function build(overrides: Record<string, string | undefined>): string {
    const next = new URLSearchParams();
    if (segment !== 'all') next.set('segment', segment);
    if (sort !== 'spend') next.set('sort', sort);
    const q = overrides.q ?? initialQuery;
    if (q) next.set('q', q);
    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'q') continue;
      if (value === undefined || value === '') next.delete(key);
      else next.set(key, value);
    }
    return `/admin/customers?${next.toString()}`;
  }

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => router.push(build({ q: value || undefined })), 350);
  }

  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);

  return (
    <div className="prod-toolbar ord-toolbar">
      <div className="prod-search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={lang === 'bn' ? 'নাম, ইমেইল বা ফোন' : 'Name, email or phone'}
          aria-label={lang === 'bn' ? 'ক্রেতা খুঁজুন' : 'Search customers'}
        />
      </div>

      <div className="prod-filters">
        <select
          value={sort}
          onChange={(event) => router.push(build({ sort: event.target.value }))}
          aria-label={lang === 'bn' ? 'সাজান' : 'Sort'}
        >
          <option value="spend">{lang === 'bn' ? 'বেশি খরচ আগে' : 'Highest spend'}</option>
          <option value="orders">{lang === 'bn' ? 'বেশি অর্ডার' : 'Most orders'}</option>
          <option value="recent">{lang === 'bn' ? 'সাম্প্রতিক অর্ডার' : 'Most recent order'}</option>
          <option value="joined">{lang === 'bn' ? 'নতুন যোগ' : 'Newest joined'}</option>
        </select>
      </div>
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

export function CustomersTable({
  lang,
  items,
  total,
  page,
  totalPages,
  prevHref,
  nextHref,
  queryString,
  openId,
}: {
  lang: Lang;
  items: CustomerListItem[];
  total: number;
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
  queryString: string;
  openId: string | null;
}) {
  const router = useRouter();

  function close(): void {
    const next = new URLSearchParams(queryString);
    next.delete('open');
    router.push(`/admin/customers?${next.toString()}`);
  }

  function open(id: string): void {
    const next = new URLSearchParams(queryString);
    next.set('open', id);
    router.push(`/admin/customers?${next.toString()}`);
  }

  return (
    <>
      <div className="card">
        <div className="table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">{lang === 'bn' ? 'ক্রেতা' : 'Customer'}</th>
                <th scope="col">{lang === 'bn' ? 'যোগাযোগ' : 'Contact'}</th>
                <th scope="col">{lang === 'bn' ? 'অর্ডার' : 'Orders'}</th>
                <th scope="col">{lang === 'bn' ? 'মোট খরচ' : 'Spend'}</th>
                <th scope="col">{lang === 'bn' ? 'শেষ অর্ডার' : 'Last order'}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td data-label={lang === 'bn' ? 'ক্রেতা' : 'Customer'}>
                    <b>{row.name}</b>
                    {!row.isActive && (
                      <div className="cpn-sub">{lang === 'bn' ? 'নিষ্ক্রিয়' : 'inactive'}</div>
                    )}
                  </td>
                  <td data-label={lang === 'bn' ? 'যোগাযোগ' : 'Contact'}>
                    {row.phone ?? '—'}
                    {row.email && <div className="cpn-sub">{row.email}</div>}
                  </td>
                  <td data-label={lang === 'bn' ? 'অর্ডার' : 'Orders'}>{row.orders}</td>
                  <td data-label={lang === 'bn' ? 'মোট খরচ' : 'Spend'}>
                    <b>{formatMoneyAdmin(row.spendPoisha)}</b>
                  </td>
                  <td data-label={lang === 'bn' ? 'শেষ অর্ডার' : 'Last order'}>
                    {row.lastOrderAt ? formatDate(row.lastOrderAt, lang) : '—'}
                  </td>
                  <td>
                    <button type="button" className="btn ghost sm" onClick={() => open(row.id)}>
                      {lang === 'bn' ? 'প্রোফাইল' : 'Open'}
                    </button>
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
            {prevHref ? (
              <a className="btn ghost sm" href={prevHref}>
                {lang === 'bn' ? 'আগের' : 'Previous'}
              </a>
            ) : null}
            {nextHref ? (
              <a className="btn ghost sm" href={nextHref}>
                {lang === 'bn' ? 'পরের' : 'Next'}
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {openId && <CustomerDrawer lang={lang} customerId={openId} onClose={close} />}
    </>
  );
}

// ─── Profile drawer ─────────────────────────────────────────────────────────

function CustomerDrawer({
  lang,
  customerId,
  onClose,
}: {
  lang: Lang;
  customerId: string;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCustomer(customerId)
      .then((data) => {
        if (!cancelled) setProfile(data);
      })
      .catch((caught: Error) => {
        if (!cancelled) setError(caught.message);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  async function reload(): Promise<void> {
    setProfile(await getCustomer(customerId));
  }

  async function save(): Promise<void> {
    if (note.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await addCustomerNote(customerId, note.trim());
      setNote('');
      await reload();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(noteId: string): Promise<void> {
    try {
      await deleteCustomerNote(customerId, noteId);
      await reload();
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <div className="overlay side open" onClick={onClose}>
      <div
        className="drawer cpn-drawer sup-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Customer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="drawer-head">
          <h2>{profile?.name ?? (lang === 'bn' ? 'ক্রেতা' : 'Customer')}</h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="drawer-body">
          {error && (
            <div className="ord-notice is-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {!profile ? (
            <p className="cpn-hint">{lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading…'}</p>
          ) : (
            <>
              <div className="exp-summary" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div className="exp-summary-item">
                  <span>{lang === 'bn' ? 'মোট খরচ' : 'Spend'}</span>
                  <b>{formatMoneyAdmin(profile.stats.spendPoisha)}</b>
                  <small>
                    {profile.stats.orders} {lang === 'bn' ? 'অর্ডার' : 'orders'}
                  </small>
                </div>
                <div className="exp-summary-item">
                  <span>{lang === 'bn' ? 'গড় অর্ডার' : 'Avg order'}</span>
                  <b>{formatMoneyAdmin(profile.stats.averageOrderPoisha)}</b>
                  <small>
                    {profile.stats.lastOrderAt
                      ? `${lang === 'bn' ? 'শেষ' : 'last'} ${formatDate(profile.stats.lastOrderAt, lang)}`
                      : lang === 'bn'
                        ? 'অর্ডার নেই'
                        : 'no orders'}
                  </small>
                </div>
                <div className="exp-summary-item">
                  <span>{lang === 'bn' ? 'উইশলিস্ট' : 'Wishlist'}</span>
                  <b>{profile.stats.wishlistCount}</b>
                  <small>
                    {profile.stats.reviewCount} {lang === 'bn' ? 'রিভিউ' : 'reviews'}
                  </small>
                </div>
              </div>

              <section className="sup-section">
                <h3>{lang === 'bn' ? 'যোগাযোগ' : 'Contact'}</h3>
                <ul className="sup-list">
                  <li>
                    <span>{lang === 'bn' ? 'ফোন' : 'Phone'}</span>
                    <b>{profile.phone ?? '—'}</b>
                  </li>
                  <li>
                    <span>{lang === 'bn' ? 'ইমেইল' : 'Email'}</span>
                    <b>{profile.email ?? '—'}</b>
                  </li>
                  <li>
                    <span>{lang === 'bn' ? 'যোগ দিয়েছেন' : 'Joined'}</span>
                    <b>{formatDate(profile.createdAt, lang)}</b>
                  </li>
                </ul>
              </section>

              <section className="sup-section">
                <h3>{lang === 'bn' ? 'স্টাফ নোট' : 'Staff notes'}</h3>

                <label className="field">
                  <span>{lang === 'bn' ? 'নতুন নোট' : 'New note'}</span>
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={
                      lang === 'bn' ? 'কী জানা দরকার' : 'What the next person should know'
                    }
                    maxLength={2000}
                  />
                </label>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => void save()}
                  disabled={busy || note.trim().length === 0}
                >
                  {lang === 'bn' ? 'নোট যোগ করুন' : 'Add note'}
                </button>

                {profile.notes.length === 0 ? (
                  <p className="cpn-hint">{lang === 'bn' ? 'কোনো নোট নেই।' : 'No notes yet.'}</p>
                ) : (
                  <ul className="sup-list">
                    {profile.notes.map((row) => (
                      <li key={row.id}>
                        <div>
                          <div>{row.body}</div>
                          <div className="cpn-sub">
                            {row.createdByName ?? '—'} · {formatDate(row.createdAt, lang)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => void remove(row.id)}
                          aria-label="Delete note"
                        >
                          <Trash2 size={13} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="sup-section">
                <h3>{lang === 'bn' ? 'সাম্প্রতিক অর্ডার' : 'Recent orders'}</h3>
                {profile.orders.length === 0 ? (
                  <p className="cpn-hint">{lang === 'bn' ? 'কোনো অর্ডার নেই।' : 'No orders.'}</p>
                ) : (
                  <ul className="sup-list">
                    {profile.orders.map((order) => (
                      <li key={order.id}>
                        <div>
                          <b>{order.orderNumber}</b>
                          <div className="cpn-sub">{formatDate(order.createdAt, lang)}</div>
                        </div>
                        <div className="sup-list-right">
                          <span className={`badge ${STATUS_TONE[order.status] ?? 'mute'}`}>
                            {order.status}
                          </span>
                          <b>{formatMoneyAdmin(order.totalAmountPoisha)}</b>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {profile.addresses.length > 0 && (
                <section className="sup-section">
                  <h3>{lang === 'bn' ? 'ঠিকানা' : 'Addresses'}</h3>
                  <ul className="sup-list">
                    {profile.addresses.map((address) => (
                      <li key={address.id}>
                        <div>
                          <b>{address.recipientName}</b>
                          <div className="cpn-sub">
                            {address.area}, {address.district} · {address.phone}
                          </div>
                        </div>
                        {address.isDefault && <span className="badge ok">default</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {profile.notifications.length > 0 && (
                <section className="sup-section">
                  <h3>{lang === 'bn' ? 'যোগাযোগের ইতিহাস' : 'Comms history'}</h3>
                  <ul className="sup-list">
                    {profile.notifications.map((row) => (
                      <li key={row.id}>
                        <div>
                          <b>{row.subject ?? row.type}</b>
                          <div className="cpn-sub">
                            {row.channel} · {formatDate(row.createdAt, lang)}
                          </div>
                        </div>
                        <span className={`badge ${row.status === 'SENT' ? 'ok' : 'warn'}`}>
                          {row.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
