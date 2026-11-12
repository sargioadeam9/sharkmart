'use client';

/**
 * The orders list's client island — toolbar, table, bulk bar, row drawer.
 *
 * ── Why this is one component and not five ─────────────────────────────────
 *
 * Bulk selection spans the toolbar (the count), the table (the checkboxes) and
 * the bulk bar (the actions). Splitting them would mean lifting the selection
 * into a parent anyway, plus three prop-drilling layers for a screen that is one
 * unit of work. One island, one state.
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 *
 * It does not filter, sort or paginate on the client. Every one of those is a URL
 * change, which re-renders the server component and re-queries the API. `total`
 * has to come from the server or the page count lies.
 *
 * It also does not decide which status transitions are legal. The drawer's
 * dropdown is populated from `allowedTransitions`, which the API sends from the
 * same table it enforces (`services/order-status.ts`). The API refuses an illegal
 * move regardless — the dropdown is UX, the check is the control.
 *
 * ── Class names ────────────────────────────────────────────────────────────
 *
 * Everything new is prefixed `ord-`. The products screen learned this the hard
 * way: `home.css` has unscoped `.card`, `.badge` and `.grid` rules, and the admin
 * stylesheet scopes under `.admin-root`, but a prefixed name is a second lock on
 * the same door.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, Download, Loader2, Search, X } from 'lucide-react';

/** Severity of the notice bar: success, partial, or nothing applied. */
type NoticeTone = 'ok' | 'warn' | 'error';

import { formatMoneyAdmin } from '@/lib/format';
import {
  bulkChangeOrderStatus,
  changeOrderStatus,
  getOrder,
  recordOrderPayment,
  setOrderCourier,
  setOrderNotes,
  type AdminOrderDetail,
  type AdminOrderListItem,
  type AdminOrderStatus,
} from '@/lib/api/admin-orders';

type Lang = 'en' | 'bn';

// ─── Status presentation ────────────────────────────────────────────────────

/**
 * Badge tone per status.
 *
 * Status is always badge + text label, never colour alone (the reference's rule
 * 6). The tone is the second channel, not the only one.
 */
const STATUS_TONE: Record<AdminOrderStatus, string> = {
  PENDING: 'warn',
  CONFIRMED: 'info',
  PROCESSING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'ok',
  CANCELLED: 'bad',
  RETURNED: 'warn',
  REFUND_PENDING: 'warn',
  REFUNDED: 'mute',
};

const STATUS_LABEL: Record<AdminOrderStatus, { en: string; bn: string }> = {
  PENDING: { en: 'Pending', bn: 'অপেক্ষমাণ' },
  CONFIRMED: { en: 'Confirmed', bn: 'নিশ্চিত' },
  PROCESSING: { en: 'Processing', bn: 'প্রক্রিয়াধীন' },
  SHIPPED: { en: 'Shipped', bn: 'পাঠানো হয়েছে' },
  DELIVERED: { en: 'Delivered', bn: 'পৌঁছে দেওয়া হয়েছে' },
  CANCELLED: { en: 'Cancelled', bn: 'বাতিল' },
  RETURNED: { en: 'Returned', bn: 'ফেরত' },
  REFUND_PENDING: { en: 'Refund pending', bn: 'রিফান্ড অপেক্ষমাণ' },
  REFUNDED: { en: 'Refunded', bn: 'রিফান্ড হয়েছে' },
};

const PAYMENT_TONE: Record<string, string> = {
  UNPAID: 'mute',
  PARTIALLY_PAID: 'warn',
  PAID: 'ok',
  REFUNDED: 'mute',
};

const PAYMENT_LABEL: Record<string, { en: string; bn: string }> = {
  UNPAID: { en: 'Unpaid', bn: 'অপরিশোধিত' },
  PARTIALLY_PAID: { en: 'Part paid', bn: 'আংশিক পরিশোধিত' },
  PAID: { en: 'Paid', bn: 'পরিশোধিত' },
  REFUNDED: { en: 'Refunded', bn: 'রিফান্ড' },
};

/** "12 Nov 2026" — the admin reads dates, not timestamps. */
function formatDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** "12 Nov 2026, 18:40" — the drawer's timeline needs the time. */
function formatDateTime(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: AdminOrderStatus, lang: Lang): string {
  return lang === 'bn' ? STATUS_LABEL[status].bn : STATUS_LABEL[status].en;
}

// ─── Toolbar ────────────────────────────────────────────────────────────────

interface ToolbarProps {
  lang: Lang;
  initialQuery: string;
  status: string;
  paymentStatus: string;
  customerType: string;
  from: string;
  to: string;
  sort: string;
}

/**
 * Search + filters. Every control writes to the URL, which is what makes the
 * server re-query.
 */
export function OrdersToolbar({
  lang,
  initialQuery,
  status,
  paymentStatus,
  customerType,
  from,
  to,
  sort,
}: ToolbarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Builds a URL from the current filters plus an override. */
  const navigate = useCallback(
    (overrides: Record<string, string | undefined>) => {
      const next = new URLSearchParams();
      if (overrides.q ?? initialQuery) next.set('q', overrides.q ?? initialQuery);
      if (status !== 'all') next.set('status', status);
      if (paymentStatus !== 'all') next.set('paymentStatus', paymentStatus);
      if (customerType !== 'all') next.set('customerType', customerType);
      if (from) next.set('from', from);
      if (to) next.set('to', to);
      if (sort !== 'newest') next.set('sort', sort);

      for (const [key, value] of Object.entries(overrides)) {
        if (key === 'q') continue;
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }

      // Any filter change resets to page 1: staying on page 4 of a 1-page result
      // is the classic empty-list bug.
      next.delete('page');

      router.push(`/admin/orders?${next.toString()}`);
    },
    [router, initialQuery, status, paymentStatus, customerType, from, to, sort],
  );

  /** Debounced search — typing does not fire a request per keystroke. */
  function onQueryChange(value: string) {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => navigate({ q: value || undefined }), 350);
  }

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  const hasFilters =
    initialQuery !== '' ||
    status !== 'all' ||
    paymentStatus !== 'all' ||
    customerType !== 'all' ||
    from !== '' ||
    to !== '';

  return (
    <div className="prod-toolbar ord-toolbar">
      <div className="prod-search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={
            lang === 'bn'
              ? 'অর্ডার নম্বর, নাম বা ফোন'
              : 'Order number, customer name or phone'
          }
          aria-label={lang === 'bn' ? 'অর্ডার খুঁজুন' : 'Search orders'}
        />
      </div>

      <div className="prod-filters">
        <select
          value={paymentStatus}
          onChange={(event) => navigate({ paymentStatus: event.target.value })}
          aria-label={lang === 'bn' ? 'পেমেন্ট অবস্থা' : 'Payment status'}
        >
          <option value="all">{lang === 'bn' ? 'সব পেমেন্ট' : 'All payments'}</option>
          <option value="UNPAID">{lang === 'bn' ? 'অপরিশোধিত' : 'Unpaid'}</option>
          <option value="PARTIALLY_PAID">{lang === 'bn' ? 'আংশিক' : 'Part paid'}</option>
          <option value="PAID">{lang === 'bn' ? 'পরিশোধিত' : 'Paid'}</option>
          <option value="REFUNDED">{lang === 'bn' ? 'রিফান্ড' : 'Refunded'}</option>
        </select>

        <select
          value={customerType}
          onChange={(event) => navigate({ customerType: event.target.value })}
          aria-label={lang === 'bn' ? 'ক্রেতার ধরন' : 'Customer type'}
        >
          <option value="all">{lang === 'bn' ? 'সব ক্রেতা' : 'All customers'}</option>
          <option value="registered">{lang === 'bn' ? 'নিবন্ধিত' : 'Registered'}</option>
          <option value="guest">{lang === 'bn' ? 'অতিথি' : 'Guest'}</option>
        </select>

        <select
          value={sort}
          onChange={(event) => navigate({ sort: event.target.value })}
          aria-label={lang === 'bn' ? 'সাজান' : 'Sort'}
        >
          <option value="newest">{lang === 'bn' ? 'নতুন আগে' : 'Newest first'}</option>
          <option value="oldest">{lang === 'bn' ? 'পুরোনো আগে' : 'Oldest first'}</option>
          <option value="total_desc">{lang === 'bn' ? 'বেশি টাকা আগে' : 'Highest total'}</option>
          <option value="total_asc">{lang === 'bn' ? 'কম টাকা আগে' : 'Lowest total'}</option>
        </select>

        {/* A native date input is the honest control here: the reference's
            Saturday-start calendar is a dashboard concern, and a date range
            filter needs two plain dates, not a picker widget. */}
        <input
          type="date"
          value={from}
          onChange={(event) => navigate({ from: event.target.value })}
          aria-label={lang === 'bn' ? 'শুরুর তারিখ' : 'From date'}
          className="ord-date"
        />
        <input
          type="date"
          value={to}
          onChange={(event) => navigate({ to: event.target.value })}
          aria-label={lang === 'bn' ? 'শেষ তারিখ' : 'To date'}
          className="ord-date"
        />

        {hasFilters && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => router.push('/admin/orders')}
          >
            <X size={14} aria-hidden />
            {lang === 'bn' ? 'মুছুন' : 'Clear'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Table ──────────────────────────────────────────────────────────────────

interface TableProps {
  lang: Lang;
  items: AdminOrderListItem[];
  total: number;
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
}

export function OrdersTable({ lang, items, total, page, totalPages, prevHref, nextHref }: TableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: NoticeTone } | null>(null);

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  }

  function toggleOne(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Exports the current page as CSV. Client-side: it is a view of what is shown. */
  function exportCsv() {
    const header = [
      'Order',
      'Date',
      'Customer',
      'Phone',
      'District',
      'Items',
      'Status',
      'Payment',
      'Total (BDT)',
    ];
    const rows = items.map((item) => [
      item.orderNumber,
      new Date(item.createdAt).toISOString().slice(0, 10),
      item.customerName,
      item.customerPhone,
      item.district,
      String(item.itemCount),
      item.status,
      item.paymentStatus,
      (item.totalAmountPoisha / 100).toFixed(2),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `orders-page-${page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {notice && (
        <div
          className={`ord-notice${notice.tone === 'ok' ? '' : notice.tone === 'warn' ? ' is-warn' : ' is-error'}`}
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          {notice.tone === 'ok' ? <Check size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />}
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      <div className="card prod-table-card">
        <div className="prod-table-head">
          <span className="prod-count">
            {lang === 'bn' ? `${total}টি অর্ডার` : `${total} order${total === 1 ? '' : 's'}`}
          </span>
          <button type="button" className="btn ghost sm" onClick={exportCsv}>
            <Download size={14} aria-hidden />
            {lang === 'bn' ? 'রপ্তানি' : 'Export'}
          </button>
        </div>

        <div className="table-wrap">
          <table className="prod-table ord-table">
            <thead>
              <tr>
                <th className="ord-col-check">
                  <label className="prod-check">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={lang === 'bn' ? 'সব নির্বাচন' : 'Select all on this page'}
                    />
                  </label>
                </th>
                <th>{lang === 'bn' ? 'অর্ডার' : 'Order'}</th>
                <th>{lang === 'bn' ? 'ক্রেতা' : 'Customer'}</th>
                <th className="ord-col-district">{lang === 'bn' ? 'জেলা' : 'District'}</th>
                <th className="ord-col-items">{lang === 'bn' ? 'আইটেম' : 'Items'}</th>
                <th>{lang === 'bn' ? 'অবস্থা' : 'Status'}</th>
                <th>{lang === 'bn' ? 'পেমেন্ট' : 'Payment'}</th>
                <th className="num">{lang === 'bn' ? 'মোট' : 'Total'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={selected.has(item.id) ? 'prod-row-selected' : undefined}
                  onClick={() => setOpenId(item.id)}
                >
                  <td data-label="" onClick={(event) => event.stopPropagation()}>
                    <label className="prod-check">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                        aria-label={`Select order ${item.orderNumber}`}
                      />
                    </label>
                  </td>
                  <td data-label={lang === 'bn' ? 'অর্ডার' : 'Order'}>
                    <b className="ord-number">{item.orderNumber}</b>
                    <small className="ord-date-cell">{formatDate(item.createdAt, lang)}</small>
                  </td>
                  <td data-label={lang === 'bn' ? 'ক্রেতা' : 'Customer'}>
                    <div className="who">
                      {item.customerName}
                      <small>{item.customerPhone}</small>
                    </div>
                  </td>
                  <td data-label={lang === 'bn' ? 'জেলা' : 'District'} className="ord-col-district">
                    {item.district}
                  </td>
                  <td data-label={lang === 'bn' ? 'আইটেম' : 'Items'} className="ord-col-items">
                    {item.itemCount}
                  </td>
                  <td data-label={lang === 'bn' ? 'অবস্থা' : 'Status'}>
                    <span className={`badge ${STATUS_TONE[item.status]}`}>
                      {statusLabel(item.status, lang)}
                    </span>
                  </td>
                  <td data-label={lang === 'bn' ? 'পেমেন্ট' : 'Payment'}>
                    <span className={`badge ${PAYMENT_TONE[item.paymentStatus] ?? 'mute'}`}>
                      {lang === 'bn'
                        ? PAYMENT_LABEL[item.paymentStatus]?.bn
                        : PAYMENT_LABEL[item.paymentStatus]?.en}
                    </span>
                  </td>
                  <td data-label={lang === 'bn' ? 'মোট' : 'Total'} className="num">
                    <b>{formatMoneyAdmin(item.totalAmountPoisha)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prod-pager">
          <span className="prod-page-label">
            {lang === 'bn'
              ? `পৃষ্ঠা ${page} / ${totalPages}`
              : `Page ${page} of ${totalPages}`}
          </span>
          <div>
            {prevHref ? (
              <Link href={prevHref} className="btn ghost sm">
                {lang === 'bn' ? 'আগের' : 'Previous'}
              </Link>
            ) : (
              <button type="button" className="btn ghost sm" disabled>
                {lang === 'bn' ? 'আগের' : 'Previous'}
              </button>
            )}
            {nextHref ? (
              <Link href={nextHref} className="btn ghost sm">
                {lang === 'bn' ? 'পরের' : 'Next'}
              </Link>
            ) : (
              <button type="button" className="btn ghost sm" disabled>
                {lang === 'bn' ? 'পরের' : 'Next'}
              </button>
            )}
          </div>
        </div>
      </div>

      {selected.size > 0 && (
        <BulkBar
          lang={lang}
          ids={[...selected]}
          onDone={(message, tone) => {
            setSelected(new Set());
            setNotice({ text: message, tone });
          }}
        />
      )}

      {openId && (
        <OrderDrawer
          lang={lang}
          orderId={openId}
          onClose={() => setOpenId(null)}
          onChanged={(message, tone) => setNotice({ text: message, tone })}
        />
      )}
    </>
  );
}

// ─── Bulk bar ───────────────────────────────────────────────────────────────

interface BulkBarProps {
  lang: Lang;
  ids: string[];
  onDone: (message: string, tone: NoticeTone) => void;
}

/**
 * The sticky bulk bar.
 *
 * A bulk status change needs a note, because every transition does. The bar asks
 * for one inline rather than opening a modal: it is one field and one confirm,
 * and a modal for that is a step too many when an operator is clearing a queue.
 */
function BulkBar({ lang, ids, onDone }: BulkBarProps) {
  const router = useRouter();
  const [status, setStatus] = useState<AdminOrderStatus>('CONFIRMED');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (note.trim().length === 0) {
      setError(lang === 'bn' ? 'একটি নোট লিখুন।' : 'A note is required.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await bulkChangeOrderStatus(ids, status, note.trim());
      const skipped = result.skipped.length;
      const updated = result.updated.length;

      /**
       * Tone follows the outcome, not the fact that the request succeeded.
       * "0 updated, 1 skipped" is a refusal dressed as a success — painting it
       * green is how an operator learns to stop reading the banner.
       */
      const tone: 'ok' | 'warn' | 'error' = skipped === 0 ? 'ok' : updated === 0 ? 'error' : 'warn';

      onDone(
        skipped === 0
          ? lang === 'bn'
            ? `${updated}টি অর্ডার হালনাগাদ হয়েছে।`
            : `${updated} order${updated === 1 ? '' : 's'} updated.`
          : lang === 'bn'
            ? `${updated}টি হালনাগাদ, ${skipped}টি বাদ (অবৈধ পরিবর্তন)।`
            : `${updated} updated, ${skipped} skipped (illegal transition).`,
        tone,
      );

      // The rows behind the bar are server-rendered; re-run them so the status
      // badges match what was just applied.
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Bulk update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="prod-bulk ord-bulk" role="region" aria-label={lang === 'bn' ? 'বাল্ক অ্যাকশন' : 'Bulk actions'}>
      <span className="prod-count">
        {lang === 'bn' ? `${ids.length}টি নির্বাচিত` : `${ids.length} selected`}
      </span>

      <select
        value={status}
        onChange={(event) => setStatus(event.target.value as AdminOrderStatus)}
        aria-label={lang === 'bn' ? 'নতুন অবস্থা' : 'New status'}
      >
        <option value="CONFIRMED">{lang === 'bn' ? 'নিশ্চিত' : 'Confirmed'}</option>
        <option value="PROCESSING">{lang === 'bn' ? 'প্রক্রিয়াধীন' : 'Processing'}</option>
        <option value="SHIPPED">{lang === 'bn' ? 'পাঠানো হয়েছে' : 'Shipped'}</option>
        <option value="DELIVERED">{lang === 'bn' ? 'পৌঁছে দেওয়া হয়েছে' : 'Delivered'}</option>
        <option value="CANCELLED">{lang === 'bn' ? 'বাতিল' : 'Cancelled'}</option>
      </select>

      <input
        type="text"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={lang === 'bn' ? 'কারণ / নোট (আবশ্যক)' : 'Reason / note (required)'}
        aria-label={lang === 'bn' ? 'নোট' : 'Note'}
        className="ord-bulk-note"
      />

      <div className="prod-bulk-actions">
        <button type="button" className="btn sm" onClick={apply} disabled={busy}>
          {busy ? <Loader2 size={14} className="ord-spin" aria-hidden /> : <Check size={14} aria-hidden />}
          {lang === 'bn' ? 'প্রয়োগ' : 'Apply'}
        </button>
      </div>

      {error && <span className="ord-bulk-error">{error}</span>}
    </div>
  );
}

// ─── Drawer ─────────────────────────────────────────────────────────────────

interface DrawerProps {
  lang: Lang;
  orderId: string;
  onClose: () => void;
  onChanged: (message: string, tone: NoticeTone) => void;
}

/**
 * The order drawer — detail, timeline, status flow, payment, courier, notes.
 *
 * It fetches its own detail on open rather than receiving it from the list,
 * because the list row is deliberately small (no items, no history). That is one
 * request per drawer open, which is the right trade: the list stays fast and the
 * drawer is always fresh.
 */
function OrderDrawer({ lang, orderId, onClose, onChanged }: DrawerProps) {
  const router = useRouter();
  const [order, setOrder] = useState<AdminOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [nextStatus, setNextStatus] = useState<AdminOrderStatus | ''>('');
  const [statusNote, setStatusNote] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payTxn, setPayTxn] = useState('');
  const [courierName, setCourierName] = useState('');
  const [consignmentId, setConsignmentId] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [notes, setNotes] = useState('');

  /**
   * Fetches the drawer's detail on open.
   *
   * The state writes happen after an `await`, never synchronously in the effect
   * body — a sync `setState` there triggers a cascading render, and the `cancelled`
   * flag means a drawer closed mid-flight cannot write to an unmounted component.
   * `loading` starts true, so there is nothing to set before the fetch.
   */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const detail = await getOrder(orderId);
        if (cancelled) return;
        setOrder(detail);
        setNotes(detail.notes ?? '');
        setCourierName(detail.courierName ?? '');
        setConsignmentId(detail.consignmentId ?? '');
        setTrackingUrl(detail.trackingUrl ?? '');
        setNextStatus(detail.allowedTransitions[0] ?? '');
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Could not load the order.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  /** Escape closes the drawer, matching the shell's popover behaviour. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function run(action: () => Promise<AdminOrderDetail>, message: string) {
    setBusy(true);
    setError(null);
    try {
      const updated = await action();
      setOrder(updated);
      setNextStatus(updated.allowedTransitions[0] ?? '');
      setStatusNote('');
      onChanged(message, 'ok');
      /**
       * Re-render the server component behind the drawer.
       *
       * Without this the row keeps showing the status it had when the page was
       * rendered — the drawer would say Confirmed while the list behind it still
       * said Pending, which is the kind of contradiction that makes an operator
       * distrust the whole screen. `refresh()` re-runs the server component and
       * re-queries the list; the drawer keeps its own fetched detail.
       */
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  const t = useMemo(
    () => ({
      close: lang === 'bn' ? 'বন্ধ' : 'Close',
      items: lang === 'bn' ? 'আইটেম' : 'Items',
      timeline: lang === 'bn' ? 'সময়রেখা' : 'Timeline',
      address: lang === 'bn' ? 'ডেলিভারি ঠিকানা' : 'Delivery address',
      payment: lang === 'bn' ? 'পেমেন্ট' : 'Payment',
      courier: lang === 'bn' ? 'কুরিয়ার' : 'Courier',
      notes: lang === 'bn' ? 'অভ্যন্তরীণ নোট' : 'Internal note',
      statusFlow: lang === 'bn' ? 'অবস্থা পরিবর্তন' : 'Change status',
      save: lang === 'bn' ? 'সংরক্ষণ' : 'Save',
    }),
    [lang],
  );

  return (
    <div className="overlay open" role="dialog" aria-modal="true" aria-label={order?.orderNumber ?? 'Order'}>
      <div className="modal drawer prod-drawer ord-drawer">
        <div className="m-head">
          <div>
            <h2>{order?.orderNumber ?? (loading ? '…' : 'Order')}</h2>
            {order && (
              <small>
                {formatDateTime(order.createdAt, lang)} · {order.paymentMethod}
              </small>
            )}
          </div>
          <button type="button" className="x" onClick={onClose} aria-label={t.close}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="m-body">
          {loading && (
            <p>
              <Loader2 size={16} className="ord-spin" aria-hidden />{' '}
              {lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading…'}
            </p>
          )}

          {error && <p style={{ color: 'var(--bad)' }}>{error}</p>}

          {order && (
            <>
              <div className="prod-drawer-badges">
                <span className={`badge ${STATUS_TONE[order.status]}`}>
                  {statusLabel(order.status, lang)}
                </span>
                <span className={`badge ${PAYMENT_TONE[order.paymentStatus] ?? 'mute'}`}>
                  {lang === 'bn'
                    ? PAYMENT_LABEL[order.paymentStatus]?.bn
                    : PAYMENT_LABEL[order.paymentStatus]?.en}
                </span>
                {order.isGuest && (
                  <span className="badge mute">{lang === 'bn' ? 'অতিথি' : 'Guest'}</span>
                )}
              </div>

              <div className="info-grid">
                <div>
                  <small>{lang === 'bn' ? 'ক্রেতা' : 'Customer'}</small>
                  {order.customerName}
                </div>
                <div>
                  <small>{lang === 'bn' ? 'ফোন' : 'Phone'}</small>
                  {order.customerPhone}
                </div>
                <div>
                  <small>{lang === 'bn' ? 'মোট' : 'Total'}</small>
                  <b>{formatMoneyAdmin(order.totalAmountPoisha)}</b>
                </div>
                <div>
                  <small>{lang === 'bn' ? 'পরিশোধিত' : 'Paid'}</small>
                  {formatMoneyAdmin(order.paidAmountPoisha)}
                </div>
              </div>

              {/* ── Items ─────────────────────────────────────────────── */}
              <h3 className="ord-section-title">{t.items}</h3>
              <ul className="ord-items">
                {order.items.map((item) => (
                  <li key={item.id} className="ord-item">
                    <span className="ord-item-thumb">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- remote, arbitrary host
                        <img src={item.imageUrl} alt="" width={40} height={40} />
                      ) : (
                        <span aria-hidden>—</span>
                      )}
                    </span>
                    <span className="ord-item-name">
                      <b>{lang === 'bn' ? item.nameBn : item.nameEn}</b>
                      <small>
                        {item.sku} · ×{item.quantity}
                      </small>
                    </span>
                    <span className="num">{formatMoneyAdmin(item.lineTotalPoisha)}</span>
                  </li>
                ))}
              </ul>

              <div className="ord-totals">
                <div>
                  <span>{lang === 'bn' ? 'সাবটোটাল' : 'Subtotal'}</span>
                  <span>{formatMoneyAdmin(order.subtotalPoisha)}</span>
                </div>
                {order.discountAmountPoisha > 0 && (
                  <div>
                    <span>
                      {lang === 'bn' ? 'ছাড়' : 'Discount'}
                      {order.couponCode ? ` (${order.couponCode})` : ''}
                    </span>
                    <span>−{formatMoneyAdmin(order.discountAmountPoisha)}</span>
                  </div>
                )}
                <div>
                  <span>{lang === 'bn' ? 'ডেলিভারি' : 'Delivery'}</span>
                  <span>{formatMoneyAdmin(order.deliveryChargePoisha)}</span>
                </div>
                <div className="ord-grand">
                  <span>{lang === 'bn' ? 'সর্বমোট' : 'Total'}</span>
                  <span>{formatMoneyAdmin(order.totalAmountPoisha)}</span>
                </div>
              </div>

              {/* ── Address ───────────────────────────────────────────── */}
              {order.shippingAddress && (
                <>
                  <h3 className="ord-section-title">{t.address}</h3>
                  <p className="ord-address">
                    <b>{order.shippingAddress.recipientName}</b>
                    <br />
                    {order.shippingAddress.address}
                    <br />
                    {order.shippingAddress.area}, {order.shippingAddress.district},{' '}
                    {order.shippingAddress.division}
                    {order.shippingAddress.postalCode ? ` ${order.shippingAddress.postalCode}` : ''}
                    <br />
                    {order.shippingAddress.phone}
                  </p>
                </>
              )}

              {/* ── Status flow ───────────────────────────────────────── */}
              <h3 className="ord-section-title">{t.statusFlow}</h3>
              {order.allowedTransitions.length === 0 ? (
                <p className="editor-hint">
                  {lang === 'bn'
                    ? 'এই অর্ডার আর পরিবর্তন করা যাবে না।'
                    : 'This order is in a terminal state and cannot move further.'}
                </p>
              ) : (
                <div className="ord-flow">
                  <select
                    value={nextStatus}
                    onChange={(event) => setNextStatus(event.target.value as AdminOrderStatus)}
                    aria-label={lang === 'bn' ? 'নতুন অবস্থা' : 'New status'}
                  >
                    {order.allowedTransitions.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status, lang)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={statusNote}
                    onChange={(event) => setStatusNote(event.target.value)}
                    placeholder={lang === 'bn' ? 'নোট (আবশ্যক)' : 'Note (required)'}
                    aria-label={lang === 'bn' ? 'নোট' : 'Note'}
                  />
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy || !nextStatus || statusNote.trim().length === 0}
                    onClick={() =>
                      run(
                        () => changeOrderStatus(order.id, nextStatus as AdminOrderStatus, statusNote.trim()),
                        lang === 'bn' ? 'অবস্থা হালনাগাদ হয়েছে।' : 'Status updated.',
                      )
                    }
                  >
                    {busy ? <Loader2 size={14} className="ord-spin" aria-hidden /> : null}
                    {t.save}
                  </button>
                </div>
              )}

              {/* ── Payment ───────────────────────────────────────────── */}
              <h3 className="ord-section-title">{t.payment}</h3>
              <div className="ord-flow">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={payAmount}
                  onChange={(event) => setPayAmount(event.target.value)}
                  placeholder={lang === 'bn' ? 'টাকা' : 'Amount (৳)'}
                  aria-label={lang === 'bn' ? 'পরিমাণ' : 'Amount'}
                />
                <input
                  type="text"
                  value={payTxn}
                  onChange={(event) => setPayTxn(event.target.value)}
                  placeholder={lang === 'bn' ? 'ট্রানজেকশন আইডি' : 'Transaction id'}
                  aria-label={lang === 'bn' ? 'ট্রানজেকশন আইডি' : 'Transaction id'}
                />
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || !payAmount || Number(payAmount) <= 0}
                  onClick={() =>
                    run(
                      () =>
                        recordOrderPayment(order.id, {
                          // The input is taka; the API takes poisha. Rounding here
                          // is exact because the field is an integer taka input.
                          amountPoisha: Math.round(Number(payAmount) * 100),
                          ...(payTxn.trim() ? { txnId: payTxn.trim() } : {}),
                        }),
                      lang === 'bn' ? 'পেমেন্ট রেকর্ড হয়েছে।' : 'Payment recorded.',
                    )
                  }
                >
                  {lang === 'bn' ? 'রেকর্ড' : 'Record'}
                </button>
              </div>
              {order.paymentTxnId && (
                <p className="editor-hint">
                  {lang === 'bn' ? 'সর্বশেষ লেনদেন' : 'Last transaction'}: {order.paymentTxnId}
                </p>
              )}

              {/* ── Courier ───────────────────────────────────────────── */}
              <h3 className="ord-section-title">{t.courier}</h3>
              <div className="ord-flow">
                <input
                  type="text"
                  value={courierName}
                  onChange={(event) => setCourierName(event.target.value)}
                  placeholder={lang === 'bn' ? 'কুরিয়ার' : 'Courier'}
                  aria-label={lang === 'bn' ? 'কুরিয়ার' : 'Courier'}
                />
                <input
                  type="text"
                  value={consignmentId}
                  onChange={(event) => setConsignmentId(event.target.value)}
                  placeholder={lang === 'bn' ? 'কনসাইনমেন্ট আইডি' : 'Consignment id'}
                  aria-label={lang === 'bn' ? 'কনসাইনমেন্ট আইডি' : 'Consignment id'}
                />
                <button
                  type="button"
                  className="btn ghost sm"
                  disabled={busy || !courierName.trim() || !consignmentId.trim()}
                  onClick={() =>
                    run(
                      () =>
                        setOrderCourier(order.id, {
                          courierName: courierName.trim(),
                          consignmentId: consignmentId.trim(),
                          ...(trackingUrl.trim() ? { trackingUrl: trackingUrl.trim() } : {}),
                        }),
                      lang === 'bn' ? 'কুরিয়ার সংরক্ষিত হয়েছে।' : 'Courier saved.',
                    )
                  }
                >
                  {t.save}
                </button>
              </div>
              <input
                type="url"
                value={trackingUrl}
                onChange={(event) => setTrackingUrl(event.target.value)}
                placeholder={lang === 'bn' ? 'ট্র্যাকিং লিংক' : 'Tracking URL'}
                aria-label={lang === 'bn' ? 'ট্র্যাকিং লিংক' : 'Tracking URL'}
                className="ord-full-input"
              />
              {order.trackingUrl && (
                <p className="editor-hint">
                  <a href={order.trackingUrl} target="_blank" rel="noreferrer noopener" className="link">
                    {lang === 'bn' ? 'ট্র্যাকিং খুলুন' : 'Open tracking'}
                  </a>
                </p>
              )}

              {/* ── Notes ─────────────────────────────────────────────── */}
              <h3 className="ord-section-title">{t.notes}</h3>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder={
                  lang === 'bn' ? 'শুধু কর্মীরা দেখতে পাবেন' : 'Only staff can see this'
                }
                aria-label={t.notes}
                className="ord-full-input"
              />
              <button
                type="button"
                className="btn ghost sm"
                disabled={busy}
                onClick={() =>
                  run(
                    () => setOrderNotes(order.id, notes.trim() === '' ? null : notes.trim()),
                    lang === 'bn' ? 'নোট সংরক্ষিত হয়েছে।' : 'Note saved.',
                  )
                }
              >
                {t.save}
              </button>

              {/* ── Timeline ──────────────────────────────────────────── */}
              <h3 className="ord-section-title">{t.timeline}</h3>
              <ol className="ord-timeline">
                {order.statusHistory.map((entry) => (
                  <li key={entry.id}>
                    <span className={`badge ${STATUS_TONE[entry.status]}`}>
                      {statusLabel(entry.status, lang)}
                    </span>
                    <small>{formatDateTime(entry.createdAt, lang)}</small>
                    {entry.note && <p>{entry.note}</p>}
                    {entry.changedByName && (
                      <small className="ord-actor">{entry.changedByName}</small>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
