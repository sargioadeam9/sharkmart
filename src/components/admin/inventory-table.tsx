'use client';

/**
 * The inventory screen's client island — toolbar, table, adjust drawer,
 * movement log.
 *
 * ── What it does NOT do ────────────────────────────────────────────────────
 *
 * It does not derive a stock number. `stockOfRecord`, `stockStatus` and every
 * KPI arrive from the server, because the rule that decides them spans two
 * tables (`ProductVariant` vs `WarehouseStock`) and a second copy in the browser
 * would drift from the one checkout uses. Same reasoning as the products screen.
 *
 * It does not filter, sort or paginate on the client. Every one of those is a
 * URL change, so `total` is honest and a filtered list survives a refresh.
 *
 * ── Class names ────────────────────────────────────────────────────────────
 *
 * Everything new is prefixed `inv-`. The storefront's home.css has unscoped
 * `.card`, `.badge` and `.grid` rules and Pass A lost time to exactly that
 * collision (AGENTS.md landmine 17). The admin stylesheet scopes under
 * `.admin-root`; the prefix is a second lock on the same door.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowDown, ArrowUp, History, Search, X } from 'lucide-react';

import {
  adjustStock,
  getInventoryDetail,
  type InventoryDetail,
  type InventoryListItem,
  type InventorySort,
  type InventoryStockFilter,
  type MovementRow,
} from '@/lib/api/admin-inventory';
import { AdminApiError } from '@/lib/api/admin-client';

type Lang = 'en' | 'bn';

const STATUS_TONE: Record<string, string> = {
  in_stock: 'ok',
  low_stock: 'warn',
  out_of_stock: 'bad',
};

const STATUS_LABEL: Record<string, { en: string; bn: string }> = {
  in_stock: { en: 'In stock', bn: 'স্টকে আছে' },
  low_stock: { en: 'Low stock', bn: 'কম স্টক' },
  out_of_stock: { en: 'Out of stock', bn: 'স্টক নেই' },
};

const MOVEMENT_LABEL: Record<string, { en: string; bn: string }> = {
  IN: { en: 'In', bn: 'প্রবেশ' },
  OUT: { en: 'Out', bn: 'বাহির' },
  ADJUSTMENT: { en: 'Adjustment', bn: 'সমন্বয়' },
  TRANSFER: { en: 'Transfer', bn: 'স্থানান্তর' },
  RETURN: { en: 'Return', bn: 'ফেরত' },
};

/** The API's own 5-character floor, so the form refuses before the round trip. */
const MIN_REASON = 5;

function statusLabel(status: string, lang: Lang): string {
  return STATUS_LABEL[status]?.[lang] ?? status;
}

function movementLabel(type: string, lang: Lang): string {
  return MOVEMENT_LABEL[type]?.[lang] ?? type;
}

/** Admin surface uses lakh grouping (AGENTS.md §3). */
function num(value: number, lang: Lang): string {
  return value.toLocaleString(lang === 'bn' ? 'bn-BD' : 'en-IN');
}

function when(iso: string, lang: Lang): string {
  const date = new Date(iso);
  return date.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Toolbar ───────────────────────────────────────────────────────────────

interface ToolbarProps {
  lang: Lang;
  initialQuery: string;
  stock: InventoryStockFilter;
  sort: InventorySort;
  view: 'stock' | 'movements';
}

export function InventoryToolbar({ lang, initialQuery, stock, sort, view }: ToolbarProps) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const navigate = useCallback(
    (overrides: Record<string, string | undefined>) => {
      const next = new URLSearchParams();
      const q = overrides.q ?? initialQuery;
      if (q) next.set('q', q);
      if (stock !== 'all') next.set('stock', stock);
      if (sort !== 'name_asc') next.set('sort', sort);
      if (view !== 'stock') next.set('view', view);

      for (const [key, value] of Object.entries(overrides)) {
        if (key === 'q') continue;
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }

      // Any filter change resets to page 1: page 4 of a 1-page result is the
      // classic empty-list bug.
      next.delete('page');

      router.push(`/admin/inventory?${next.toString()}`);
    },
    [router, initialQuery, stock, sort, view],
  );

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

  return (
    <div className="card inv-toolbar">
      <label className="inv-search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={lang === 'bn' ? 'নাম বা SKU দিয়ে খুঁজুন' : 'Search by name or SKU'}
          aria-label={lang === 'bn' ? 'পণ্য খুঁজুন' : 'Search products'}
        />
        {query && (
          <button
            type="button"
            className="inv-clear"
            onClick={() => {
              setQuery('');
              navigate({ q: undefined });
            }}
            aria-label={lang === 'bn' ? 'খোঁজা মুছুন' : 'Clear search'}
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </label>

      <div className="inv-filters">
        <label className="inv-field-inline">
          <span>{lang === 'bn' ? 'স্টক' : 'Stock'}</span>
          <select
            value={stock}
            onChange={(event) => navigate({ stock: event.target.value })}
            aria-label={lang === 'bn' ? 'স্টক অবস্থা' : 'Stock status'}
          >
            <option value="all">{lang === 'bn' ? 'সব' : 'All'}</option>
            <option value="in">{lang === 'bn' ? 'স্টকে আছে' : 'In stock'}</option>
            <option value="low">{lang === 'bn' ? 'কম স্টক' : 'Low stock'}</option>
            <option value="out">{lang === 'bn' ? 'স্টক নেই' : 'Out of stock'}</option>
          </select>
        </label>

        <label className="inv-field-inline">
          <span>{lang === 'bn' ? 'সাজান' : 'Sort'}</span>
          <select
            value={sort}
            onChange={(event) => navigate({ sort: event.target.value })}
            aria-label={lang === 'bn' ? 'সাজানোর নিয়ম' : 'Sort order'}
          >
            <option value="name_asc">{lang === 'bn' ? 'নাম (ক → হ)' : 'Name A–Z'}</option>
            <option value="name_desc">{lang === 'bn' ? 'নাম (হ → ক)' : 'Name Z–A'}</option>
            <option value="stock_asc">{lang === 'bn' ? 'স্টক (কম → বেশি)' : 'Stock low → high'}</option>
            <option value="stock_desc">{lang === 'bn' ? 'স্টক (বেশি → কম)' : 'Stock high → low'}</option>
            <option value="updated">{lang === 'bn' ? 'সর্বশেষ' : 'Recently updated'}</option>
          </select>
        </label>
      </div>
    </div>
  );
}

// ─── Table ─────────────────────────────────────────────────────────────────

interface TableProps {
  lang: Lang;
  items: InventoryListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
  canWrite: boolean;
}

export function InventoryTable({
  lang,
  items,
  total,
  page,
  limit,
  totalPages,
  prevHref,
  nextHref,
  canWrite,
}: TableProps) {
  const router = useRouter();
  const [drawerFor, setDrawerFor] = useState<InventoryListItem | null>(null);

  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <>
      <div className="card inv-table-card">
        <div className="inv-table-head">
          <span className="inv-count">
            {lang === 'bn' ? `${first}–${last} / ${num(total, lang)}` : `${first}–${last} of ${num(total, lang)}`}
          </span>
        </div>

        <div className="table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th className="inv-col-name">{lang === 'bn' ? 'পণ্য' : 'Product'}</th>
                <th className="inv-col-sku">SKU</th>
                <th className="inv-col-cat">{lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}</th>
                <th className="num">{lang === 'bn' ? 'গুদাম' : 'Warehouse'}</th>
                <th className="num">{lang === 'bn' ? 'ভ্যারিয়েন্ট' : 'Variant'}</th>
                <th className="num">{lang === 'bn' ? 'প্রকৃত স্টক' : 'Stock of record'}</th>
                <th>{lang === 'bn' ? 'অবস্থা' : 'Status'}</th>
                <th>{lang === 'bn' ? 'হালনাগাদ' : 'Updated'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.productId}
                  onClick={() => setDrawerFor(item)}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setDrawerFor(item);
                    }
                  }}
                  aria-label={
                    lang === 'bn'
                      ? `${item.nameBn} — স্টক সমন্বয় করুন`
                      : `${item.nameEn} — adjust stock`
                  }
                >
                  <td data-label={lang === 'bn' ? 'পণ্য' : 'Product'}>
                    <div className="inv-cell">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="inv-thumb" src={item.imageUrl} alt="" loading="lazy" />
                      ) : (
                        <span className="inv-thumb inv-thumb-empty" aria-hidden />
                      )}
                      <span className="inv-names">
                        <b>{lang === 'bn' ? item.nameBn : item.nameEn}</b>
                        <small>{lang === 'bn' ? item.nameEn : item.nameBn}</small>
                      </span>
                    </div>
                  </td>
                  <td data-label="SKU">
                    <span className="inv-sku">{item.sku}</span>
                  </td>
                  <td className="inv-col-cat" data-label={lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}>
                    {lang === 'bn' ? item.categoryNameBn : item.categoryNameEn}
                  </td>
                  <td className="num" data-label={lang === 'bn' ? 'গুদাম' : 'Warehouse'}>
                    {num(item.warehouseQty, lang)}
                  </td>
                  <td className="num" data-label={lang === 'bn' ? 'ভ্যারিয়েন্ট' : 'Variant'}>
                    {num(item.variantStock, lang)}
                  </td>
                  <td className="num inv-record" data-label={lang === 'bn' ? 'প্রকৃত স্টক' : 'Stock of record'}>
                    {num(item.stockOfRecord, lang)}
                  </td>
                  <td data-label={lang === 'bn' ? 'অবস্থা' : 'Status'}>
                    <span className={`badge ${STATUS_TONE[item.stockStatus] ?? 'mute'}`}>
                      {statusLabel(item.stockStatus, lang)}
                    </span>
                  </td>
                  <td data-label={lang === 'bn' ? 'হালনাগাদ' : 'Updated'}>
                    <span className="inv-date">{when(item.updatedAt, lang)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="inv-pager">
            {prevHref ? (
              <a className="btn ghost sm" href={prevHref}>
                {lang === 'bn' ? 'পূর্ববর্তী' : 'Previous'}
              </a>
            ) : (
              <span className="btn ghost sm" aria-disabled="true">
                {lang === 'bn' ? 'পূর্ববর্তী' : 'Previous'}
              </span>
            )}
            <span className="inv-page-of">
              {lang === 'bn' ? `${page} / ${totalPages}` : `Page ${page} of ${totalPages}`}
            </span>
            {nextHref ? (
              <a className="btn ghost sm" href={nextHref}>
                {lang === 'bn' ? 'পরবর্তী' : 'Next'}
              </a>
            ) : (
              <span className="btn ghost sm" aria-disabled="true">
                {lang === 'bn' ? 'পরবর্তী' : 'Next'}
              </span>
            )}
          </div>
        )}
      </div>

      {drawerFor && (
        <AdjustDrawer
          lang={lang}
          item={drawerFor}
          canWrite={canWrite}
          onClose={() => setDrawerFor(null)}
          onSaved={() => {
            setDrawerFor(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// ─── Adjust drawer ─────────────────────────────────────────────────────────

interface DrawerProps {
  lang: Lang;
  item: InventoryListItem;
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function AdjustDrawer({ lang, item, canWrite, onClose, onSaved }: DrawerProps) {
  const [detail, setDetail] = useState<InventoryDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'delta' | 'set'>('delta');
  const [amount, setAmount] = useState('1');
  const [reason, setReason] = useState('');
  const [variantId, setVariantId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInventoryDetail(item.productId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        // A product with variants must name the variant — the API refuses
        // otherwise, so the form preselects the first one rather than letting
        // the operator discover the rule from a 422.
        if (data.variants.length > 0) setVariantId(data.variants[0]!.id);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(
          caught instanceof AdminApiError
            ? caught.message
            : lang === 'bn'
              ? 'বিস্তারিত লোড করা যায়নি।'
              : 'Could not load the detail.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [item.productId, lang]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hasVariants = (detail?.variants.length ?? item.variantCount) > 0;
  const selectedVariant = detail?.variants.find((variant) => variant.id === variantId) ?? null;
  const currentQuantity = hasVariants
    ? selectedVariant?.stock ?? 0
    : detail?.warehouses.reduce((sum, row) => sum + row.quantity, 0) ?? item.warehouseQty;

  const parsed = Number(amount);
  const amountValid = Number.isInteger(parsed);
  const reasonValid = reason.trim().length >= MIN_REASON;

  const projected =
    amountValid && Number.isFinite(parsed)
      ? mode === 'delta'
        ? currentQuantity + parsed
        : parsed
      : null;

  async function submit() {
    setError(null);
    setNotice(null);

    if (!amountValid) {
      setError(lang === 'bn' ? 'পূর্ণ সংখ্যা দিন।' : 'Enter a whole number.');
      return;
    }
    if (!reasonValid) {
      setError(
        lang === 'bn'
          ? `কারণ লিখুন (কমপক্ষে ${MIN_REASON} অক্ষর)।`
          : `A reason of at least ${MIN_REASON} characters is required.`,
      );
      return;
    }
    if (projected !== null && projected < 0) {
      setError(
        lang === 'bn'
          ? `স্টক শূন্যের নিচে যেতে পারে না। বর্তমান ${num(currentQuantity, lang)}।`
          : `Stock cannot go below zero. Current quantity is ${num(currentQuantity, lang)}.`,
      );
      return;
    }

    setBusy(true);
    try {
      const result = await adjustStock(item.productId, {
        quantity: parsed,
        mode,
        reason: reason.trim(),
        ...(hasVariants && variantId ? { variantId } : {}),
      });

      if (!result.changed) {
        setNotice(
          lang === 'bn'
            ? 'কোনো পরিবর্তন হয়নি — স্টক আগেই এই মানে ছিল।'
            : 'Nothing changed — the stock already held that value.',
        );
        setBusy(false);
        return;
      }

      setNotice(
        lang === 'bn'
          ? `সংরক্ষিত: ${num(result.previousQuantity, lang)} → ${num(result.newQuantity, lang)}`
          : `Saved: ${num(result.previousQuantity, lang)} → ${num(result.newQuantity, lang)}`,
      );
      setTimeout(onSaved, 700);
    } catch (caught) {
      setError(
        caught instanceof AdminApiError
          ? caught.message
          : lang === 'bn'
            ? 'সমন্বয় ব্যর্থ হয়েছে।'
            : 'The adjustment failed.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="overlay side open" role="presentation" onClick={onClose}>
      <aside
        className="drawer inv-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inv-drawer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="m-head">
          <h2 id="inv-drawer-title">{lang === 'bn' ? 'স্টক সমন্বয়' : 'Adjust stock'}</h2>
          <button type="button" className="x" onClick={onClose} aria-label={lang === 'bn' ? 'বন্ধ করুন' : 'Close'}>
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="m-body">
          <div className="inv-drawer-product">
            <b>{lang === 'bn' ? item.nameBn : item.nameEn}</b>
            <small>
              {item.sku} · {lang === 'bn' ? item.categoryNameBn : item.categoryNameEn}
            </small>
          </div>

          {loadError && <p className="inv-error">{loadError}</p>}

          {hasVariants && (
            <div className="inv-warn" role="note">
              <AlertTriangle size={16} aria-hidden />
              <span>
                {lang === 'bn'
                  ? 'এই পণ্যের ভ্যারিয়েন্ট আছে — সমন্বয়টি ভ্যারিয়েন্টের স্টকে হবে, পণ্যের নয়।'
                  : 'This product has variants — the adjustment targets the variant stock, not the product.'}
              </span>
            </div>
          )}

          {hasVariants && detail && (
            <label className="field full">
              <span>{lang === 'bn' ? 'ভ্যারিয়েন্ট' : 'Variant'}</span>
              <select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
                {detail.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {lang === 'bn' ? variant.nameBn : variant.nameEn} · {variant.sku} ·{' '}
                    {num(variant.stock, lang)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="inv-current">
            <span>{lang === 'bn' ? 'বর্তমান স্টক' : 'Current quantity'}</span>
            <b>{num(currentQuantity, lang)}</b>
          </div>

          <div className="inv-mode" role="group" aria-label={lang === 'bn' ? 'ধরন' : 'Mode'}>
            <button
              type="button"
              className={mode === 'delta' ? 'on' : undefined}
              onClick={() => setMode('delta')}
              aria-pressed={mode === 'delta'}
            >
              {lang === 'bn' ? 'যোগ/বিয়োগ' : 'Add / remove'}
            </button>
            <button
              type="button"
              className={mode === 'set' ? 'on' : undefined}
              onClick={() => setMode('set')}
              aria-pressed={mode === 'set'}
            >
              {lang === 'bn' ? 'নির্দিষ্ট মান' : 'Set to'}
            </button>
          </div>

          <label className="field full">
            <span>
              {mode === 'delta'
                ? lang === 'bn'
                  ? 'পরিবর্তন (+৫ বা −৩)'
                  : 'Change (+5 or −3)'
                : lang === 'bn'
                  ? 'নতুন মান'
                  : 'New quantity'}
            </span>
            <input
              type="number"
              step={1}
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-describedby="inv-projected"
            />
          </label>

          {projected !== null && (
            <p id="inv-projected" className={projected < 0 ? 'inv-projected bad' : 'inv-projected'}>
              {lang === 'bn' ? 'হবে' : 'Will become'}: <b>{num(projected, lang)}</b>
            </p>
          )}

          <label className="field full">
            <span>
              {lang === 'bn' ? 'কারণ (আবশ্যক)' : 'Reason (required)'}
            </span>
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                lang === 'bn'
                  ? 'যেমন: সরবরাহকারীর কাছ থেকে ৫টি পাওয়া গেছে'
                  : 'e.g. Received 5 units from the supplier'
              }
              aria-invalid={reason.length > 0 && !reasonValid}
            />
            <small className="inv-hint">
              {lang === 'bn'
                ? `কমপক্ষে ${MIN_REASON} অক্ষর — এটি মুভমেন্ট লগে থাকবে।`
                : `At least ${MIN_REASON} characters — this is what the movement log keeps.`}
            </small>
          </label>

          {error && <p className="inv-error">{error}</p>}
          {notice && <p className="inv-notice">{notice}</p>}

          {detail && detail.movements.length > 0 && (
            <div className="inv-recent">
              <h3>
                <History size={14} aria-hidden />
                {lang === 'bn' ? 'সাম্প্রতিক মুভমেন্ট' : 'Recent movements'}
              </h3>
              <ul>
                {detail.movements.slice(0, 5).map((movement) => (
                  <li key={movement.id}>
                    <span className={`inv-mv-type ${movement.quantity < 0 ? 'bad' : 'ok'}`}>
                      {movement.quantity > 0 ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
                      {movement.quantity > 0 ? '+' : ''}
                      {num(movement.quantity, lang)}
                    </span>
                    <span className="inv-mv-reason">{movement.reason ?? '—'}</span>
                    <span className="inv-mv-date">{when(movement.createdAt, lang)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="m-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            {lang === 'bn' ? 'বাতিল' : 'Cancel'}
          </button>
          {canWrite && (
            <button type="button" className="btn" onClick={submit} disabled={busy}>
              {busy
                ? lang === 'bn'
                  ? 'সংরক্ষণ হচ্ছে…'
                  : 'Saving…'
                : lang === 'bn'
                  ? 'সমন্বয় করুন'
                  : 'Adjust'}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

// ─── Movement log ──────────────────────────────────────────────────────────

interface MovementTableProps {
  lang: Lang;
  items: MovementRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
}

export function MovementTable({
  lang,
  items,
  total,
  page,
  limit,
  totalPages,
  prevHref,
  nextHref,
}: MovementTableProps) {
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  if (items.length === 0) {
    return (
      <div className="card inv-empty">
        <p>
          {lang === 'bn'
            ? 'এখনো কোনো স্টক মুভমেন্ট নেই। প্রথম সমন্বয় করলে এখানে দেখা যাবে।'
            : 'No stock movements yet. They appear here after the first adjustment.'}
        </p>
      </div>
    );
  }

  return (
    <div className="card inv-table-card">
      <div className="inv-table-head">
        <span className="inv-count">
          {lang === 'bn' ? `${first}–${last} / ${num(total, lang)}` : `${first}–${last} of ${num(total, lang)}`}
        </span>
      </div>

      <div className="table-wrap">
        <table className="inv-table">
          <thead>
            <tr>
              <th>{lang === 'bn' ? 'তারিখ' : 'Date'}</th>
              <th className="inv-col-name">{lang === 'bn' ? 'পণ্য' : 'Product'}</th>
              <th>{lang === 'bn' ? 'ধরন' : 'Type'}</th>
              <th className="num">{lang === 'bn' ? 'পরিবর্তন' : 'Change'}</th>
              <th>{lang === 'bn' ? 'কারণ' : 'Reason'}</th>
              <th>{lang === 'bn' ? 'কর্তা' : 'By'}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td data-label={lang === 'bn' ? 'তারিখ' : 'Date'}>
                  <span className="inv-date">{when(row.createdAt, lang)}</span>
                </td>
                <td data-label={lang === 'bn' ? 'পণ্য' : 'Product'}>
                  <span className="inv-names">
                    <b>{row.productNameEn ?? row.productId}</b>
                    <small>{row.productSku ?? '—'}</small>
                  </span>
                </td>
                <td data-label={lang === 'bn' ? 'ধরন' : 'Type'}>
                  <span className="badge mute">{movementLabel(row.type, lang)}</span>
                </td>
                <td className="num" data-label={lang === 'bn' ? 'পরিবর্তন' : 'Change'}>
                  <span className={row.quantity < 0 ? 'inv-delta bad' : 'inv-delta ok'}>
                    {row.quantity > 0 ? '+' : ''}
                    {num(row.quantity, lang)}
                  </span>
                </td>
                <td data-label={lang === 'bn' ? 'কারণ' : 'Reason'}>{row.reason ?? '—'}</td>
                <td data-label={lang === 'bn' ? 'কর্তা' : 'By'}>{row.createdByName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="inv-pager">
          {prevHref ? (
            <a className="btn ghost sm" href={prevHref}>
              {lang === 'bn' ? 'পূর্ববর্তী' : 'Previous'}
            </a>
          ) : (
            <span className="btn ghost sm" aria-disabled="true">
              {lang === 'bn' ? 'পূর্ববর্তী' : 'Previous'}
            </span>
          )}
          <span className="inv-page-of">
            {lang === 'bn' ? `${page} / ${totalPages}` : `Page ${page} of ${totalPages}`}
          </span>
          {nextHref ? (
            <a className="btn ghost sm" href={nextHref}>
              {lang === 'bn' ? 'পরবর্তী' : 'Next'}
            </a>
          ) : (
            <span className="btn ghost sm" aria-disabled="true">
              {lang === 'bn' ? 'পরবর্তী' : 'Next'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
