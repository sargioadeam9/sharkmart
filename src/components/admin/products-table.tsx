'use client';

/**
 * The products list's client island — toolbar, table, bulk bar, row drawer.
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
 * It does not filter, sort or paginate on the client. Every one of those is a
 * URL change, which re-renders the server component and re-queries the API. That
 * is deliberate: `total` has to come from the server or the page count lies, and
 * a client-side filter over one page of twenty would silently hide the rest of
 * the catalog.
 *
 * ── Class names ────────────────────────────────────────────────────────────
 *
 * Everything new is prefixed `prod-`. The storefront's `home.css` has unscoped
 * `.card`, `.badge` and `.grid` rules, and Pass A lost time to exactly that
 * collision. The admin stylesheet scopes under `.admin-root`, but a prefixed
 * name is a second lock on the same door.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Download, Search, X } from 'lucide-react';

import { formatMoneyAdmin } from '@/lib/format';
import {
  archiveProduct,
  deleteProduct,
  type AdminProductListItem,
  type ProductFormOptions,
} from '@/lib/api/admin-products';

type Lang = 'en' | 'bn';

const STATUS_TONE: Record<string, string> = {
  published: 'ok',
  draft: 'warn',
  archived: 'mute',
};

const STATUS_LABEL: Record<string, { en: string; bn: string }> = {
  published: { en: 'Published', bn: 'প্রকাশিত' },
  draft: { en: 'Draft', bn: 'খসড়া' },
  archived: { en: 'Archived', bn: 'সংরক্ষিত' },
};

const STOCK_TONE: Record<string, string> = {
  in_stock: 'ok',
  low_stock: 'warn',
  out_of_stock: 'bad',
};

const STOCK_LABEL: Record<string, { en: string; bn: string }> = {
  in_stock: { en: 'In stock', bn: 'স্টকে আছে' },
  low_stock: { en: 'Low stock', bn: 'স্টক কম' },
  out_of_stock: { en: 'Out of stock', bn: 'স্টক নেই' },
};

/** "12 Nov 2026" — the admin reads dates, not timestamps. */
function formatDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Toolbar ───────────────────────────────────────────────────────────────

interface ToolbarProps {
  lang: Lang;
  initialQuery: string;
  status: string;
  stock: string;
  categoryId: string;
  brandId: string;
  sort: string;
  categories: ProductFormOptions['categories'];
  brands: ProductFormOptions['brands'];
}

/**
 * Search + filters. Every control writes to the URL, which is what makes the
 * server re-query.
 */
export function ProductsToolbar({
  lang,
  initialQuery,
  status,
  stock,
  categoryId,
  brandId,
  sort,
  categories,
  brands,
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
      if (stock !== 'all') next.set('stock', stock);
      if (categoryId) next.set('categoryId', categoryId);
      if (brandId) next.set('brandId', brandId);
      if (sort !== 'updated') next.set('sort', sort);

      for (const [key, value] of Object.entries(overrides)) {
        if (key === 'q') continue;
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }

      // Any filter change resets to page 1: staying on page 4 of a 1-page result
      // is the classic empty-list bug.
      next.delete('page');

      router.push(`/admin/products?${next.toString()}`);
    },
    [router, initialQuery, status, stock, categoryId, brandId, sort],
  );

  /** Debounced so typing does not fire a query per keystroke. */
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

  const activeFilters = [categoryId, brandId].filter(Boolean).length + (stock !== 'all' ? 1 : 0);

  return (
    <div className="card prod-toolbar">
      <label className="prod-search">
        <Search size={16} aria-hidden />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={
            lang === 'bn' ? 'নাম, SKU বা বারকোড খুঁজুন' : 'Search name, SKU or barcode'
          }
          aria-label={lang === 'bn' ? 'পণ্য খুঁজুন' : 'Search products'}
        />
        {query && (
          <button
            type="button"
            className="prod-clear"
            onClick={() => onQueryChange('')}
            aria-label={lang === 'bn' ? 'মুছুন' : 'Clear search'}
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </label>

      <div className="prod-filters">
        <select
          value={categoryId}
          onChange={(event) => navigate({ categoryId: event.target.value || undefined })}
          aria-label={lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}
        >
          <option value="">{lang === 'bn' ? 'সব ক্যাটাগরি' : 'All categories'}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {lang === 'bn' ? category.nameBn : category.nameEn}
            </option>
          ))}
        </select>

        <select
          value={brandId}
          onChange={(event) => navigate({ brandId: event.target.value || undefined })}
          aria-label={lang === 'bn' ? 'ব্র্যান্ড' : 'Brand'}
        >
          <option value="">{lang === 'bn' ? 'সব ব্র্যান্ড' : 'All brands'}</option>
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {lang === 'bn' ? brand.nameBn : brand.nameEn}
            </option>
          ))}
        </select>

        <select
          value={stock}
          onChange={(event) => navigate({ stock: event.target.value })}
          aria-label={lang === 'bn' ? 'স্টক' : 'Stock'}
        >
          <option value="all">{lang === 'bn' ? 'সব স্টক' : 'Any stock'}</option>
          <option value="in">{lang === 'bn' ? 'স্টকে আছে' : 'In stock'}</option>
          <option value="low">{lang === 'bn' ? 'স্টক কম' : 'Low stock'}</option>
          <option value="out">{lang === 'bn' ? 'স্টক নেই' : 'Out of stock'}</option>
        </select>

        <select
          value={sort}
          onChange={(event) => navigate({ sort: event.target.value })}
          aria-label={lang === 'bn' ? 'সাজান' : 'Sort'}
        >
          <option value="updated">{lang === 'bn' ? 'সাম্প্রতিক পরিবর্তিত' : 'Recently updated'}</option>
          <option value="newest">{lang === 'bn' ? 'নতুন আগে' : 'Newest first'}</option>
          <option value="oldest">{lang === 'bn' ? 'পুরোনো আগে' : 'Oldest first'}</option>
          <option value="name_asc">{lang === 'bn' ? 'নাম (ক → হ)' : 'Name A–Z'}</option>
          <option value="name_desc">{lang === 'bn' ? 'নাম (হ → ক)' : 'Name Z–A'}</option>
          <option value="price_asc">{lang === 'bn' ? 'দাম (কম)' : 'Price low–high'}</option>
          <option value="price_desc">{lang === 'bn' ? 'দাম (বেশি)' : 'Price high–low'}</option>
        </select>

        {activeFilters > 0 && (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => navigate({ categoryId: undefined, brandId: undefined, stock: 'all' })}
          >
            {lang === 'bn' ? 'ফিল্টার মুছুন' : 'Clear filters'}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Table ─────────────────────────────────────────────────────────────────

interface TableProps {
  lang: Lang;
  items: AdminProductListItem[];
  total: number;
  page: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
}

export function ProductsTable({ lang, items, total, page, totalPages, prevHref, nextHref }: TableProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerFor, setDrawerFor] = useState<AdminProductListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * A new page means a new set of rows; keeping the old selection would let a
   * bulk action hit rows the operator can no longer see.
   *
   * Adjusted during render rather than in an effect: React's documented pattern
   * for "reset state when a prop changes". An effect would render once with the
   * stale selection (a visible flash of the wrong count) and then again with the
   * new one, which is the cascading render the lint rule exists to prevent.
   */
  const [selectionPage, setSelectionPage] = useState(page);
  if (selectionPage !== page) {
    setSelectionPage(page);
    setSelected(new Set());
  }

  const allSelected = items.length > 0 && selected.size === items.length;

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

  /** Archives every selected product, one call each, then refreshes. */
  async function bulkArchive() {
    setBusy(true);
    setNotice(null);
    try {
      for (const id of selected) {
        await archiveProduct(id);
      }
      setSelected(new Set());
      setNotice(
        lang === 'bn'
          ? `${selected.size}টি পণ্য সংরক্ষিত হয়েছে।`
          : `${selected.size} product${selected.size === 1 ? '' : 's'} archived.`,
      );
      router.refresh();
    } catch {
      setNotice(lang === 'bn' ? 'সংরক্ষণ ব্যর্থ হয়েছে।' : 'Archive failed.');
    } finally {
      setBusy(false);
    }
  }

  /** Exports the current page as CSV. Client-side because it is a file, not data. */
  function exportCsv() {
    const rows = selected.size > 0 ? items.filter((item) => selected.has(item.id)) : items;
    const header = ['SKU', 'Name (EN)', 'Name (BN)', 'Category', 'Price (BDT)', 'Stock', 'Status'];

    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;

    const lines = [
      header.join(','),
      ...rows.map((item) =>
        [
          item.sku,
          item.nameEn,
          item.nameBn,
          item.categoryNameEn,
          String(Math.round(item.payablePoisha / 100)),
          String(item.stock),
          item.status,
        ]
          .map(escape)
          .join(','),
      ),
    ];

    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `products-page-${page}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const money = useMemo(() => (poisha: number) => formatMoneyAdmin(poisha), []);

  return (
    <>
      <div className="card prod-table-card">
        <div className="prod-table-head">
          <span className="prod-count">
            {lang === 'bn'
              ? `${total}টির মধ্যে ${(page - 1) * 20 + 1}–${Math.min(page * 20, total)}`
              : `${(page - 1) * 20 + 1}–${Math.min(page * 20, total)} of ${total}`}
          </span>
          <button type="button" className="btn ghost sm" onClick={exportCsv}>
            <Download size={14} aria-hidden />
            {lang === 'bn' ? 'এক্সপোর্ট' : 'Export'}
          </button>
        </div>

        {notice && <p className="prod-notice">{notice}</p>}

        <div className="table-wrap">
          <table className="prod-table">
            <thead>
              <tr>
                <th className="prod-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={lang === 'bn' ? 'সব নির্বাচন' : 'Select all'}
                  />
                </th>
                <th className="prod-col-name">{lang === 'bn' ? 'পণ্য' : 'Product'}</th>
                <th>SKU</th>
                <th className="prod-col-cat">{lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}</th>
                <th className="num">{lang === 'bn' ? 'দাম' : 'Price'}</th>
                <th>{lang === 'bn' ? 'স্টক' : 'Stock'}</th>
                <th>{lang === 'bn' ? 'অবস্থা' : 'Status'}</th>
                <th>{lang === 'bn' ? 'হালনাগাদ' : 'Updated'}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className={selected.has(item.id) ? 'prod-row-selected' : undefined}
                  onClick={() => setDrawerFor(item)}
                >
                  <td className="prod-check" data-label="">
                    <input
                      type="checkbox"
                      checked={selected.has(item.id)}
                      onChange={() => toggleOne(item.id)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={
                        lang === 'bn' ? `${item.nameBn} নির্বাচন` : `Select ${item.nameEn}`
                      }
                    />
                  </td>

                  <td data-label={lang === 'bn' ? 'পণ্য' : 'Product'}>
                    <div className="prod-cell">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.imageUrl} alt="" className="prod-thumb" loading="lazy" />
                      ) : (
                        <span className="prod-thumb prod-thumb-empty" aria-hidden />
                      )}
                      <div className="prod-names">
                        <b className="ellip">{lang === 'bn' ? item.nameBn : item.nameEn}</b>
                        <small className="ellip">
                          {lang === 'bn' ? item.nameEn : item.nameBn}
                        </small>
                      </div>
                    </div>
                  </td>

                  <td data-label="SKU">
                    <code className="prod-sku">{item.sku}</code>
                  </td>

                  <td className="prod-col-cat" data-label={lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}>
                    {lang === 'bn' ? item.categoryNameBn : item.categoryNameEn}
                  </td>

                  <td className="num" data-label={lang === 'bn' ? 'দাম' : 'Price'}>
                    {money(item.payablePoisha)}
                  </td>

                  <td data-label={lang === 'bn' ? 'স্টক' : 'Stock'}>
                    <span className={`badge ${STOCK_TONE[item.stockStatus] ?? 'mute'}`}>
                      {lang === 'bn'
                        ? STOCK_LABEL[item.stockStatus]!.bn
                        : STOCK_LABEL[item.stockStatus]!.en}
                      {' · '}
                      {item.stock}
                    </span>
                  </td>

                  <td data-label={lang === 'bn' ? 'অবস্থা' : 'Status'}>
                    <span className={`badge ${STATUS_TONE[item.status] ?? 'mute'}`}>
                      {lang === 'bn' ? STATUS_LABEL[item.status]!.bn : STATUS_LABEL[item.status]!.en}
                    </span>
                  </td>

                  <td data-label={lang === 'bn' ? 'হালনাগাদ' : 'Updated'}>
                    {formatDate(item.updatedAt, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="prod-pager">
          {prevHref ? (
            <Link href={prevHref} className="btn ghost sm" aria-label={lang === 'bn' ? 'আগের পাতা' : 'Previous page'}>
              <ArrowUp size={14} style={{ transform: 'rotate(-90deg)' }} aria-hidden />
              {lang === 'bn' ? 'আগের' : 'Previous'}
            </Link>
          ) : (
            <span />
          )}
          <span className="prod-page-label">
            {lang === 'bn' ? `পাতা ${page} / ${totalPages}` : `Page ${page} of ${totalPages}`}
          </span>
          {nextHref ? (
            <Link href={nextHref} className="btn ghost sm" aria-label={lang === 'bn' ? 'পরের পাতা' : 'Next page'}>
              {lang === 'bn' ? 'পরের' : 'Next'}
              <ArrowDown size={14} style={{ transform: 'rotate(-90deg)' }} aria-hidden />
            </Link>
          ) : (
            <span />
          )}
        </div>
      </div>

      {/* Sticky bulk bar. Fixed under 720px so it sits above the bottom nav;
          in-flow above that so it does not cover the pager. */}
      {selected.size > 0 && (
        <div className="prod-bulk" role="region" aria-label={lang === 'bn' ? 'নির্বাচিত' : 'Selection'}>
          <span>
            {lang === 'bn' ? `${selected.size}টি নির্বাচিত` : `${selected.size} selected`}
          </span>
          <div className="prod-bulk-actions">
            <button type="button" className="btn sm" onClick={bulkArchive} disabled={busy}>
              {busy
                ? lang === 'bn'
                  ? 'সংরক্ষণ হচ্ছে…'
                  : 'Archiving…'
                : lang === 'bn'
                  ? 'সংরক্ষণ করুন'
                  : 'Archive'}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setSelected(new Set())}>
              {lang === 'bn' ? 'বাতিল' : 'Clear'}
            </button>
          </div>
        </div>
      )}

      {/* Row drawer — a quick summary with the two actions an operator reaches
          for from a list. Edit goes to the editor; archive is in place. */}
      <div
        className={drawerFor ? 'overlay side open' : 'overlay side'}
        onClick={() => setDrawerFor(null)}
        aria-hidden={!drawerFor}
      >
        {drawerFor && (
          <div
            className="drawer prod-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={lang === 'bn' ? 'পণ্যের সারসংক্ষেপ' : 'Product summary'}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="m-head">
              <h2>{lang === 'bn' ? drawerFor.nameBn : drawerFor.nameEn}</h2>
              <button
                type="button"
                className="x"
                onClick={() => setDrawerFor(null)}
                aria-label={lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
              >
                <X size={18} aria-hidden />
              </button>
            </div>

            <div className="m-body">
              {drawerFor.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={drawerFor.imageUrl} alt="" className="prod-drawer-img" />
              )}

              <div className="info-grid">
                <div>
                  <small>SKU</small>
                  <b>{drawerFor.sku}</b>
                </div>
                <div>
                  <small>{lang === 'bn' ? 'ক্যাটাগরি' : 'Category'}</small>
                  <b>{lang === 'bn' ? drawerFor.categoryNameBn : drawerFor.categoryNameEn}</b>
                </div>
                <div>
                  <small>{lang === 'bn' ? 'ব্র্যান্ড' : 'Brand'}</small>
                  <b>
                    {drawerFor.brandNameEn
                      ? lang === 'bn'
                        ? drawerFor.brandNameBn
                        : drawerFor.brandNameEn
                      : '—'}
                  </b>
                </div>
                <div>
                  <small>{lang === 'bn' ? 'গ্রাহক দাম' : 'Customer pays'}</small>
                  <b>{money(drawerFor.payablePoisha)}</b>
                </div>
                <div>
                  <small>{lang === 'bn' ? 'স্টক' : 'Stock'}</small>
                  <b>{drawerFor.stock}</b>
                </div>
                <div>
                  <small>{lang === 'bn' ? 'ভ্যারিয়েন্ট' : 'Variants'}</small>
                  <b>{drawerFor.variantCount}</b>
                </div>
              </div>

              <div className="prod-drawer-badges">
                <span className={`badge ${STATUS_TONE[drawerFor.status] ?? 'mute'}`}>
                  {lang === 'bn'
                    ? STATUS_LABEL[drawerFor.status]!.bn
                    : STATUS_LABEL[drawerFor.status]!.en}
                </span>
                <span className={`badge ${STOCK_TONE[drawerFor.stockStatus] ?? 'mute'}`}>
                  {lang === 'bn'
                    ? STOCK_LABEL[drawerFor.stockStatus]!.bn
                    : STOCK_LABEL[drawerFor.stockStatus]!.en}
                </span>
              </div>
            </div>

            <div className="m-foot">
              <Link href={`/admin/products/${drawerFor.id}`} className="btn">
                {lang === 'bn' ? 'সম্পাদনা' : 'Edit'}
              </Link>
              {drawerFor.status !== 'archived' && (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await archiveProduct(drawerFor.id);
                      setDrawerFor(null);
                      router.refresh();
                    } catch {
                      setNotice(lang === 'bn' ? 'সংরক্ষণ ব্যর্থ হয়েছে।' : 'Archive failed.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {lang === 'bn' ? 'সংরক্ষণ করুন' : 'Archive'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Re-exported for the editor's delete confirmation. */
export { deleteProduct };
